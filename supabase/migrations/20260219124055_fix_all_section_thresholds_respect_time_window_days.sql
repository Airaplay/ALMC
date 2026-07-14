/*
  # Fix all section DB functions to fully respect admin threshold settings

  ## Problems Fixed

  1. get_trending_near_you_songs
     - Was ignoring time_window_days from content_section_thresholds
     - days_param was hardcoded to 14 from the frontend; now the DB reads it from thresholds
     - days_param still accepted as override but defaults to the admin-configured value

  2. get_trending_albums
     - Was ignoring time_window_days from content_section_thresholds
     - days_param was hardcoded to 30; now defaults to admin-configured value
     - Also uses min_play_count for tier fallback scaling

  3. get_shuffled_trending_songs
     - days_param was overriding the DB threshold value when passed as 14 from frontend
     - Now when days_param is NULL (frontend passes NULL), DB uses threshold value
     - Existing logic already reads time_window_days correctly when days_param is NULL

  ## Important Notes
  - All functions still accept days_param as an explicit override for backward compat
  - When days_param is NULL, each function now uses the admin-configured time_window_days
  - Fallback tiers scale relative to the configured threshold (half-threshold for tier 2)
*/

-- ============================================================
-- 1. Fix get_trending_near_you_songs to read time_window_days
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_trending_near_you_songs(
  country_param text,
  days_param integer DEFAULT NULL,
  limit_param integer DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  title text,
  artist text,
  artist_id uuid,
  artist_user_id uuid,
  cover_image_url text,
  audio_url text,
  duration_seconds integer,
  play_count bigint,
  country text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  threshold_count integer;
  time_window integer;
  result_count integer;
BEGIN
  -- Read both min_play_count and time_window_days from admin settings
  SELECT min_play_count, COALESCE(time_window_days, 14)
  INTO threshold_count, time_window
  FROM content_section_thresholds
  WHERE section_key = 'trending_near_you' AND is_enabled = true;

  -- Defaults if not configured
  IF threshold_count IS NULL THEN threshold_count := 10; END IF;
  IF time_window IS NULL THEN time_window := 14; END IF;

  -- Allow explicit override from caller, otherwise use admin-configured value
  IF days_param IS NOT NULL THEN
    time_window := days_param;
  END IF;

  -- Primary: songs meeting admin threshold
  RETURN QUERY
  SELECT
    s.id,
    s.title,
    COALESCE(a.name, ap.stage_name, u.display_name, 'Unknown Artist') as artist,
    a.id as artist_id,
    ap.user_id as artist_user_id,
    s.cover_image_url,
    s.audio_url,
    s.duration_seconds,
    COUNT(lh.id) as play_count,
    s.country
  FROM songs s
  LEFT JOIN artists a ON s.artist_id = a.id
  LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
  LEFT JOIN users u ON ap.user_id = u.id
  LEFT JOIN listening_history lh ON s.id = lh.song_id
    AND lh.listened_at >= NOW() - (time_window || ' days')::interval
  WHERE s.country = country_param
    AND s.audio_url IS NOT NULL
    AND s.album_id IS NULL
  GROUP BY s.id, s.title, a.name, a.id, ap.stage_name, ap.user_id, u.display_name,
    s.cover_image_url, s.audio_url, s.duration_seconds, s.country
  HAVING COUNT(lh.id) >= threshold_count
  ORDER BY COUNT(lh.id) DESC
  LIMIT limit_param;

  GET DIAGNOSTICS result_count = ROW_COUNT;

  -- Fallback: lower to 1 play minimum, exclude already-returned songs
  IF result_count < 10 THEN
    RETURN QUERY
    WITH already_returned AS (
      SELECT s2.id as song_id
      FROM songs s2
      LEFT JOIN listening_history lh2 ON s2.id = lh2.song_id
        AND lh2.listened_at >= NOW() - (time_window || ' days')::interval
      WHERE s2.country = country_param
        AND s2.audio_url IS NOT NULL
        AND s2.album_id IS NULL
      GROUP BY s2.id
      HAVING COUNT(lh2.id) >= threshold_count
    )
    SELECT
      s.id,
      s.title,
      COALESCE(a.name, ap.stage_name, u.display_name, 'Unknown Artist') as artist,
      a.id as artist_id,
      ap.user_id as artist_user_id,
      s.cover_image_url,
      s.audio_url,
      s.duration_seconds,
      COUNT(lh.id) as play_count,
      s.country
    FROM songs s
    LEFT JOIN artists a ON s.artist_id = a.id
    LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
    LEFT JOIN users u ON ap.user_id = u.id
    LEFT JOIN listening_history lh ON s.id = lh.song_id
      AND lh.listened_at >= NOW() - (time_window || ' days')::interval
    WHERE s.country = country_param
      AND s.audio_url IS NOT NULL
      AND s.album_id IS NULL
      AND s.id NOT IN (SELECT song_id FROM already_returned)
    GROUP BY s.id, s.title, a.name, a.id, ap.stage_name, ap.user_id, u.display_name,
      s.cover_image_url, s.audio_url, s.duration_seconds, s.country
    HAVING COUNT(lh.id) >= 1
    ORDER BY COUNT(lh.id) DESC
    LIMIT (limit_param - result_count);
  END IF;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_trending_near_you_songs(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trending_near_you_songs(text, integer, integer) TO anon;


-- ============================================================
-- 2. Fix get_trending_albums to read time_window_days
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_trending_albums(
  days_param integer DEFAULT NULL,
  limit_param integer DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  title text,
  cover_image_url text,
  release_date date,
  description text,
  artist_id uuid,
  artist_name text,
  artist_stage_name text,
  artist_user_id uuid,
  total_plays bigint,
  track_count bigint,
  created_at timestamptz,
  tier integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  threshold_count integer;
  time_window integer;
BEGIN
  -- Read both min_play_count and time_window_days from admin settings
  SELECT min_play_count, COALESCE(time_window_days, 30)
  INTO threshold_count, time_window
  FROM content_section_thresholds
  WHERE section_key = 'trending_albums' AND is_enabled = true;

  -- Defaults if not configured
  IF threshold_count IS NULL THEN threshold_count := 0; END IF;
  IF time_window IS NULL THEN time_window := 30; END IF;

  -- Allow explicit override from caller
  IF days_param IS NOT NULL THEN
    time_window := days_param;
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.title,
    a.cover_image_url,
    a.release_date,
    a.description,
    art.id as artist_id,
    art.name as artist_name,
    ap.stage_name as artist_stage_name,
    ap.user_id as artist_user_id,
    COALESCE(SUM(s.play_count), 0) as total_plays,
    COUNT(s.id) as track_count,
    a.created_at,
    CASE
      WHEN threshold_count > 0 AND COALESCE(SUM(s.play_count), 0) >= threshold_count THEN 1
      WHEN COALESCE(SUM(s.play_count), 0) >= GREATEST(CEIL(threshold_count::numeric / 2), 10) THEN 2
      WHEN COALESCE(SUM(s.play_count), 0) >= 1 THEN 3
      ELSE 4
    END as tier
  FROM albums a
  LEFT JOIN artists art ON a.artist_id = art.id
  LEFT JOIN artist_profiles ap ON art.id = ap.artist_id
  LEFT JOIN songs s ON a.id = s.album_id
  WHERE a.created_at >= NOW() - (time_window || ' days')::interval
  GROUP BY a.id, a.title, a.cover_image_url, a.release_date, a.description,
    art.id, art.name, ap.stage_name, ap.user_id, a.created_at
  HAVING COALESCE(SUM(s.play_count), 0) >= 1 OR threshold_count = 0
  ORDER BY tier ASC, total_plays DESC, a.created_at DESC
  LIMIT limit_param;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_trending_albums(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trending_albums(integer, integer) TO anon;
