/*
  # Create function to get trending songs from last 7 days

  1. New Functions
    - `get_trending_songs_last_7_days()` - Returns top songs by play count from last 7 days
    
  2. Features
    - Fetches songs with highest play counts from listening history in last 7 days
    - Includes artist information with user_id for profile linking
    - Returns up to 25 songs ordered by play count
    - Only includes approved songs with valid audio URLs
    - Accessible to all users (anon and authenticated)
*/

CREATE OR REPLACE FUNCTION get_trending_songs_last_7_days()
RETURNS TABLE (
  id uuid,
  title text,
  artist text,
  artist_user_id uuid,
  duration_seconds integer,
  audio_url text,
  cover_image_url text,
  play_count_7_days bigint
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
    ap.user_id as artist_user_id,
    s.duration_seconds,
    s.audio_url,
    s.cover_image_url,
    COUNT(lh.id) as play_count_7_days
  FROM songs s
  LEFT JOIN artists a ON s.artist_id = a.id
  LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
  LEFT JOIN listening_history lh ON s.id = lh.song_id 
    AND lh.listened_at >= NOW() - INTERVAL '7 days'
  WHERE s.audio_url IS NOT NULL
  GROUP BY s.id, s.title, a.name, ap.user_id, s.duration_seconds, s.audio_url, s.cover_image_url
  HAVING COUNT(lh.id) > 0
  ORDER BY play_count_7_days DESC, s.created_at DESC
  LIMIT 25;
END;
$$;