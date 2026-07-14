/*
  # Unified play count: Trending Near You returns songs.play_count

  ## Problem
  - get_trending_near_you_songs returned COUNT(lh.id) (plays in time window) as play_count
  - Trending section shows songs.play_count (canonical total) from manual_trending_songs join
  - Same song showed different numbers (e.g. 46 vs 12) in different sections

  ## Fix
  - RPC still uses time-window count (COUNT(lh.id)) for HAVING and ORDER BY (trending logic)
  - Return COALESCE(s.play_count, 0) as play_count so UI shows the same total everywhere
*/

DROP FUNCTION IF EXISTS get_trending_near_you_songs(text, integer, integer);

CREATE OR REPLACE FUNCTION get_trending_near_you_songs(
  country_param text,
  days_param integer DEFAULT 14,
  limit_param integer DEFAULT 50
)
RETURNS TABLE (
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
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  threshold_count integer;
  result_count integer;
BEGIN
  SELECT min_play_count INTO threshold_count
  FROM content_section_thresholds
  WHERE section_key = 'trending_near_you' AND is_enabled = true;

  IF threshold_count IS NULL THEN
    threshold_count := 10;
  END IF;

  -- Return canonical songs.play_count for display; use window count only for filter/order
  RETURN QUERY
  SELECT
    s.id,
    s.title,
    COALESCE(
      a.name,
      ap.stage_name,
      u.display_name,
      'Unknown Artist'
    ) AS artist,
    a.id AS artist_id,
    ap.user_id AS artist_user_id,
    s.cover_image_url,
    s.audio_url,
    s.duration_seconds,
    COALESCE(s.play_count, 0)::bigint AS play_count,
    s.country
  FROM songs s
  LEFT JOIN artists a ON s.artist_id = a.id
  LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
  LEFT JOIN users u ON ap.user_id = u.id
  LEFT JOIN listening_history lh ON s.id = lh.song_id
    AND lh.listened_at >= NOW() - (COALESCE(days_param, 14) || ' days')::interval
  WHERE s.country = country_param
    AND s.audio_url IS NOT NULL
    AND s.album_id IS NULL
  GROUP BY s.id, s.title, a.name, a.id, ap.stage_name, ap.user_id, u.display_name,
           s.cover_image_url, s.audio_url, s.duration_seconds, s.country, s.play_count
  HAVING COUNT(lh.id) >= threshold_count
  ORDER BY COUNT(lh.id) DESC
  LIMIT limit_param;

  GET DIAGNOSTICS result_count = ROW_COUNT;

  IF result_count < 10 THEN
    RETURN QUERY
    WITH already_returned AS (
      SELECT s.id AS song_id
      FROM songs s
      LEFT JOIN listening_history lh ON s.id = lh.song_id
        AND lh.listened_at >= NOW() - (COALESCE(days_param, 14) || ' days')::interval
      WHERE s.country = country_param
        AND s.audio_url IS NOT NULL
        AND s.album_id IS NULL
      GROUP BY s.id
      HAVING COUNT(lh.id) >= threshold_count
    )
    SELECT
      s.id,
      s.title,
      COALESCE(
        a.name,
        ap.stage_name,
        u.display_name,
        'Unknown Artist'
      ) AS artist,
      a.id AS artist_id,
      ap.user_id AS artist_user_id,
      s.cover_image_url,
      s.audio_url,
      s.duration_seconds,
      COALESCE(s.play_count, 0)::bigint AS play_count,
      s.country
    FROM songs s
    LEFT JOIN artists a ON s.artist_id = a.id
    LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
    LEFT JOIN users u ON ap.user_id = u.id
    LEFT JOIN listening_history lh ON s.id = lh.song_id
      AND lh.listened_at >= NOW() - (COALESCE(days_param, 14) || ' days')::interval
    WHERE s.country = country_param
      AND s.audio_url IS NOT NULL
      AND s.album_id IS NULL
      AND s.id NOT IN (SELECT song_id FROM already_returned)
    GROUP BY s.id, s.title, a.name, a.id, ap.stage_name, ap.user_id, u.display_name,
             s.cover_image_url, s.audio_url, s.duration_seconds, s.country, s.play_count
    HAVING COUNT(lh.id) >= 1
    ORDER BY COUNT(lh.id) DESC
    LIMIT (limit_param - result_count);
  END IF;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION get_trending_near_you_songs(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_trending_near_you_songs(text, integer, integer) TO anon;

COMMENT ON FUNCTION get_trending_near_you_songs IS 'Returns country-specific trending songs. Uses time-window plays for ordering/filtering but returns canonical songs.play_count for unified display across sections.';
