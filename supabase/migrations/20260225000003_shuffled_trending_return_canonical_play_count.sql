/*
  # Unified play count: get_shuffled_trending_songs returns songs.play_count

  ## Problem
  - get_shuffled_trending_songs returned COUNT(lh.song_id) (plays in time window) as play_count
  - Same song could show different counts in Trending (manual list = songs.play_count) vs
    Trending View All when using RPC (window count)

  ## Fix
  - Use time-window count only for HAVING and ORDER BY (trending logic)
  - Return COALESCE(s.play_count, 0) so UI shows canonical total everywhere
*/

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
    SELECT
        min_play_count,
        COALESCE(time_window_days, 14) as time_window_days,
        is_enabled
    INTO threshold_config
    FROM content_section_thresholds
    WHERE section_key = 'global_trending';

    min_plays := COALESCE(threshold_config.min_play_count, 5);
    time_window := COALESCE(days_param, threshold_config.time_window_days, 14);
    fallback_min_plays := 1;

    IF threshold_config.is_enabled = false THEN
        RETURN;
    END IF;

    time_seed := (floor(extract(epoch from now()) / 600)::bigint % 2147483647) / 2147483647.0;
    PERFORM setseed(time_seed);

    -- Return canonical songs.play_count for display; use window count for filter/order only
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
        COALESCE(s.play_count, 0)::bigint AS play_count
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
        s.id, s.title, a.name, a.id, ap.user_id, s.cover_image_url, s.audio_url, s.duration_seconds, s.play_count
    HAVING
        COUNT(lh.song_id) >= min_plays
    ORDER BY
        random()
    LIMIT limit_param;

    GET DIAGNOSTICS result_count = ROW_COUNT;

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
            COALESCE(s.play_count, 0)::bigint AS play_count
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
                SELECT lh_s.id
                FROM listening_history lh2
                JOIN songs lh_s ON lh2.song_id = lh_s.id
                WHERE lh2.listened_at >= NOW() - INTERVAL '1 day' * time_window
                GROUP BY lh_s.id
                HAVING COUNT(lh2.song_id) >= min_plays
            )
        GROUP BY
            s.id, s.title, a.name, a.id, ap.user_id, s.cover_image_url, s.audio_url, s.duration_seconds, s.play_count
        HAVING
            COUNT(lh.song_id) >= fallback_min_plays
        ORDER BY
            COUNT(lh.song_id) DESC,
            s.created_at DESC
        LIMIT (limit_param - result_count);
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shuffled_trending_songs(INT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shuffled_trending_songs(INT, INT) TO authenticated;

COMMENT ON FUNCTION public.get_shuffled_trending_songs IS 'Returns globally trending songs. Uses time-window plays for ordering/filtering but returns canonical songs.play_count for unified display across sections.';
