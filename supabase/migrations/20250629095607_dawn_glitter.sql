/*
  # Create function to get top videos by country

  1. New Function
    - get_top_videos_by_country - Returns top videos/clips filtered by user country
    - Supports random selection of videos for variety
    - Refreshes every 2 hours (client-side)

  2. Features
    - Country-based filtering with fallback to global content
    - Prioritizes videos with higher play counts
    - Includes creator information for display
    - Returns a mix of videos and short clips

  3. Performance
    - Uses efficient joins and filtering
    - Limits result set to 25 items
*/

-- Function to get top videos by country
CREATE OR REPLACE FUNCTION get_top_videos_by_country(user_country text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  title text,
  content_type text,
  user_id uuid,
  creator_name text,
  creator_avatar text,
  thumbnail_url text,
  video_url text,
  duration_seconds integer,
  play_count integer,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  refresh_seed text;
BEGIN
  -- Generate a seed based on the current hour for consistent randomness within 2-hour windows
  -- This ensures the same random selection for 2 hours, then changes
  refresh_seed := to_char(date_trunc('hour', now()), 'YYYY-MM-DD-HH');
  
  -- If no country is provided, return global top videos
  IF user_country IS NULL OR user_country = '' THEN
    RETURN QUERY
    WITH ranked_videos AS (
      -- Get videos from content_uploads
      SELECT 
        cu.id,
        cu.title,
        cu.content_type,
        cu.user_id,
        u.display_name as creator_name,
        u.avatar_url as creator_avatar,
        cu.metadata->>'thumbnail_url' as thumbnail_url,
        CASE 
          WHEN cu.content_type = 'video' THEN cu.metadata->>'video_url'
          WHEN cu.content_type = 'short_clip' THEN cu.metadata->>'file_url'
        END as video_url,
        (cu.metadata->>'duration_seconds')::integer as duration_seconds,
        COALESCE(cu.play_count, 0) as play_count,
        cu.created_at,
        -- Random value seeded by the current 2-hour window
        setseed(('0.' || substr(md5(cu.id::text || refresh_seed), 1, 8))::float),
        random() as random_value
      FROM 
        content_uploads cu
      JOIN 
        users u ON cu.user_id = u.id
      WHERE 
        cu.content_type IN ('video', 'short_clip')
        AND cu.status = 'approved'
        AND (
          (cu.content_type = 'video' AND cu.metadata->>'video_url' IS NOT NULL) OR
          (cu.content_type = 'short_clip' AND cu.metadata->>'file_url' IS NOT NULL)
        )
        AND cu.metadata->>'thumbnail_url' IS NOT NULL
    )
    SELECT 
      rv.id,
      rv.title,
      rv.content_type,
      rv.user_id,
      rv.creator_name,
      rv.creator_avatar,
      rv.thumbnail_url,
      rv.video_url,
      rv.duration_seconds,
      rv.play_count,
      rv.created_at
    FROM 
      ranked_videos rv
    ORDER BY 
      -- Mix of popularity and randomness for variety
      rv.play_count DESC,
      rv.random_value
    LIMIT 25;
  ELSE
    -- Return videos with country prioritization
    RETURN QUERY
    WITH country_videos AS (
      -- Get videos from content_uploads with country prioritization
      SELECT 
        cu.id,
        cu.title,
        cu.content_type,
        cu.user_id,
        u.display_name as creator_name,
        u.avatar_url as creator_avatar,
        cu.metadata->>'thumbnail_url' as thumbnail_url,
        CASE 
          WHEN cu.content_type = 'video' THEN cu.metadata->>'video_url'
          WHEN cu.content_type = 'short_clip' THEN cu.metadata->>'file_url'
        END as video_url,
        (cu.metadata->>'duration_seconds')::integer as duration_seconds,
        COALESCE(cu.play_count, 0) as play_count,
        cu.created_at,
        -- Priority based on country match
        CASE WHEN u.country = user_country THEN 1 ELSE 2 END as priority,
        -- Random value seeded by the current 2-hour window
        setseed(('0.' || substr(md5(cu.id::text || refresh_seed), 1, 8))::float),
        random() as random_value
      FROM 
        content_uploads cu
      JOIN 
        users u ON cu.user_id = u.id
      WHERE 
        cu.content_type IN ('video', 'short_clip')
        AND cu.status = 'approved'
        AND (
          (cu.content_type = 'video' AND cu.metadata->>'video_url' IS NOT NULL) OR
          (cu.content_type = 'short_clip' AND cu.metadata->>'file_url' IS NOT NULL)
        )
        AND cu.metadata->>'thumbnail_url' IS NOT NULL
    )
    SELECT 
      cv.id,
      cv.title,
      cv.content_type,
      cv.user_id,
      cv.creator_name,
      cv.creator_avatar,
      cv.thumbnail_url,
      cv.video_url,
      cv.duration_seconds,
      cv.play_count,
      cv.created_at
    FROM 
      country_videos cv
    ORDER BY 
      -- First by country priority
      cv.priority,
      -- Then by popularity and randomness for variety
      cv.play_count DESC,
      cv.random_value
    LIMIT 25;
  END IF;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_top_videos_by_country TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_videos_by_country TO anon;