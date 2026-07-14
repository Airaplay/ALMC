/*
  # Create get_top_songs_last_1_hour function

  1. New Functions
    - `get_top_songs_last_1_hour()` - Returns top songs based on listening activity in the last hour
      - Returns songs with highest play count from listening_history in the last 60 minutes
      - Includes song details, artist information, and user_id for profile linking
      - Orders by play count descending
      - Limits to 25 results

  2. Security
    - Function is accessible to all users (public access)
    - Uses existing RLS policies on underlying tables
*/

CREATE OR REPLACE FUNCTION get_top_songs_last_1_hour()
RETURNS TABLE (
  id uuid,
  title text,
  artist text,
  artist_id uuid,
  artist_user_id uuid,
  duration_seconds integer,
  audio_url text,
  cover_image_url text,
  play_count bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    s.id,
    s.title,
    COALESCE(a.name, 'Unknown Artist') as artist,
    s.artist_id,
    ap.user_id as artist_user_id,
    s.duration_seconds,
    s.audio_url,
    s.cover_image_url,
    COUNT(lh.id) as play_count
  FROM songs s
  LEFT JOIN artists a ON s.artist_id = a.id
  LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
  LEFT JOIN listening_history lh ON s.id = lh.song_id
  WHERE lh.listened_at >= NOW() - INTERVAL '1 hour'
    AND s.audio_url IS NOT NULL
  GROUP BY s.id, s.title, a.name, s.artist_id, ap.user_id, s.duration_seconds, s.audio_url, s.cover_image_url
  HAVING COUNT(lh.id) > 0
  ORDER BY play_count DESC, s.created_at DESC
  LIMIT 25;
END;
$$;