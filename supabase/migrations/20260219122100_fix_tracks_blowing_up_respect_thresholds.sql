/*
  # Fix get_tracks_blowing_up to respect admin threshold settings

  1. Problems Fixed
    - Function was hardcoded to 30-minute windows, ignoring admin's time_window_days setting
    - Function filtered songs to only those created within the last 7 days (broke for older active songs)
    - Tier logic hardcoded fallback plays (3, 1) regardless of threshold

  2. Changes
    - Read time_window_days from content_section_thresholds and convert to an interval
    - Remove the 7-day song creation age filter so any song with recent plays qualifies
    - Use the threshold's min_play_count properly across all tiers
    - Keep all existing tier/fallback logic and country param support
*/

CREATE OR REPLACE FUNCTION public.get_tracks_blowing_up(
  limit_param integer DEFAULT 20,
  country_param text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  title text,
  artist_id uuid,
  artist_name text,
  artist_stage_name text,
  artist_user_id uuid,
  cover_image_url text,
  audio_url text,
  duration_seconds integer,
  play_count integer,
  featured_artists text[],
  plays_last_30min bigint,
  plays_prev_30min bigint,
  growth_percentage numeric,
  tier integer,
  is_manual boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  threshold_count integer;
  window_days integer;
  now_time timestamptz := NOW();
  window_start timestamptz;
  prev_window_start timestamptz;
BEGIN
  -- Read both threshold and time window from admin settings
  SELECT min_play_count, COALESCE(time_window_days, 1)
  INTO threshold_count, window_days
  FROM content_section_thresholds
  WHERE section_key IN ('tracks_blowing_up', 'blowing_up') AND is_enabled = true
  ORDER BY CASE section_key WHEN 'tracks_blowing_up' THEN 0 ELSE 1 END
  LIMIT 1;

  -- Default values if not configured
  IF threshold_count IS NULL THEN
    threshold_count := 5;
  END IF;
  IF window_days IS NULL THEN
    window_days := 1;
  END IF;

  -- Calculate time windows based on admin-configured days
  window_start := now_time - (window_days || ' days')::interval;
  prev_window_start := now_time - (window_days * 2 || ' days')::interval;

  RETURN QUERY
  WITH manual_songs AS (
    SELECT
      mbs.song_id,
      mbs.display_order
    FROM manual_blowing_up_songs mbs
    WHERE mbs.is_active = true
  ),
  song_activity AS (
    SELECT
      s.id,
      s.title,
      s.artist_id,
      s.cover_image_url,
      s.audio_url,
      s.duration_seconds,
      s.play_count,
      s.featured_artists,
      s.created_at,
      s.country as song_country,
      COUNT(lh.id) FILTER (
        WHERE lh.listened_at >= window_start
        AND lh.listened_at <= now_time
        AND lh.is_validated = true
      ) as plays_last_window,
      COUNT(lh.id) FILTER (
        WHERE lh.listened_at >= prev_window_start
        AND lh.listened_at < window_start
        AND lh.is_validated = true
      ) as plays_prev_window,
      CASE WHEN ms.song_id IS NOT NULL THEN true ELSE false END as is_manual_song,
      COALESCE(ms.display_order, 9999) as manual_order
    FROM songs s
    LEFT JOIN listening_history lh ON s.id = lh.song_id
    LEFT JOIN manual_songs ms ON s.id = ms.song_id
    WHERE s.audio_url IS NOT NULL
    GROUP BY s.id, s.title, s.artist_id, s.cover_image_url, s.audio_url,
      s.duration_seconds, s.play_count, s.featured_artists, s.created_at, s.country,
      ms.song_id, ms.display_order
  ),
  calculated_growth AS (
    SELECT
      sa.*,
      CASE
        WHEN sa.plays_prev_window > 0 THEN
          ((sa.plays_last_window - sa.plays_prev_window)::numeric / sa.plays_prev_window) * 100
        WHEN sa.plays_last_window > 0 THEN 999
        ELSE 0
      END as growth_pct,
      CASE
        WHEN sa.is_manual_song THEN 0
        WHEN sa.plays_last_window >= threshold_count THEN 1
        WHEN sa.plays_last_window >= GREATEST(CEIL(threshold_count::numeric / 2), 1) THEN 2
        WHEN sa.plays_last_window >= 1 THEN 3
        WHEN sa.play_count > 0 THEN 4
        ELSE 5
      END as song_tier,
      CASE
        WHEN country_param IS NOT NULL AND sa.song_country = country_param THEN true
        ELSE false
      END as is_local_song
    FROM song_activity sa
    WHERE sa.plays_last_window > 0
      OR sa.is_manual_song = true
      OR sa.play_count > 0
  )
  SELECT
    cg.id,
    cg.title,
    cg.artist_id,
    art.name as artist_name,
    ap.stage_name as artist_stage_name,
    ap.user_id as artist_user_id,
    cg.cover_image_url,
    cg.audio_url,
    cg.duration_seconds,
    cg.play_count,
    cg.featured_artists,
    cg.plays_last_window as plays_last_30min,
    cg.plays_prev_window as plays_prev_30min,
    ROUND(cg.growth_pct, 0) as growth_percentage,
    cg.song_tier as tier,
    cg.is_manual_song as is_manual
  FROM calculated_growth cg
  LEFT JOIN artists art ON cg.artist_id = art.id
  LEFT JOIN artist_profiles ap ON art.id = ap.artist_id
  WHERE cg.audio_url IS NOT NULL
  ORDER BY
    cg.is_local_song DESC,
    cg.song_tier ASC,
    cg.manual_order ASC,
    cg.plays_last_window DESC,
    cg.growth_pct DESC,
    cg.created_at DESC
  LIMIT limit_param;

  RETURN;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tracks_blowing_up(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tracks_blowing_up(integer, text) TO anon;
