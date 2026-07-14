/*
  # Exclude Album Tracks from Trending and New Releases

  1. Changes
    - Updates `get_shuffled_trending_songs` function to exclude songs that are part of albums
    - Only standalone singles (songs where album_id IS NULL) will appear in trending
    - This prevents album tracks from appearing in the New Releases and Trending sections
    - Album tracks should only be accessible through their albums

  2. Security
    - No changes to security policies
    - Function remains accessible to all users (anon and authenticated)
*/

-- Update get_shuffled_trending_songs to exclude album tracks
CREATE OR REPLACE FUNCTION public.get_shuffled_trending_songs(
    days_param INT DEFAULT 14,
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
SET search_path = public
AS $$
DECLARE
    time_seed DOUBLE PRECISION;
BEGIN
    -- Calculate seed based on 10-minute intervals
    -- This ensures all users see the same order within a 10-minute window
    time_seed := (floor(extract(epoch from now()) / 600)::bigint % 2147483647) / 2147483647.0;

    -- Set the seed for deterministic randomization
    PERFORM setseed(time_seed);

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
        AND s.album_id IS NULL  -- Exclude album tracks
    GROUP BY
        s.id, s.title, a.name, a.id, ap.user_id, s.cover_image_url, s.audio_url, s.duration_seconds
    HAVING
        COUNT(lh.song_id) >= 50
    ORDER BY
        random()  -- Shuffled order based on time seed
    LIMIT limit_param;
END;
$$;

COMMENT ON FUNCTION public.get_shuffled_trending_songs IS 'Returns trending standalone songs (excluding album tracks) from the last N days (default 14) with at least 50 play counts, in a shuffled order that changes every 10 minutes.';
