/*
  # Fix Trending Fallback to Require Minimum Plays

  ## Problem
  The current fallback in get_shuffled_trending_songs returns songs with 0 plays,
  which defeats the purpose of a "Trending" section.

  ## Solution
  Update the fallback to:
  1. Only include songs with at least 1 actual play
  2. Order by play_count DESC (show most played "rising" songs first)
  3. Use real play counts from listening_history, not hardcoded 0
  4. Still fills gaps when there aren't enough songs meeting the main threshold

  ## Benefits
  - "Trending" section maintains credibility (only shows songs people actually listened to)
  - Helps new creators gain visibility when getting initial traction
  - Prevents empty sections while app is growing
  - Admin can still control main threshold independently
*/

-- ============================================================================
-- UPDATE: get_shuffled_trending_songs with Smart Fallback
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_shuffled_trending_songs(
    days_param INT DEFAULT NULL,
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
    threshold_config RECORD;
    min_plays INT;
    time_window INT;
    fallback_min_plays INT;
BEGIN
    -- Get threshold from database
    SELECT
        min_play_count,
        COALESCE(time_window_days, 14) as time_window_days,
        is_enabled
    INTO threshold_config
    FROM content_section_thresholds
    WHERE section_key = 'global_trending';

    -- Use threshold values or defaults
    min_plays := COALESCE(threshold_config.min_play_count, 5);
    time_window := COALESCE(days_param, threshold_config.time_window_days, 14);

    -- Fallback minimum: at least 1 play (never show completely unplayed songs)
    fallback_min_plays := 1;

    -- If section is disabled, return empty
    IF threshold_config.is_enabled = false THEN
        RETURN;
    END IF;

    -- Calculate seed based on 10-minute intervals
    time_seed := (floor(extract(epoch from now()) / 600)::bigint % 2147483647) / 2147483647.0;
    PERFORM setseed(time_seed);

    -- Get trending songs with dynamic threshold
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
        lh.listened_at >= NOW() - INTERVAL '1 day' * time_window
        AND s.audio_url IS NOT NULL
    GROUP BY
        s.id, s.title, a.name, a.id, ap.user_id, s.cover_image_url, s.audio_url, s.duration_seconds
    HAVING
        COUNT(lh.song_id) >= min_plays
    ORDER BY
        random()
    LIMIT limit_param;

    GET DIAGNOSTICS result_count = ROW_COUNT;

    -- Smart Fallback: if not enough trending songs, add "rising" songs with actual plays
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
            lh.listened_at >= NOW() - INTERVAL '1 day' * time_window
            AND s.audio_url IS NOT NULL
            AND s.id NOT IN (
                -- Exclude songs already included in main results
                SELECT lh_s.id
                FROM listening_history lh2
                JOIN songs lh_s ON lh2.song_id = lh_s.id
                WHERE lh2.listened_at >= NOW() - INTERVAL '1 day' * time_window
                GROUP BY lh_s.id
                HAVING COUNT(lh2.song_id) >= min_plays
            )
        GROUP BY
            s.id, s.title, a.name, a.id, ap.user_id, s.cover_image_url, s.audio_url, s.duration_seconds
        HAVING
            COUNT(lh.song_id) >= fallback_min_plays  -- Must have at least 1 play
        ORDER BY
            COUNT(lh.song_id) DESC,  -- Most played "rising" songs first
            s.created_at DESC         -- Then newest
        LIMIT (limit_param - result_count);
    END IF;
END;
$$;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.get_shuffled_trending_songs(INT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shuffled_trending_songs(INT, INT) TO authenticated;

-- ============================================================================
-- COMMENT
-- ============================================================================
COMMENT ON FUNCTION public.get_shuffled_trending_songs IS 'Returns globally trending songs using dynamic threshold with smart fallback that only shows songs with actual plays (min 1 play)';
