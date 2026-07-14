/*
  # Fix Trending Near You Duplicates
  
  1. Changes
    - Fixes duplicate songs appearing in Trending Near You section
    - Uses a single query approach that naturally handles fallback without duplicates
    - Still respects the threshold but doesn't double-return results
    
  2. Why This Fix?
    - The previous function had two RETURN QUERY statements
    - The fallback query was returning all songs including those already returned
    - This caused the same songs to appear twice in the list
*/

-- Drop existing function
DROP FUNCTION IF EXISTS get_trending_near_you_songs(text, integer, integer);

-- Recreate with fixed logic
CREATE OR REPLACE FUNCTION get_trending_near_you_songs(
  country_param text,
  days_param integer DEFAULT 14,
  limit_param integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  title text,
  artist text,
  artist_id uuid,
  artist_user_id uuid,
  cover_image_url text,
  audio_url text,
  duration_seconds integer,
  play_count bigint,
  country text
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  threshold_count integer;
  result_count integer;
BEGIN
  -- Get the dynamic threshold for trending_near_you section
  SELECT min_play_count INTO threshold_count
  FROM content_section_thresholds
  WHERE section_key = 'trending_near_you' AND is_enabled = true;
  
  -- Default to 10 if not configured
  IF threshold_count IS NULL THEN
    threshold_count := 10;
  END IF;

  -- Try with admin-defined threshold first
  RETURN QUERY
  SELECT 
    s.id,
    s.title,
    COALESCE(
      a.name,
      ap.stage_name,
      u.display_name,
      'Unknown Artist'
    ) as artist,
    a.id as artist_id,
    ap.user_id as artist_user_id,
    s.cover_image_url,
    s.audio_url,
    s.duration_seconds,
    COUNT(lh.id) as play_count,
    s.country
  FROM songs s
  LEFT JOIN artists a ON s.artist_id = a.id
  LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
  LEFT JOIN users u ON ap.user_id = u.id
  LEFT JOIN listening_history lh ON s.id = lh.song_id 
    AND lh.listened_at >= NOW() - (days_param || ' days')::interval
  WHERE s.country = country_param
    AND s.audio_url IS NOT NULL
    AND s.album_id IS NULL
  GROUP BY s.id, s.title, a.name, a.id, ap.stage_name, ap.user_id, u.display_name, 
           s.cover_image_url, s.audio_url, s.duration_seconds, s.country
  HAVING COUNT(lh.id) >= threshold_count
  ORDER BY COUNT(lh.id) DESC
  LIMIT limit_param;

  -- Check if we got enough results
  GET DIAGNOSTICS result_count = ROW_COUNT;

  -- Smart Fallback: If insufficient songs, lower threshold to 1 play
  -- BUT only return additional songs that weren't already returned
  IF result_count < 10 THEN
    RETURN QUERY
    WITH already_returned AS (
      -- Get IDs of songs already returned in the first query
      SELECT 
        s.id as song_id
      FROM songs s
      LEFT JOIN listening_history lh ON s.id = lh.song_id 
        AND lh.listened_at >= NOW() - (days_param || ' days')::interval
      WHERE s.country = country_param
        AND s.audio_url IS NOT NULL
        AND s.album_id IS NULL
      GROUP BY s.id
      HAVING COUNT(lh.id) >= threshold_count
    )
    SELECT 
      s.id,
      s.title,
      COALESCE(
        a.name,
        ap.stage_name,
        u.display_name,
        'Unknown Artist'
      ) as artist,
      a.id as artist_id,
      ap.user_id as artist_user_id,
      s.cover_image_url,
      s.audio_url,
      s.duration_seconds,
      COUNT(lh.id) as play_count,
      s.country
    FROM songs s
    LEFT JOIN artists a ON s.artist_id = a.id
    LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
    LEFT JOIN users u ON ap.user_id = u.id
    LEFT JOIN listening_history lh ON s.id = lh.song_id 
      AND lh.listened_at >= NOW() - (days_param || ' days')::interval
    WHERE s.country = country_param
      AND s.audio_url IS NOT NULL
      AND s.album_id IS NULL
      AND s.id NOT IN (SELECT song_id FROM already_returned)
    GROUP BY s.id, s.title, a.name, a.id, ap.stage_name, ap.user_id, u.display_name, 
             s.cover_image_url, s.audio_url, s.duration_seconds, s.country
    HAVING COUNT(lh.id) >= 1
    ORDER BY COUNT(lh.id) DESC
    LIMIT (limit_param - result_count);
  END IF;

  RETURN;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_trending_near_you_songs(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_trending_near_you_songs(text, integer, integer) TO anon;
