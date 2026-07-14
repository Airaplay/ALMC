/*
  # Create function to get top songs from last 12 hours

  1. New Functions
    - `get_top_songs_last_12_hours()` - Returns top 25 songs based on play count in last 12 hours
  
  2. Features
    - Queries listening_history table for plays in last 12 hours
    - Joins with songs, artists, and artist_profiles tables
    - Returns artist user_id for profile linking
    - Orders by play count descending
    - Limits to 25 results
  
  3. Security
    - Function is accessible to all users (anon and authenticated)
    - Uses existing RLS policies on underlying tables
*/

CREATE OR REPLACE FUNCTION public.get_top_songs_last_12_hours()
RETURNS TABLE (
    id uuid,
    title text,
    artist text,
    artist_id uuid,
    artist_user_id uuid,
    duration integer,
    audio_url text,
    cover_image_url text,
    play_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.title,
        COALESCE(a.name, 'Unknown Artist') AS artist,
        s.artist_id,
        ap.user_id AS artist_user_id,
        s.duration_seconds AS duration,
        s.audio_url,
        COALESCE(s.cover_image_url, al.cover_image_url) AS cover_image_url,
        COUNT(lh.id) AS play_count
    FROM
        songs s
    JOIN
        listening_history lh ON s.id = lh.song_id
    LEFT JOIN
        artists a ON s.artist_id = a.id
    LEFT JOIN
        artist_profiles ap ON a.id = ap.artist_id
    LEFT JOIN
        albums al ON s.album_id = al.id
    WHERE
        lh.listened_at >= NOW() - INTERVAL '12 hours'
    GROUP BY
        s.id, s.title, a.name, s.duration_seconds, s.audio_url, s.cover_image_url, al.cover_image_url, ap.user_id
    ORDER BY
        play_count DESC
    LIMIT 25;
END;
$$;

-- Grant execute permissions to all users
GRANT EXECUTE ON FUNCTION public.get_top_songs_last_12_hours() TO anon;
GRANT EXECUTE ON FUNCTION public.get_top_songs_last_12_hours() TO authenticated;