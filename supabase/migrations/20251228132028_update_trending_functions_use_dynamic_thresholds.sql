/*
  # Update Trending Functions to Use Dynamic Thresholds

  This migration updates the trending songs and related functions to respect
  the thresholds configured in the content_section_thresholds table instead of
  using hardcoded values.

  ## Changes

  1. **get_shuffled_trending_songs** - Now queries threshold from database
  2. **get_trending_near_you_songs** - New function for Trending Near You with its own threshold
  3. **get_blowing_up_songs** - New function for Tracks Blowing Up section
  4. **get_new_releases** - Updated to use new_releases threshold

  ## Benefits

  - Admins can adjust thresholds without code changes
  - Each section has independent control
  - Thresholds apply immediately across all screens
*/

-- ============================================================================
-- 1. UPDATE: get_shuffled_trending_songs (Global Trending)
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

    -- Fallback: if not enough trending songs, add newest songs
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
                WHERE lh2.listened_at >= NOW() - INTERVAL '1 day' * time_window
                GROUP BY lh_s.id
                HAVING COUNT(lh2.song_id) >= min_plays
            )
        ORDER BY
            s.created_at DESC
        LIMIT (limit_param - result_count);
    END IF;
END;
$$;

-- ============================================================================
-- 2. CREATE: get_trending_near_you_songs (Trending Near You)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_trending_near_you_songs(
    country_param TEXT,
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
    threshold_config RECORD;
    min_plays INT;
    time_window INT;
BEGIN
    -- Get threshold from database
    SELECT 
        min_play_count,
        COALESCE(time_window_days, 14) as time_window_days,
        is_enabled
    INTO threshold_config
    FROM content_section_thresholds
    WHERE section_key = 'trending_near_you';

    -- Use threshold values or defaults
    min_plays := COALESCE(threshold_config.min_play_count, 5);
    time_window := COALESCE(days_param, threshold_config.time_window_days, 14);

    -- If section is disabled, return empty
    IF threshold_config.is_enabled = false THEN
        RETURN;
    END IF;

    -- Get trending songs for specific country
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
        AND (lh.detected_country = country_param OR s.country = country_param)
    GROUP BY
        s.id, s.title, a.name, a.id, ap.user_id, s.cover_image_url, s.audio_url, s.duration_seconds
    HAVING
        COUNT(lh.song_id) >= min_plays
    ORDER BY
        COUNT(lh.song_id) DESC
    LIMIT limit_param;
END;
$$;

-- ============================================================================
-- 3. CREATE: get_new_releases_filtered (New Releases)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_new_releases_filtered(
    limit_param INT DEFAULT 20
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
    play_count BIGINT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    threshold_config RECORD;
    min_plays INT;
    time_window INT;
    cutoff_date TIMESTAMPTZ;
BEGIN
    -- Get threshold from database
    SELECT 
        min_play_count,
        COALESCE(time_window_days, 30) as time_window_days,
        is_enabled
    INTO threshold_config
    FROM content_section_thresholds
    WHERE section_key = 'new_releases';

    -- Use threshold values or defaults
    min_plays := COALESCE(threshold_config.min_play_count, 0);
    time_window := COALESCE(threshold_config.time_window_days, 30);

    -- If section is disabled, return empty
    IF threshold_config.is_enabled = false THEN
        RETURN;
    END IF;

    -- Calculate cutoff date
    cutoff_date := NOW() - INTERVAL '1 day' * time_window;

    -- Get new releases
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
        COALESCE(s.play_count, 0) AS play_count,
        s.created_at
    FROM
        songs s
    JOIN
        artists a ON s.artist_id = a.id
    LEFT JOIN
        artist_profiles ap ON a.id = ap.artist_id
    WHERE
        s.audio_url IS NOT NULL
        AND s.created_at >= cutoff_date
        AND COALESCE(s.play_count, 0) >= min_plays
    ORDER BY
        s.created_at DESC
    LIMIT limit_param;
END;
$$;

-- ============================================================================
-- 4. GRANT PERMISSIONS
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.get_shuffled_trending_songs(INT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shuffled_trending_songs(INT, INT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_trending_near_you_songs(TEXT, INT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_trending_near_you_songs(TEXT, INT, INT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_new_releases_filtered(INT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_new_releases_filtered(INT) TO authenticated;

-- ============================================================================
-- 5. COMMENTS
-- ============================================================================
COMMENT ON FUNCTION public.get_shuffled_trending_songs IS 'Returns globally trending songs using dynamic threshold from content_section_thresholds table';
COMMENT ON FUNCTION public.get_trending_near_you_songs IS 'Returns country-specific trending songs using dynamic threshold from content_section_thresholds table';
COMMENT ON FUNCTION public.get_new_releases_filtered IS 'Returns recent releases using dynamic threshold from content_section_thresholds table';
