-- ALMC 5.7 Organization Analytics overview.

CREATE OR REPLACE FUNCTION public.get_organization_analytics(
  p_org_id uuid,
  p_days int DEFAULT 30,
  p_artist_profile_id uuid DEFAULT NULL
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
  v_song_ids uuid[];
  v_content_ids uuid[];
  v_user_ids uuid[];
  v_period_streams bigint := 0;
  v_prev_streams bigint := 0;
  v_period_listeners bigint := 0;
  v_prev_listeners bigint := 0;
  v_period_revenue numeric := 0;
  v_prev_revenue numeric := 0;
  v_avg_completion numeric := 0;
  v_streams_by_day jsonb := '[]'::jsonb;
  v_top_countries jsonb := '[]'::jsonb;
  v_devices jsonb := '[]'::jsonb;
  v_age_gender jsonb := '[]'::jsonb;
  v_top_songs jsonb := '[]'::jsonb;
  v_top_albums jsonb := '[]'::jsonb;
  v_top_artists jsonb := '[]'::jsonb;
  v_growth_comparison jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'analytics.view', v_user_id) THEN
    RAISE EXCEPTION 'Missing analytics.view permission';
  END IF;

  SELECT
    COALESCE(array_agg(DISTINCT s.id) FILTER (WHERE s.id IS NOT NULL), ARRAY[]::uuid[]),
    COALESCE(array_agg(DISTINCT cu.id) FILTER (WHERE cu.id IS NOT NULL), ARRAY[]::uuid[]),
    COALESCE(array_agg(DISTINCT oal.user_id) FILTER (WHERE oal.user_id IS NOT NULL), ARRAY[]::uuid[])
  INTO v_song_ids, v_content_ids, v_user_ids
  FROM public.organization_artist_links oal
  JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
  LEFT JOIN public.artists a ON a.id = ap.artist_id
  LEFT JOIN public.songs s ON s.artist_id = a.id
  LEFT JOIN public.content_uploads cu ON cu.user_id = oal.user_id
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active'
    AND (p_artist_profile_id IS NULL OR oal.artist_profile_id = p_artist_profile_id);

  -- Period streams (listening + video)
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

  -- Avg completion: duration_listened / song duration (capped 100%)
  SELECT COALESCE(ROUND(AVG(LEAST(
    CASE
      WHEN COALESCE(s.duration_seconds, 0) > 0
        THEN (COALESCE(lh.duration_listened, 0)::numeric / s.duration_seconds) * 100
      ELSE NULL
    END,
    100
  )), 1), 0)
  INTO v_avg_completion
  FROM public.listening_history lh
  JOIN public.songs s ON s.id = lh.song_id
  WHERE cardinality(v_song_ids) > 0
    AND lh.song_id = ANY(v_song_ids)
    AND lh.listened_at >= v_period_start
    AND lh.listened_at < v_period_end
    AND COALESCE(s.duration_seconds, 0) > 0;

  -- Revenue from ad creator daily payouts for linked artists
  SELECT COALESCE(SUM(acdp.payout_usd), 0)
  INTO v_period_revenue
  FROM public.ad_creator_daily_payouts acdp
  JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
  JOIN public.organization_artist_links oal
    ON oal.artist_profile_id = ap.id
   AND oal.organization_id = p_org_id
   AND oal.status = 'active'
  WHERE acdp.revenue_date >= v_period_start::date
    AND acdp.revenue_date < v_period_end::date
    AND (p_artist_profile_id IS NULL OR ap.id = p_artist_profile_id);

  SELECT COALESCE(SUM(acdp.payout_usd), 0)
  INTO v_prev_revenue
  FROM public.ad_creator_daily_payouts acdp
  JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
  JOIN public.organization_artist_links oal
    ON oal.artist_profile_id = ap.id
   AND oal.organization_id = p_org_id
   AND oal.status = 'active'
  WHERE acdp.revenue_date >= v_prev_start::date
    AND acdp.revenue_date < v_period_start::date
    AND (p_artist_profile_id IS NULL OR ap.id = p_artist_profile_id);

  -- Streams by day
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('date', day_bucket.day, 'streams', day_bucket.streams, 'listeners', day_bucket.listeners)
    ORDER BY day_bucket.day
  ), '[]'::jsonb)
  INTO v_streams_by_day
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
        ) d
      ) AS listeners
    FROM generate_series(v_period_start, v_period_end - interval '1 day', interval '1 day') AS gs(day)
  ) day_bucket;

  -- Top countries
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'country', c.country,
      'streams', c.streams,
      'pct', CASE WHEN v_period_streams > 0 THEN ROUND((c.streams::numeric / v_period_streams) * 100, 1) ELSE 0 END
    )
    ORDER BY c.streams DESC
  ), '[]'::jsonb)
  INTO v_top_countries
  FROM (
    SELECT
      COALESCE(NULLIF(trim(lh.detected_country), ''), NULLIF(trim(lh.detected_country_code), ''), 'Unknown') AS country,
      COUNT(*)::bigint AS streams
    FROM public.listening_history lh
    WHERE (
      (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
      OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
    )
      AND lh.listened_at >= v_period_start
      AND lh.listened_at < v_period_end
    GROUP BY 1
    ORDER BY streams DESC
    LIMIT 8
  ) c;

  -- Devices from user_agent
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'device', d.device,
      'streams', d.streams,
      'pct', CASE WHEN v_period_streams > 0 THEN ROUND((d.streams::numeric / v_period_streams) * 100, 1) ELSE 0 END
    )
    ORDER BY d.streams DESC
  ), '[]'::jsonb)
  INTO v_devices
  FROM (
    SELECT
      CASE
        WHEN lh.user_agent ILIKE '%Mobile%'
          OR lh.user_agent ILIKE '%Android%'
          OR lh.user_agent ILIKE '%iPhone%'
          OR lh.user_agent ILIKE '%iPad%'
          THEN 'Mobile'
        WHEN lh.user_agent IS NULL OR trim(lh.user_agent) = '' THEN 'Unknown'
        ELSE 'Web'
      END AS device,
      COUNT(*)::bigint AS streams
    FROM public.listening_history lh
    WHERE (
      (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
      OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
    )
      AND lh.listened_at >= v_period_start
      AND lh.listened_at < v_period_end
    GROUP BY 1
  ) d;

  -- Age / gender of listeners
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'gender', ag.gender,
      'age_bucket', ag.age_bucket,
      'listeners', ag.listeners
    )
    ORDER BY ag.listeners DESC
  ), '[]'::jsonb)
  INTO v_age_gender
  FROM (
    SELECT
      COALESCE(NULLIF(lower(trim(u.gender)), ''), 'unknown') AS gender,
      CASE
        WHEN u.date_of_birth IS NULL THEN 'unknown'
        WHEN EXTRACT(YEAR FROM age(u.date_of_birth)) < 18 THEN 'under_18'
        WHEN EXTRACT(YEAR FROM age(u.date_of_birth)) BETWEEN 18 AND 24 THEN '18_24'
        WHEN EXTRACT(YEAR FROM age(u.date_of_birth)) BETWEEN 25 AND 34 THEN '25_34'
        WHEN EXTRACT(YEAR FROM age(u.date_of_birth)) BETWEEN 35 AND 44 THEN '35_44'
        ELSE '45_plus'
      END AS age_bucket,
      COUNT(DISTINCT lh.user_id)::bigint AS listeners
    FROM public.listening_history lh
    JOIN public.users u ON u.id = lh.user_id
    WHERE lh.user_id IS NOT NULL
      AND (
        (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
        OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
      )
      AND lh.listened_at >= v_period_start
      AND lh.listened_at < v_period_end
    GROUP BY 1, 2
    ORDER BY listeners DESC
    LIMIT 12
  ) ag;

  -- Top songs
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'stage_name', t.stage_name,
      'streams', t.streams,
      'cover_url', t.cover_url
    )
    ORDER BY t.streams DESC
  ), '[]'::jsonb)
  INTO v_top_songs
  FROM (
    SELECT
      s.id,
      s.title,
      ap.stage_name,
      COUNT(lh.id)::bigint AS streams,
      s.cover_image_url AS cover_url
    FROM public.listening_history lh
    JOIN public.songs s ON s.id = lh.song_id
    JOIN public.artists a ON a.id = s.artist_id
    JOIN public.artist_profiles ap ON ap.artist_id = a.id
    JOIN public.organization_artist_links oal
      ON oal.artist_profile_id = ap.id
      AND oal.organization_id = p_org_id
      AND oal.status = 'active'
    WHERE lh.listened_at >= v_period_start
      AND lh.listened_at < v_period_end
      AND (p_artist_profile_id IS NULL OR ap.id = p_artist_profile_id)
    GROUP BY s.id, s.title, ap.stage_name, s.cover_image_url
    ORDER BY streams DESC
    LIMIT 10
  ) t;

  -- Top albums
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'stage_name', t.stage_name,
      'streams', t.streams,
      'cover_url', t.cover_url
    )
    ORDER BY t.streams DESC
  ), '[]'::jsonb)
  INTO v_top_albums
  FROM (
    SELECT
      al.id,
      al.title,
      ap.stage_name,
      COUNT(lh.id)::bigint AS streams,
      al.cover_image_url AS cover_url
    FROM public.listening_history lh
    JOIN public.songs s ON s.id = lh.song_id
    JOIN public.albums al ON al.id = s.album_id
    JOIN public.artists a ON a.id = al.artist_id
    JOIN public.artist_profiles ap ON ap.artist_id = a.id
    JOIN public.organization_artist_links oal
      ON oal.artist_profile_id = ap.id
      AND oal.organization_id = p_org_id
      AND oal.status = 'active'
    WHERE lh.listened_at >= v_period_start
      AND lh.listened_at < v_period_end
      AND (p_artist_profile_id IS NULL OR ap.id = p_artist_profile_id)
    GROUP BY al.id, al.title, ap.stage_name, al.cover_image_url
    ORDER BY streams DESC
    LIMIT 10
  ) t;

  -- Top / growth artists for comparison
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'artist_profile_id', r.artist_profile_id,
      'stage_name', r.stage_name,
      'period_streams', r.period_streams,
      'previous_streams', r.previous_streams,
      'growth_pct', CASE
        WHEN r.previous_streams = 0 THEN CASE WHEN r.period_streams > 0 THEN 100 ELSE 0 END
        ELSE ROUND(((r.period_streams - r.previous_streams)::numeric / r.previous_streams) * 100, 1)
      END
    )
    ORDER BY r.period_streams DESC
  ), '[]'::jsonb)
  INTO v_growth_comparison
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
      ) AS period_streams,
      (
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
      ) AS previous_streams
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
      AND (p_artist_profile_id IS NULL OR ap.id = p_artist_profile_id)
    ORDER BY period_streams DESC
    LIMIT 10
  ) r;

  v_top_artists := v_growth_comparison;

  RETURN jsonb_build_object(
    'period_days', v_days,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'artist_profile_id', p_artist_profile_id,
    'period_streams', v_period_streams,
    'previous_period_streams', v_prev_streams,
    'period_listeners', v_period_listeners,
    'previous_period_listeners', v_prev_listeners,
    'period_revenue', v_period_revenue,
    'previous_period_revenue', v_prev_revenue,
    'avg_completion', v_avg_completion,
    'streams_by_day', v_streams_by_day,
    'top_countries', v_top_countries,
    'top_cities', '[]'::jsonb,
    'devices', v_devices,
    'age_gender', v_age_gender,
    'top_songs', v_top_songs,
    'top_albums', v_top_albums,
    'playlist_placements', '[]'::jsonb,
    'traffic_sources', '[]'::jsonb,
    'growth_comparison', v_growth_comparison,
    'top_artists', v_top_artists
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_organization_analytics(uuid, int, uuid) TO authenticated;

-- ALMC 5.8 Revenue summary (read-only rollup).
CREATE OR REPLACE FUNCTION public.get_organization_revenue(
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
  v_period_end date := CURRENT_DATE;
  v_period_start date := v_period_end - v_days;
  v_total numeric := 0;
  v_period numeric := 0;
  v_pending numeric := 0;
  v_by_artist jsonb := '[]'::jsonb;
  v_monthly jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT (
    public.org_member_has_permission(p_org_id, 'analytics.view', v_user_id)
    OR public.org_member_has_permission(p_org_id, 'org.manage', v_user_id)
  ) THEN
    RAISE EXCEPTION 'Missing revenue view permission';
  END IF;

  SELECT COALESCE(SUM(u.total_earnings), 0)
  INTO v_total
  FROM public.organization_artist_links oal
  JOIN public.users u ON u.id = oal.user_id
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active';

  SELECT COALESCE(SUM(acdp.payout_usd), 0)
  INTO v_period
  FROM public.ad_creator_daily_payouts acdp
  JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
  JOIN public.organization_artist_links oal
    ON oal.artist_profile_id = ap.id
   AND oal.organization_id = p_org_id
   AND oal.status = 'active'
  WHERE acdp.revenue_date >= v_period_start
    AND acdp.revenue_date <= v_period_end;

  -- Pending treat balance across linked artists
  SELECT COALESCE(SUM(tw.pending_balance), 0)
  INTO v_pending
  FROM public.organization_artist_links oal
  LEFT JOIN public.treat_wallets tw ON tw.user_id = oal.user_id
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active';

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'artist_profile_id', r.artist_profile_id,
      'stage_name', r.stage_name,
      'total_earnings', r.total_earnings,
      'period_ads', r.period_ads,
      'pct_of_org', CASE WHEN v_total > 0 THEN ROUND((r.total_earnings / v_total) * 100, 1) ELSE 0 END
    )
    ORDER BY r.total_earnings DESC
  ), '[]'::jsonb)
  INTO v_by_artist
  FROM (
    SELECT
      ap.id AS artist_profile_id,
      ap.stage_name,
      COALESCE(u.total_earnings, 0)::numeric AS total_earnings,
      COALESCE((
        SELECT SUM(acdp.payout_usd)
        FROM public.ad_creator_daily_payouts acdp
        WHERE acdp.artist_id = ap.artist_id
          AND acdp.revenue_date >= v_period_start
          AND acdp.revenue_date <= v_period_end
      ), 0)::numeric AS period_ads
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    LEFT JOIN public.users u ON u.id = oal.user_id
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
    ORDER BY total_earnings DESC
    LIMIT 50
  ) r;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('month', m.month, 'amount', m.amount)
    ORDER BY m.month
  ), '[]'::jsonb)
  INTO v_monthly
  FROM (
    SELECT
      to_char(date_trunc('month', acdp.revenue_date), 'YYYY-MM') AS month,
      COALESCE(SUM(acdp.payout_usd), 0)::numeric AS amount
    FROM public.ad_creator_daily_payouts acdp
    JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
    JOIN public.organization_artist_links oal
      ON oal.artist_profile_id = ap.id
     AND oal.organization_id = p_org_id
     AND oal.status = 'active'
    WHERE acdp.revenue_date >= (v_period_end - interval '12 months')::date
    GROUP BY 1
    ORDER BY 1
  ) m;

  RETURN jsonb_build_object(
    'period_days', v_days,
    'available', GREATEST(v_total - v_pending, 0),
    'total', v_total,
    'treats', v_pending,
    'ads', v_period,
    'pending', v_pending,
    'by_artist', v_by_artist,
    'monthly_trend', v_monthly
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_organization_revenue(uuid, int) TO authenticated;
