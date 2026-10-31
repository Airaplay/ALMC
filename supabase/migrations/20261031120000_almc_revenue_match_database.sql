-- ALMC: period revenue must match actual DB credits (not AdMob payouts alone).
-- Sources:
--   1) ad_creator_daily_payouts.payout_usd
--   2) content_purchases.creator_payout_usd
--   3) admin_live_balance_adjustments.credited_usd (> 0)
-- Lifetime / gross KPIs stay on users.total_earnings (live balance in DB).

CREATE OR REPLACE FUNCTION public.almc_org_artist_earnings_between(
  p_org_id uuid,
  p_start date,
  p_end date,
  p_artist_profile_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT COALESCE(SUM(x.amount), 0)::numeric
  FROM (
    SELECT acdp.payout_usd AS amount
    FROM public.ad_creator_daily_payouts acdp
    JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
    JOIN public.organization_artist_links oal
      ON oal.artist_profile_id = ap.id
     AND oal.organization_id = p_org_id
     AND oal.status = 'active'
    WHERE acdp.revenue_date >= p_start
      AND acdp.revenue_date <= p_end
      AND (p_artist_profile_id IS NULL OR ap.id = p_artist_profile_id)

    UNION ALL

    SELECT cp.creator_payout_usd AS amount
    FROM public.content_purchases cp
    JOIN public.organization_artist_links oal
      ON oal.user_id = cp.creator_user_id
     AND oal.organization_id = p_org_id
     AND oal.status = 'active'
    WHERE cp.purchased_at::date >= p_start
      AND cp.purchased_at::date <= p_end
      AND COALESCE(cp.creator_payout_usd, 0) <> 0
      AND (p_artist_profile_id IS NULL OR oal.artist_profile_id = p_artist_profile_id)

    UNION ALL

    SELECT a.credited_usd AS amount
    FROM public.admin_live_balance_adjustments a
    JOIN public.organization_artist_links oal
      ON oal.user_id = a.user_id
     AND oal.organization_id = p_org_id
     AND oal.status = 'active'
    WHERE a.created_at::date >= p_start
      AND a.created_at::date <= p_end
      AND COALESCE(a.credited_usd, 0) > 0
      AND (p_artist_profile_id IS NULL OR oal.artist_profile_id = p_artist_profile_id)
  ) x;
$$;

REVOKE ALL ON FUNCTION public.almc_org_artist_earnings_between(uuid, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.almc_org_artist_earnings_between(uuid, date, date, uuid) TO authenticated;

COMMENT ON FUNCTION public.almc_org_artist_earnings_between(uuid, date, date, uuid) IS
  'Sum of linked-artist DB earnings for a date range: AdMob daily payouts + content sale creator payouts + positive admin live-balance credits.';

-- ---------------------------------------------------------------------------
-- Revenue rollup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_organization_revenue(
  p_org_id uuid,
  p_days integer DEFAULT 30
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
  v_trend_start date := (v_period_end - interval '12 months')::date;

  v_default_org_split_pct numeric := 0;
  v_default_artist_split_pct numeric := 100;

  v_gross_total numeric := 0;
  v_org_share_total numeric := 0;
  v_artist_share_total numeric := 0;

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

  SELECT
    COALESCE((o.settings->>'almc_org_split_org_pct')::numeric, 0)
  INTO v_default_org_split_pct
  FROM public.organizations o
  WHERE o.id = p_org_id;

  v_default_org_split_pct := GREATEST(LEAST(COALESCE(v_default_org_split_pct, 0), 100), 0);
  v_default_artist_split_pct := 100 - v_default_org_split_pct;

  -- Lifetime gross = live balance stored on users (source of truth in DB)
  SELECT COALESCE(SUM(u.total_earnings), 0)
  INTO v_gross_total
  FROM public.organization_artist_links oal
  JOIN public.users u ON u.id = oal.user_id
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active';

  v_period := public.almc_org_artist_earnings_between(
    p_org_id, v_period_start, v_period_end, NULL
  );

  SELECT COALESCE(SUM(tw.pending_balance), 0)
  INTO v_pending
  FROM public.organization_artist_links oal
  LEFT JOIN public.treat_wallets tw ON tw.user_id = oal.user_id
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active';

  WITH base AS (
    SELECT
      oal.artist_profile_id,
      ap.stage_name,
      oal.org_split_pct_override,
      COALESCE(u.total_earnings, 0)::numeric AS gross_total,
      COALESCE(oal.org_split_pct_override, v_default_org_split_pct)::numeric AS org_split_pct_used,
      ROUND(
        COALESCE(u.total_earnings, 0)::numeric
        * (COALESCE(oal.org_split_pct_override, v_default_org_split_pct) / 100.0),
        2
      ) AS org_share_total,
      ROUND(
        COALESCE(u.total_earnings, 0)::numeric
        * (1 - (COALESCE(oal.org_split_pct_override, v_default_org_split_pct) / 100.0)),
        2
      ) AS artist_share_total,
      public.almc_org_artist_earnings_between(
        p_org_id, v_period_start, v_period_end, oal.artist_profile_id
      ) AS period_ads
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    LEFT JOIN public.users u ON u.id = oal.user_id
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
  )
  SELECT
    COALESCE(SUM(org_share_total), 0),
    COALESCE(SUM(artist_share_total), 0)
  INTO
    v_org_share_total,
    v_artist_share_total
  FROM base;

  WITH base AS (
    SELECT
      oal.artist_profile_id,
      ap.stage_name,
      oal.org_split_pct_override,
      COALESCE(u.total_earnings, 0)::numeric AS gross_total,
      COALESCE(oal.org_split_pct_override, v_default_org_split_pct)::numeric AS org_split_pct_used,
      ROUND(
        COALESCE(u.total_earnings, 0)::numeric
        * (COALESCE(oal.org_split_pct_override, v_default_org_split_pct) / 100.0),
        2
      ) AS org_share_total,
      ROUND(
        COALESCE(u.total_earnings, 0)::numeric
        * (1 - (COALESCE(oal.org_split_pct_override, v_default_org_split_pct) / 100.0)),
        2
      ) AS artist_share_total,
      public.almc_org_artist_earnings_between(
        p_org_id, v_period_start, v_period_end, oal.artist_profile_id
      ) AS period_ads
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    LEFT JOIN public.users u ON u.id = oal.user_id
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
  ),
  top_base AS (
    SELECT *
    FROM base
    ORDER BY gross_total DESC
    LIMIT 50
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'artist_profile_id', tb.artist_profile_id,
      'stage_name', tb.stage_name,
      'gross_total', tb.gross_total,
      'org_share_total', tb.org_share_total,
      'artist_share_total', tb.artist_share_total,
      'total_earnings', tb.gross_total,
      'org_split_pct_override', tb.org_split_pct_override,
      'org_split_pct', tb.org_split_pct_used,
      'artist_split_pct', 100 - tb.org_split_pct_used,
      'period_ads', tb.period_ads,
      'pct_of_org', CASE WHEN v_gross_total > 0 THEN ROUND((tb.gross_total / v_gross_total) * 100, 1) ELSE 0 END
    )
    ORDER BY tb.gross_total DESC
  ), '[]'::jsonb)
  INTO v_by_artist
  FROM top_base tb;

  -- Monthly trend from the same DB earnings sources
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('month', m.month, 'amount', m.amount)
    ORDER BY m.month
  ), '[]'::jsonb)
  INTO v_monthly
  FROM (
    SELECT month, ROUND(SUM(amount), 6)::numeric AS amount
    FROM (
      SELECT
        to_char(date_trunc('month', acdp.revenue_date), 'YYYY-MM') AS month,
        acdp.payout_usd AS amount
      FROM public.ad_creator_daily_payouts acdp
      JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
      JOIN public.organization_artist_links oal
        ON oal.artist_profile_id = ap.id
       AND oal.organization_id = p_org_id
       AND oal.status = 'active'
      WHERE acdp.revenue_date >= v_trend_start

      UNION ALL

      SELECT
        to_char(date_trunc('month', cp.purchased_at), 'YYYY-MM') AS month,
        cp.creator_payout_usd AS amount
      FROM public.content_purchases cp
      JOIN public.organization_artist_links oal
        ON oal.user_id = cp.creator_user_id
       AND oal.organization_id = p_org_id
       AND oal.status = 'active'
      WHERE cp.purchased_at::date >= v_trend_start
        AND COALESCE(cp.creator_payout_usd, 0) <> 0

      UNION ALL

      SELECT
        to_char(date_trunc('month', a.created_at), 'YYYY-MM') AS month,
        a.credited_usd AS amount
      FROM public.admin_live_balance_adjustments a
      JOIN public.organization_artist_links oal
        ON oal.user_id = a.user_id
       AND oal.organization_id = p_org_id
       AND oal.status = 'active'
      WHERE a.created_at::date >= v_trend_start
        AND COALESCE(a.credited_usd, 0) > 0
    ) raw
    GROUP BY month
  ) m;

  RETURN jsonb_build_object(
    'period_days', v_days,
    'org_split_pct', v_default_org_split_pct,
    'artist_split_pct', v_default_artist_split_pct,
    'gross_total', v_gross_total,
    'org_share_total', v_org_share_total,
    'artist_share_total', v_artist_share_total,
    'available', GREATEST(v_gross_total - v_pending, 0),
    'total', v_gross_total,
    'treats', v_pending,
    'ads', v_period,
    'period_revenue', v_period,
    'pending', v_pending,
    'by_artist', v_by_artist,
    'monthly_trend', v_monthly
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_organization_revenue(uuid, int) TO authenticated;

COMMENT ON FUNCTION public.get_organization_revenue(uuid, int) IS
  'ALMC revenue rollup. gross_total = SUM(users.total_earnings) for linked artists. period/ads/monthly_trend = AdMob payouts + content sales + admin credits from DB.';

-- Patch analytics + dashboard period revenue to the same helper (idempotent replace).
DO $patch$
DECLARE
  v_analytics text;
  v_dashboard text;
BEGIN
  SELECT replace(
    pg_get_functiondef(p.oid),
    $old$
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
$old$,
    $new$
  v_period_revenue := public.almc_org_artist_earnings_between(
    p_org_id,
    v_period_start::date,
    (v_period_end::date - 1),
    p_artist_profile_id
  );

  v_prev_revenue := public.almc_org_artist_earnings_between(
    p_org_id,
    v_prev_start::date,
    (v_period_start::date - 1),
    p_artist_profile_id
  );
$new$
  )
  INTO v_analytics
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_organization_analytics';

  IF v_analytics IS NOT NULL AND position('almc_org_artist_earnings_between' in v_analytics) > 0 THEN
    EXECUTE v_analytics;
  END IF;

  SELECT replace(
    pg_get_functiondef(p.oid),
    $old$
  SELECT COALESCE(SUM(acdp.payout_usd), 0) INTO v_period_revenue
  FROM public.ad_creator_daily_payouts acdp
  JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
  JOIN public.organization_artist_links oal
    ON oal.artist_profile_id = ap.id
   AND oal.organization_id = p_org_id
   AND oal.status = 'active'
  WHERE acdp.revenue_date >= v_period_start::date
    AND acdp.revenue_date < v_period_end::date;

  SELECT COALESCE(SUM(acdp.payout_usd), 0) INTO v_prev_revenue
  FROM public.ad_creator_daily_payouts acdp
  JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
  JOIN public.organization_artist_links oal
    ON oal.artist_profile_id = ap.id
   AND oal.organization_id = p_org_id
   AND oal.status = 'active'
  WHERE acdp.revenue_date >= v_prev_start::date
    AND acdp.revenue_date < v_period_start::date;
$old$,
    $new$
  v_period_revenue := public.almc_org_artist_earnings_between(
    p_org_id,
    v_period_start::date,
    (v_period_end::date - 1),
    NULL
  );

  v_prev_revenue := public.almc_org_artist_earnings_between(
    p_org_id,
    v_prev_start::date,
    (v_period_start::date - 1),
    NULL
  );
$new$
  )
  INTO v_dashboard
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_organization_dashboard';

  IF v_dashboard IS NOT NULL AND position('almc_org_artist_earnings_between' in v_dashboard) > 0 THEN
    EXECUTE v_dashboard;
  END IF;
END;
$patch$;
