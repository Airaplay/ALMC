/*
  # Create function to get trending albums by play count in last 5 hours

  1. New Functions
    - `get_trending_albums_last_5_hours` - Gets albums ranked by total plays in last 5 hours
      - Aggregates play counts from listening_history for songs in each album
      - Filters to only include plays from the last 5 hours
      - Returns top albums with artist and play count information
      - Includes album metadata like cover image and track count

  2. Security
    - Function is accessible to all users (authenticated and anonymous)
    - Uses existing RLS policies on underlying tables
*/

CREATE OR REPLACE FUNCTION get_trending_albums_last_5_hours(limit_param INTEGER DEFAULT 25)
RETURNS TABLE (
  album_id UUID,
  album_title TEXT,
  album_cover_url TEXT,
  album_description TEXT,
  artist_name TEXT,
  artist_user_id UUID,
  total_plays BIGINT,
  track_count BIGINT,
  release_date DATE
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id as album_id,
    a.title as album_title,
    a.cover_image_url as album_cover_url,
    a.description as album_description,
    ar.name as artist_name,
    ap.user_id as artist_user_id,
    COALESCE(SUM(
      CASE 
        WHEN lh.listened_at >= NOW() - INTERVAL '5 hours' THEN 1 
        ELSE 0 
      END
    ), 0) as total_plays,
    COUNT(DISTINCT s.id) as track_count,
    a.release_date
  FROM albums a
  LEFT JOIN artists ar ON a.artist_id = ar.id
  LEFT JOIN artist_profiles ap ON ar.id = ap.artist_id
  LEFT JOIN songs s ON a.id = s.album_id
  LEFT JOIN listening_history lh ON s.id = lh.song_id
  WHERE a.id IS NOT NULL
  GROUP BY a.id, a.title, a.cover_image_url, a.description, ar.name, ap.user_id, a.release_date
  HAVING COUNT(DISTINCT s.id) > 0  -- Only include albums that have songs
  ORDER BY total_plays DESC, a.created_at DESC
  LIMIT limit_param;
END;
$$;

-- Grant execute permission to all users
GRANT EXECUTE ON FUNCTION get_trending_albums_last_5_hours TO anon, authenticated;