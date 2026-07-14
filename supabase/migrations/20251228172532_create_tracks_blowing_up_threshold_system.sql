/*
  # Tracks Blowing Up - Threshold System with Smart Fallback
  
  1. New Configuration
    - Adds 'tracks_blowing_up' to content_section_thresholds
    - Default threshold: 5 plays in 30 minutes
    
  2. New Function: get_tracks_blowing_up()
    - Time-based analysis (30-minute windows)
    - Calculates growth rate comparing last 30min vs previous 30min
    - 4-tier smart fallback system
    - Integrates with manual_blowing_up_songs
    
  3. Smart Fallback Tiers
    - Tier 1: Meets admin threshold (default 5 plays/30min)
    - Tier 2: At least 3 plays in 30min (moderate activity)
    - Tier 3: At least 1 play in 30min (any recent activity)
    - Tier 4: Manual songs + recent uploads with total engagement
    
  4. Benefits
    - Works for new apps with low activity
    - Respects admin-configured thresholds
    - Always shows content when available
    - Time-based momentum tracking
*/

-- Add tracks_blowing_up to threshold configuration
INSERT INTO content_section_thresholds (section_key, section_name, min_play_count, is_enabled)
VALUES ('tracks_blowing_up', 'Tracks Blowing Up', 5, true)
ON CONFLICT (section_key) DO UPDATE
SET section_name = EXCLUDED.section_name,
    min_play_count = GREATEST(content_section_thresholds.min_play_count, 5); -- Keep existing if higher

-- Create the function
CREATE OR REPLACE FUNCTION get_tracks_blowing_up(
  limit_param integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  title text,
  artist_id uuid,
  artist_name text,
  artist_stage_name text,
  artist_user_id uuid,
  cover_image_url text,
  audio_url text,
  duration_seconds integer,
  play_count integer,
  featured_artists text[],
  plays_last_30min bigint,
  plays_prev_30min bigint,
  growth_percentage numeric,
  tier integer,
  is_manual boolean
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  threshold_count integer;
  now_time timestamptz := NOW();
  thirty_min_ago timestamptz := now_time - interval '30 minutes';
  sixty_min_ago timestamptz := now_time - interval '60 minutes';
BEGIN
  -- Get the dynamic threshold for tracks_blowing_up section
  SELECT min_play_count INTO threshold_count
  FROM content_section_thresholds
  WHERE section_key = 'tracks_blowing_up' AND is_enabled = true;
  
  -- Default to 5 if not configured
  IF threshold_count IS NULL THEN
    threshold_count := 5;
  END IF;

  RETURN QUERY
  WITH manual_songs AS (
    -- Get manually curated blowing up songs
    SELECT 
      mbs.song_id,
      mbs.display_order
    FROM manual_blowing_up_songs mbs
    WHERE mbs.is_active = true
  ),
  song_activity AS (
    -- Calculate play counts for each song in different time windows
    SELECT 
      s.id,
      s.title,
      s.artist_id,
      s.cover_image_url,
      s.audio_url,
      s.duration_seconds,
      s.play_count,
      s.featured_artists,
      s.created_at,
      -- Count plays in last 30 minutes
      COUNT(lh.id) FILTER (
        WHERE lh.listened_at >= thirty_min_ago 
        AND lh.listened_at <= now_time
        AND lh.is_validated = true
      ) as plays_last_30,
      -- Count plays in previous 30 minutes (30-60 minutes ago)
      COUNT(lh.id) FILTER (
        WHERE lh.listened_at >= sixty_min_ago 
        AND lh.listened_at < thirty_min_ago
        AND lh.is_validated = true
      ) as plays_prev_30,
      -- Check if manually added
      CASE WHEN ms.song_id IS NOT NULL THEN true ELSE false END as is_manual_song,
      COALESCE(ms.display_order, 9999) as manual_order
    FROM songs s
    LEFT JOIN listening_history lh ON s.id = lh.song_id
    LEFT JOIN manual_songs ms ON s.id = ms.song_id
    WHERE s.audio_url IS NOT NULL
      AND s.created_at >= now_time - interval '7 days' -- Only recent songs
    GROUP BY s.id, s.title, s.artist_id, s.cover_image_url, s.audio_url,
             s.duration_seconds, s.play_count, s.featured_artists, s.created_at,
             ms.song_id, ms.display_order
  ),
  calculated_growth AS (
    SELECT 
      sa.*,
      -- Calculate growth percentage
      CASE 
        WHEN sa.plays_prev_30 > 0 THEN
          ((sa.plays_last_30 - sa.plays_prev_30)::numeric / sa.plays_prev_30) * 100
        WHEN sa.plays_last_30 > 0 THEN
          999 -- Viral/new spike
        ELSE
          0
      END as growth_pct,
      -- Assign tier based on activity
      CASE
        WHEN sa.is_manual_song THEN 0 -- Manual songs get highest priority
        WHEN sa.plays_last_30 >= threshold_count THEN 1
        WHEN sa.plays_last_30 >= 3 THEN 2
        WHEN sa.plays_last_30 >= 1 THEN 3
        WHEN sa.play_count > 0 THEN 4 -- Has historical plays
        ELSE 5
      END as song_tier
    FROM song_activity sa
    WHERE sa.plays_last_30 > 0 -- Must have at least 1 play in last 30min
       OR sa.is_manual_song = true -- Or be manually added
       OR sa.play_count > 0 -- Or have historical engagement
  )
  SELECT 
    cg.id,
    cg.title,
    cg.artist_id,
    art.name as artist_name,
    ap.stage_name as artist_stage_name,
    ap.user_id as artist_user_id,
    cg.cover_image_url,
    cg.audio_url,
    cg.duration_seconds,
    cg.play_count,
    cg.featured_artists,
    cg.plays_last_30 as plays_last_30min,
    cg.plays_prev_30 as plays_prev_30min,
    ROUND(cg.growth_pct, 0) as growth_percentage,
    cg.song_tier as tier,
    cg.is_manual_song as is_manual
  FROM calculated_growth cg
  LEFT JOIN artists art ON cg.artist_id = art.id
  LEFT JOIN artist_profiles ap ON art.id = ap.artist_id
  WHERE cg.audio_url IS NOT NULL
  ORDER BY 
    cg.song_tier ASC, -- Priority by tier
    cg.manual_order ASC, -- Manual songs sorted by display order
    cg.plays_last_30 DESC, -- Most active first
    cg.growth_pct DESC, -- Highest growth
    cg.created_at DESC -- Newest first
  LIMIT limit_param;

  RETURN;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_tracks_blowing_up(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tracks_blowing_up(integer) TO anon;

-- Add helpful comment
COMMENT ON FUNCTION get_tracks_blowing_up IS 'Returns tracks blowing up in last 30 minutes with 4-tier fallback. Tier 0: Manual, Tier 1: admin threshold, Tier 2: 3+ plays, Tier 3: 1+ plays, Tier 4: historical engagement.';
