-- ALMC Phase 2: Organization dashboard — period metrics, deltas, growth chart,
-- top 3 artists, fastest-growing artist, and listeners.

DROP FUNCTION IF EXISTS public.get_organization_dashboard(uuid);

CREATE OR REPLACE FUNCTION public.get_organization_dashboard(
  p_org_id uuid,
  p_days int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_days int := GREATEST(LEAST(COALESCE(p_days, 30), 365), 1);
  v_period_end timestamptz := now();
  v_period_start timestamptz := v_period_end - make_interval(days => v_days);
  v_prev_start timestamptz := v_period_start - make_interval(days => v_days);
  v_total_artists int := 0;
  v_artists_added int := 0;
  v_total_streams bigint := 0;
  v_period_streams bigint := 0;
  v_prev_streams bigint := 0;
  v_period_listeners bigint := 0;
  v_prev_listeners bigint := 0;
  v_total_followers bigint := 0;
  v_total_songs int := 0;
  v_total_albums int := 0;
  v_total_videos int := 0;
  v_total_releases int := 0;
  v_total_revenue numeric := 0;
  v_period_revenue numeric := 0;
  v_prev_revenue numeric := 0;
  v_top_artists jsonb := '[]'::jsonb;
  v_fastest_artist jsonb := NULL;
  v_growth_chart jsonb := '[]'::jsonb;
  v_recent_activity jsonb := '[]'::jsonb;
  v_song_ids uuid[];
  v_content_ids uuid[];
  v_artist_ids uuid[];
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'analytics.view', v_user_id) THEN
    RAISE EXCEPTION 'Missing analytics.view permission';
  END IF;

  SELECT
    COALESCE(array_agg(DISTINCT s.id), ARRAY[]::uuid[]),
    COALESCE(array_agg(DISTINCT cu.id), ARRAY[]::uuid[]),
    COALESCE(array_agg(DISTINCT ap.artist_id), ARRAY[]::uuid[])
  INTO v_song_ids, v_content_ids, v_artist_ids
  FROM public.organization_artist_links oal
  JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
  LEFT JOIN public.artists a ON a.id = ap.artist_id
  LEFT JOIN public.songs s ON s.artist_id = a.id
  LEFT JOIN public.content_uploads cu ON cu.user_id = oal.user_id
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active';

  SELECT COUNT(*)::int
  INTO v_total_artists
  FROM public.organization_artist_links oal
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active';

  SELECT COUNT(*)::int
  INTO v_artists_added
  FROM public.organization_artist_links oal
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active'
    AND COALESCE(oal.linked_at, oal.created_at) >= v_period_start
    AND COALESCE(oal.linked_at, oal.created_at) < v_period_end;

  SELECT
    COALESCE(SUM(stream_stats.streams), 0),
    COALESCE(SUM(stream_stats.songs), 0),
    COALESCE(SUM(stream_stats.albums), 0),
    COALESCE(SUM(stream_stats.videos), 0),
    COALESCE(SUM(stream_stats.followers), 0),
    COALESCE(SUM(stream_stats.revenue), 0)
  INTO v_total_streams, v_total_songs, v_total_albums, v_total_videos, v_total_followers, v_total_revenue
  FROM (
    SELECT
      (
        COALESCE((
          SELECT SUM(s.play_count)::bigint
          FROM public.artist_profiles ap
          LEFT JOIN public.artists a ON a.id = ap.artist_id
          LEFT JOIN public.songs s ON s.artist_id = a.id
          WHERE ap.id = oal.artist_profile_id
        ), 0)
        + COALESCE((
          SELECT SUM(cu.play_count)::bigint
          FROM public.content_uploads cu
          WHERE cu.user_id = oal.user_id
        ), 0)
      ) AS streams,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.artist_profiles ap
        LEFT JOIN public.artists a ON a.id = ap.artist_id
        LEFT JOIN public.songs s ON s.artist_id = a.id
        WHERE ap.id = oal.artist_profile_id
      ), 0) AS songs,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.albums al
        JOIN public.artist_profiles ap ON ap.artist_id = al.artist_id
        WHERE ap.id = oal.artist_profile_id
      ), 0) AS albums,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.content_uploads cu
        WHERE cu.user_id = oal.user_id
          AND cu.content_type IN ('video', 'short_clip')
      ), 0) AS videos,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.user_follows uf
        WHERE uf.following_id = oal.user_id
      ), 0) AS followers,
      COALESCE(u.total_earnings, 0)::numeric AS revenue
    FROM public.organization_artist_links oal
    JOIN public.users u ON u.id = oal.user_id
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
  ) stream_stats;

  v_total_releases := v_total_songs + v_total_albums + v_total_videos;

  SELECT
    COALESCE((
      SELECT COUNT(*)::bigint
      FROM public.listening_history lh
      WHERE (
        (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
        OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
      )
      AND lh.listened_at >= v_period_start
      AND lh.listened_at < v_period_end
    ), 0)
    + COALESCE((
      SELECT COUNT(*)::bigint
      FROM public.video_playback_history vph
      WHERE cardinality(v_content_ids) > 0
        AND vph.content_id = ANY(v_content_ids)
        AND vph.watched_at >= v_period_start
        AND vph.watched_at < v_period_end
    ), 0)
  INTO v_period_streams;

  SELECT
    COALESCE((
      SELECT COUNT(*)::bigint
      FROM public.listening_history lh
      WHERE (
        (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
        OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
      )
      AND lh.listened_at >= v_prev_start
      AND lh.listened_at < v_period_start
    ), 0)
    + COALESCE((
      SELECT COUNT(*)::bigint
      FROM public.video_playback_history vph
      WHERE cardinality(v_content_ids) > 0
        AND vph.content_id = ANY(v_content_ids)
        AND vph.watched_at >= v_prev_start
        AND vph.watched_at < v_period_start
    ), 0)
  INTO v_prev_streams;

  SELECT COUNT(*)::bigint
  INTO v_period_listeners
  FROM (
    SELECT lh.user_id
    FROM public.listening_history lh
    WHERE lh.user_id IS NOT NULL
      AND (
        (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
        OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
      )
      AND lh.listened_at >= v_period_start
      AND lh.listened_at < v_period_end
    UNION
    SELECT vph.user_id
    FROM public.video_playback_history vph
    WHERE vph.user_id IS NOT NULL
      AND cardinality(v_content_ids) > 0
      AND vph.content_id = ANY(v_content_ids)
      AND vph.watched_at >= v_period_start
      AND vph.watched_at < v_period_end
  ) listeners;

  SELECT COUNT(*)::bigint
  INTO v_prev_listeners
  FROM (
    SELECT lh.user_id
    FROM public.listening_history lh
    WHERE lh.user_id IS NOT NULL
      AND (
        (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
        OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
      )
      AND lh.listened_at >= v_prev_start
      AND lh.listened_at < v_period_start
    UNION
    SELECT vph.user_id
    FROM public.video_playback_history vph
    WHERE vph.user_id IS NOT NULL
      AND cardinality(v_content_ids) > 0
      AND vph.content_id = ANY(v_content_ids)
      AND vph.watched_at >= v_prev_start
      AND vph.watched_at < v_period_start
  ) listeners;

  SELECT COALESCE(SUM(acdp.payout_usd), 0)
  INTO v_period_revenue
  FROM public.ad_creator_daily_payouts acdp
  JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
  JOIN public.organization_artist_links oal
    ON oal.artist_profile_id = ap.id
   AND oal.organization_id = p_org_id
   AND oal.status = 'active'
  WHERE acdp.revenue_date >= v_period_start::date
    AND acdp.revenue_date < v_period_end::date;

  SELECT COALESCE(SUM(acdp.payout_usd), 0)
  INTO v_prev_revenue
  FROM public.ad_creator_daily_payouts acdp
  JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
  JOIN public.organization_artist_links oal
    ON oal.artist_profile_id = ap.id
   AND oal.organization_id = p_org_id
   AND oal.status = 'active'
  WHERE acdp.revenue_date >= v_prev_start::date
    AND acdp.revenue_date < v_period_start::date;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', day_bucket.day::text,
      'streams', day_bucket.streams,
      'listeners', day_bucket.listeners
    ) ORDER BY day_bucket.day
  ), '[]'::jsonb)
  INTO v_growth_chart
  FROM (
    SELECT
      gs.day::date AS day,
      (
        COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          WHERE (
            (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
            OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
          )
          AND lh.listened_at >= gs.day
          AND lh.listened_at < gs.day + interval '1 day'
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.video_playback_history vph
          WHERE cardinality(v_content_ids) > 0
            AND vph.content_id = ANY(v_content_ids)
            AND vph.watched_at >= gs.day
            AND vph.watched_at < gs.day + interval '1 day'
        ), 0)
      ) AS streams,
      (
        SELECT COUNT(*)::bigint
        FROM (
          SELECT lh.user_id
          FROM public.listening_history lh
          WHERE lh.user_id IS NOT NULL
            AND (
              (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
              OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
            )
            AND lh.listened_at >= gs.day
            AND lh.listened_at < gs.day + interval '1 day'
          UNION
          SELECT vph.user_id
          FROM public.video_playback_history vph
          WHERE vph.user_id IS NOT NULL
            AND cardinality(v_content_ids) > 0
            AND vph.content_id = ANY(v_content_ids)
            AND vph.watched_at >= gs.day
            AND vph.watched_at < gs.day + interval '1 day'
        ) daily_listeners
      ) AS listeners
    FROM generate_series(v_period_start, v_period_end - interval '1 day', interval '1 day') AS gs(day)
  ) day_bucket;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'artist_profile_id', ranked.artist_profile_id,
      'stage_name', ranked.stage_name,
      'streams', ranked.period_streams
    ) ORDER BY ranked.period_streams DESC
  ), '[]'::jsonb)
  INTO v_top_artists
  FROM (
    SELECT
      ap.id AS artist_profile_id,
      ap.stage_name,
      (
        COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          JOIN public.songs s ON s.id = lh.song_id
          WHERE s.artist_id = ap.artist_id
            AND lh.listened_at >= v_period_start
            AND lh.listened_at < v_period_end
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          JOIN public.content_uploads cu ON cu.id = lh.content_upload_id
          WHERE cu.user_id = oal.user_id
            AND lh.listened_at >= v_period_start
            AND lh.listened_at < v_period_end
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.video_playback_history vph
          JOIN public.content_uploads cu ON cu.id = vph.content_id
          WHERE cu.user_id = oal.user_id
            AND vph.watched_at >= v_period_start
            AND vph.watched_at < v_period_end
        ), 0)
      ) AS period_streams
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
    ORDER BY period_streams DESC
    LIMIT 3
  ) ranked;

  SELECT jsonb_build_object(
    'artist_profile_id', growth.artist_profile_id,
    'stage_name', growth.stage_name,
    'streams', growth.current_streams,
    'growth_pct', growth.growth_pct
  )
  INTO v_fastest_artist
  FROM (
    SELECT
      ap.id AS artist_profile_id,
      ap.stage_name,
      curr.current_streams,
      CASE
        WHEN COALESCE(prev.previous_streams, 0) = 0 AND curr.current_streams > 0 THEN 100
        WHEN COALESCE(prev.previous_streams, 0) = 0 THEN 0
        ELSE ROUND(((curr.current_streams - prev.previous_streams)::numeric / prev.previous_streams) * 100, 1)
      END AS growth_pct
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    CROSS JOIN LATERAL (
      SELECT
        COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          JOIN public.songs s ON s.id = lh.song_id
          WHERE s.artist_id = ap.artist_id
            AND lh.listened_at >= v_period_start
            AND lh.listened_at < v_period_end
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          JOIN public.content_uploads cu ON cu.id = lh.content_upload_id
          WHERE cu.user_id = oal.user_id
            AND lh.listened_at >= v_period_start
            AND lh.listened_at < v_period_end
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.video_playback_history vph
          JOIN public.content_uploads cu ON cu.id = vph.content_id
          WHERE cu.user_id = oal.user_id
            AND vph.watched_at >= v_period_start
            AND vph.watched_at < v_period_end
        ), 0) AS current_streams
    ) curr
    CROSS JOIN LATERAL (
      SELECT
        COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          JOIN public.songs s ON s.id = lh.song_id
          WHERE s.artist_id = ap.artist_id
            AND lh.listened_at >= v_prev_start
            AND lh.listened_at < v_period_start
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          JOIN public.content_uploads cu ON cu.id = lh.content_upload_id
          WHERE cu.user_id = oal.user_id
            AND lh.listened_at >= v_prev_start
            AND lh.listened_at < v_period_start
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.video_playback_history vph
          JOIN public.content_uploads cu ON cu.id = vph.content_id
          WHERE cu.user_id = oal.user_id
            AND vph.watched_at >= v_prev_start
            AND vph.watched_at < v_period_start
        ), 0) AS previous_streams
    ) prev
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
      AND curr.current_streams > 0
    ORDER BY growth_pct DESC, curr.current_streams DESC
    LIMIT 1
  ) growth;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', al.id,
      'action', al.action,
      'artist_profile_id', al.artist_profile_id,
      'metadata', al.metadata,
      'created_at', al.created_at
    ) ORDER BY al.created_at DESC
  ), '[]'::jsonb)
  INTO v_recent_activity
  FROM (
    SELECT *
    FROM public.organization_activity_logs
    WHERE organization_id = p_org_id
    ORDER BY created_at DESC
    LIMIT 10
  ) al;

  RETURN jsonb_build_object(
    'period_days', v_days,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'total_artists', v_total_artists,
    'artists_added', v_artists_added,
    'total_streams', v_total_streams,
    'period_streams', v_period_streams,
    'previous_period_streams', v_prev_streams,
    'period_listeners', v_period_listeners,
    'previous_period_listeners', v_prev_listeners,
    'total_followers', v_total_followers,
    'total_revenue', v_total_revenue,
    'period_revenue', v_period_revenue,
    'previous_period_revenue', v_prev_revenue,
    'total_songs', v_total_songs,
    'total_albums', v_total_albums,
    'total_videos', v_total_videos,
    'total_releases', v_total_releases,
    'top_performing_artists', v_top_artists,
    'top_performing_artist', CASE
      WHEN jsonb_array_length(v_top_artists) > 0 THEN v_top_artists->0
      ELSE NULL
    END,
    'fastest_growing_artist', v_fastest_artist,
    'growth_chart', v_growth_chart,
    'recent_activity', v_recent_activity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_organization_dashboard(uuid, int) TO authenticated;
