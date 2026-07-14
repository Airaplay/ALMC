/*
  # Fix Trending Albums Smart Fallback Logic
  
  1. Issue Fixed
    - GET DIAGNOSTICS only tracks last query, not cumulative results
    - Fallback tiers weren't properly checking total albums returned
    
  2. New Approach
    - Use a single query with tiered scoring
    - Assign tier priority based on play count thresholds
    - Sort by tier first, then by play count
    - Much simpler and more reliable
    
  3. Benefits
    - No complex tracking of row counts
    - Single efficient query
    - Guaranteed fallback behavior
    - Easier to debug and maintain
*/

-- Drop the problematic function
DROP FUNCTION IF EXISTS get_trending_albums(integer, integer);

-- Create improved function with unified query approach
CREATE OR REPLACE FUNCTION get_trending_albums(
  days_param integer DEFAULT 30,
  limit_param integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  title text,
  cover_image_url text,
  release_date date,
  description text,
  artist_id uuid,
  artist_name text,
  artist_stage_name text,
  artist_user_id uuid,
  total_plays bigint,
  track_count bigint,
  created_at timestamptz,
  tier integer
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  threshold_count integer;
BEGIN
  -- Get the dynamic threshold for trending_albums section
  SELECT min_play_count INTO threshold_count
  FROM content_section_thresholds
  WHERE section_key = 'trending_albums' AND is_enabled = true;
  
  -- Default to 50 if not configured
  IF threshold_count IS NULL THEN
    threshold_count := 50;
  END IF;

  -- Single query with tier-based sorting
  -- Tier 1: Meets admin threshold
  -- Tier 2: At least 10 plays
  -- Tier 3: At least 1 play
  RETURN QUERY
  SELECT 
    a.id,
    a.title,
    a.cover_image_url,
    a.release_date,
    a.description,
    art.id as artist_id,
    art.name as artist_name,
    ap.stage_name as artist_stage_name,
    ap.user_id as artist_user_id,
    COALESCE(SUM(s.play_count), 0) as total_plays,
    COUNT(s.id) as track_count,
    a.created_at,
    CASE 
      WHEN COALESCE(SUM(s.play_count), 0) >= threshold_count THEN 1
      WHEN COALESCE(SUM(s.play_count), 0) >= 10 THEN 2
      WHEN COALESCE(SUM(s.play_count), 0) >= 1 THEN 3
      ELSE 4
    END as tier
  FROM albums a
  LEFT JOIN artists art ON a.artist_id = art.id
  LEFT JOIN artist_profiles ap ON art.id = ap.artist_id
  LEFT JOIN songs s ON a.id = s.album_id
  WHERE a.created_at >= NOW() - (days_param || ' days')::interval
  GROUP BY a.id, a.title, a.cover_image_url, a.release_date, a.description, 
           art.id, art.name, ap.stage_name, ap.user_id, a.created_at
  HAVING COALESCE(SUM(s.play_count), 0) >= 1
  ORDER BY tier ASC, total_plays DESC, a.created_at DESC
  LIMIT limit_param;

  RETURN;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_trending_albums(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_trending_albums(integer, integer) TO anon;

-- Add comment
COMMENT ON FUNCTION get_trending_albums IS 'Returns trending albums with smart 3-tier fallback using unified query approach. Tier 1: admin threshold, Tier 2: 10+ plays, Tier 3: 1+ plays.';
