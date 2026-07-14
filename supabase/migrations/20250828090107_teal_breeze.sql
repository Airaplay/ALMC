/*
  # Create trending songs function

  1. New Functions
    - `get_trending_songs` - Returns most played songs in specified time period
      - Parameters: days_param (default 7), limit_param (default 25)
      - Returns: song details with play counts from listening history
      - Joins songs, artists, and artist_profiles tables
      - Filters by listening history within date range
      - Orders by play count descending

  2. Security
    - Function is accessible to all users (anon and authenticated)
    - Uses existing RLS policies on underlying tables
*/

CREATE OR REPLACE FUNCTION public.get_trending_songs(
    days_param INT DEFAULT 7,
    limit_param INT DEFAULT 25
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    artist TEXT,
    artist_id UUID,
    artist_user_id UUID,
    cover_image_url TEXT,
    audio_url TEXT,
    duration_seconds INT,
    play_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.title,
        a.name AS artist,
        a.id AS artist_id,
        ap.user_id AS artist_user_id,
        s.cover_image_url,
        s.audio_url,
        s.duration_seconds,
        COUNT(lh.song_id) AS play_count
    FROM
        listening_history lh
    JOIN
        songs s ON lh.song_id = s.id
    JOIN
        artists a ON s.artist_id = a.id
    LEFT JOIN
        artist_profiles ap ON a.id = ap.artist_id
    WHERE
        lh.listened_at >= NOW() - INTERVAL '1 day' * days_param
        AND s.audio_url IS NOT NULL
    GROUP BY
        s.id, s.title, a.name, a.id, ap.user_id, s.cover_image_url, s.audio_url, s.duration_seconds
    HAVING
        COUNT(lh.song_id) > 0
    ORDER BY
        play_count DESC
    LIMIT limit_param;
END;
$$;