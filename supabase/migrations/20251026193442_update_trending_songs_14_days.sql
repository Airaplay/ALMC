/*
  # Update trending songs timeframe to 14 days

  1. Changes
    - Updates `get_shuffled_trending_songs` function to use 14 days as default instead of 7 days
    - This allows trending songs to show content from the last 2 weeks instead of 1 week
    - Provides more diverse trending content for users

  2. Security
    - No changes to security policies
    - Function remains accessible to all users (anon and authenticated)
*/

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
    GROUP BY
        s.id, s.title, a.name, a.id, ap.user_id, s.cover_image_url, s.audio_url, s.duration_seconds
    HAVING
        COUNT(lh.song_id) > 0
    ORDER BY
        random()  -- Shuffled order based on time seed
    LIMIT limit_param;
END;
$$;

COMMENT ON FUNCTION public.get_shuffled_trending_songs IS 'Returns trending songs from the last N days (default 14) in a shuffled order that changes every 10 minutes. All users see the same shuffle order within each 10-minute window.';