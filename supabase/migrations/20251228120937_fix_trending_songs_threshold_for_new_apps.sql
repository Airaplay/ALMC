/*
  # Fix Trending Songs Threshold for New Apps

  1. Changes
    - Lowers minimum play count threshold from 50 to 5 plays
    - This allows trending songs to show on new apps with limited data
    - Adds fallback to show newest songs when insufficient trending data exists
    - Makes the function more resilient for apps in early stages

  2. Behavior
    - First tries to get songs with 5+ plays in last 14 days
    - If insufficient results, falls back to newest songs with audio URLs
    - Always returns results so the section never appears empty

  3. Security
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
SET search_path = public
AS $$
DECLARE
    time_seed DOUBLE PRECISION;
    result_count INT;
BEGIN
    -- Calculate seed based on 10-minute intervals
    -- This ensures all users see the same order within a 10-minute window
    time_seed := (floor(extract(epoch from now()) / 600)::bigint % 2147483647) / 2147483647.0;

    -- Set the seed for deterministic randomization
    PERFORM setseed(time_seed);

    -- Try to get trending songs (lowered threshold to 5 plays)
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
        COUNT(lh.song_id) >= 5  -- Lowered from 50 to 5
    ORDER BY
        random()  -- Shuffled order based on time seed
    LIMIT limit_param;

    -- Check if we got enough results
    GET DIAGNOSTICS result_count = ROW_COUNT;

    -- If we didn't get enough trending songs, add fallback with newest songs
    IF result_count < (limit_param / 2) THEN
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
            0::BIGINT AS play_count
        FROM
            songs s
        JOIN
            artists a ON s.artist_id = a.id
        LEFT JOIN
            artist_profiles ap ON a.id = ap.artist_id
        WHERE
            s.audio_url IS NOT NULL
            AND s.id NOT IN (
                SELECT lh_s.id
                FROM listening_history lh2
                JOIN songs lh_s ON lh2.song_id = lh_s.id
                WHERE lh2.listened_at >= NOW() - INTERVAL '1 day' * days_param
                GROUP BY lh_s.id
                HAVING COUNT(lh2.song_id) >= 5
            )
        ORDER BY
            s.created_at DESC
        LIMIT (limit_param - result_count);
    END IF;
END;
$$;

-- Ensure proper permissions
GRANT EXECUTE ON FUNCTION public.get_shuffled_trending_songs(INT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shuffled_trending_songs(INT, INT) TO authenticated;

COMMENT ON FUNCTION public.get_shuffled_trending_songs IS 'Returns trending songs from the last N days (default 14) with at least 5 play counts, in a shuffled order that changes every 10 minutes. Falls back to newest songs if insufficient trending data.';
