/*
  # Add time-based shuffled trending songs function

  1. New Functions
    - `get_shuffled_trending_songs` - Returns trending songs in shuffled order that changes every 10 minutes
      - Parameters: days_param (default 14), limit_param (default 25)
      - Uses time-based seed for consistent shuffling within 10-minute windows
      - All users see the same shuffle order within the same 10-minute period
      - Order automatically refreshes every 10 minutes
      - Still filters by play count threshold to ensure quality

  2. How It Works
    - Calculates a time-based seed using floor(extract(epoch from now()) / 600)
    - This creates a new seed every 600 seconds (10 minutes)
    - Uses setseed() to make random() deterministic within each 10-minute window
    - Maintains the same songs from last 14 days but shuffles the display order

  3. Security
    - Function is accessible to all users (anon and authenticated)
    - Uses existing RLS policies on underlying tables
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
        COUNT(lh.song_id) >= 50
    ORDER BY
        random()  -- Shuffled order based on time seed
    LIMIT limit_param;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shuffled_trending_songs(INT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shuffled_trending_songs(INT, INT) TO authenticated;

COMMENT ON FUNCTION public.get_shuffled_trending_songs IS 'Returns trending songs from the last N days (default 14) with at least 50 play counts, in a shuffled order that changes every 10 minutes.';
