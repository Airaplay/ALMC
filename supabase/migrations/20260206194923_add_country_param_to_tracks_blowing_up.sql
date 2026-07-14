/*
  # Add country parameter to get_tracks_blowing_up

  1. Changes
    - Add optional country_param to get_tracks_blowing_up function
    - When country is provided, local tracks are prioritized first
    - Global tracks fill remaining slots (local-first, global-fill pattern)
    - Backward compatible: NULL country returns global results as before

  2. Important Notes
    - Does not break existing callers (country_param defaults to NULL)
    - Uses songs.country field which is already populated on all 46 songs
    - Local songs get tier bonus (lower tier number = higher priority)
*/

DROP FUNCTION IF EXISTS public.get_tracks_blowing_up(integer);

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
  now_time timestamptz := NOW();
  thirty_min_ago timestamptz := now_time - interval '30 minutes';
  sixty_min_ago timestamptz := now_time - interval '60 minutes';
BEGIN
  SELECT min_play_count INTO threshold_count
  FROM content_section_thresholds
  WHERE section_key = 'tracks_blowing_up' AND is_enabled = true;

  IF threshold_count IS NULL THEN
    threshold_count := 5;
  END IF;

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
        WHERE lh.listened_at >= thirty_min_ago
        AND lh.listened_at <= now_time
        AND lh.is_validated = true
      ) as plays_last_30,
      COUNT(lh.id) FILTER (
        WHERE lh.listened_at >= sixty_min_ago
        AND lh.listened_at < thirty_min_ago
        AND lh.is_validated = true
      ) as plays_prev_30,
      CASE WHEN ms.song_id IS NOT NULL THEN true ELSE false END as is_manual_song,
      COALESCE(ms.display_order, 9999) as manual_order
    FROM songs s
    LEFT JOIN listening_history lh ON s.id = lh.song_id
    LEFT JOIN manual_songs ms ON s.id = ms.song_id
    WHERE s.audio_url IS NOT NULL
      AND s.created_at >= now_time - interval '7 days'
    GROUP BY s.id, s.title, s.artist_id, s.cover_image_url, s.audio_url,
      s.duration_seconds, s.play_count, s.featured_artists, s.created_at, s.country,
      ms.song_id, ms.display_order
  ),
  calculated_growth AS (
    SELECT
      sa.*,
      CASE
        WHEN sa.plays_prev_30 > 0 THEN
          ((sa.plays_last_30 - sa.plays_prev_30)::numeric / sa.plays_prev_30) * 100
        WHEN sa.plays_last_30 > 0 THEN 999
        ELSE 0
      END as growth_pct,
      CASE
        WHEN sa.is_manual_song THEN 0
        WHEN sa.plays_last_30 >= threshold_count THEN 1
        WHEN sa.plays_last_30 >= 3 THEN 2
        WHEN sa.plays_last_30 >= 1 THEN 3
        WHEN sa.play_count > 0 THEN 4
        ELSE 5
      END as song_tier,
      CASE
        WHEN country_param IS NOT NULL AND sa.song_country = country_param THEN true
        ELSE false
      END as is_local_song
    FROM song_activity sa
    WHERE sa.plays_last_30 > 0
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
    cg.plays_last_30 as plays_last_30min,
    cg.plays_prev_30 as plays_prev_30min,
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
    cg.plays_last_30 DESC,
    cg.growth_pct DESC,
    cg.created_at DESC
  LIMIT limit_param;

  RETURN;
END;
$function$;
