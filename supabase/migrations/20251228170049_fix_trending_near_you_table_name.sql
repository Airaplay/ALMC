/*
  # Fix Trending Near You Songs Function - Correct Table Name
  
  1. Changes
    - Updates `get_trending_near_you_songs` function to use `listening_history` instead of `playback_history`
    - The table was incorrectly named in the function definition
    
  2. Why This Fix?
    - The actual table name is `listening_history` not `playback_history`
    - This was causing 404 errors when calling the RPC function
    - Function references must match exact table names
*/

-- Drop existing function
DROP FUNCTION IF EXISTS get_trending_near_you_songs(text, integer, integer);

-- Recreate with correct table name
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
    AND lh.created_at >= NOW() - (days_param || ' days')::interval
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

  -- Smart Fallback: If insufficient songs, try with minimum 1 play
  IF result_count < 10 THEN
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
      AND lh.created_at >= NOW() - (days_param || ' days')::interval
    WHERE s.country = country_param
      AND s.audio_url IS NOT NULL
      AND s.album_id IS NULL
    GROUP BY s.id, s.title, a.name, a.id, ap.stage_name, ap.user_id, u.display_name, 
             s.cover_image_url, s.audio_url, s.duration_seconds, s.country
    HAVING COUNT(lh.id) >= 1
    ORDER BY COUNT(lh.id) DESC
    LIMIT limit_param;
  END IF;

  RETURN;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_trending_near_you_songs(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_trending_near_you_songs(text, integer, integer) TO anon;
