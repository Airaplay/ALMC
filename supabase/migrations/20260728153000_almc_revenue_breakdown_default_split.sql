/*
  # ALMC revenue breakdown with default org/artist split

  - Keeps Admin Dashboard revenue logic unchanged
  - Adds ALMC-only breakdown fields for org share vs artist share
  - Uses default split of 0% org / 100% artist for linked artists
*/

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
  v_org_split_pct numeric := 0;
  v_artist_split_pct numeric := 100;
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
      'gross_total', r.gross_total,
      'org_share_total', r.org_share_total,
      'artist_share_total', r.artist_share_total,
      'total_earnings', r.artist_share_total,
      'period_ads', r.period_ads,
      'pct_of_org', CASE WHEN v_total > 0 THEN ROUND((r.gross_total / v_total) * 100, 1) ELSE 0 END
    )
    ORDER BY r.gross_total DESC
  ), '[]'::jsonb)
  INTO v_by_artist
  FROM (
    SELECT
      ap.id AS artist_profile_id,
      ap.stage_name,
      COALESCE(u.total_earnings, 0)::numeric AS gross_total,
      ROUND(COALESCE(u.total_earnings, 0)::numeric * (v_org_split_pct / 100.0), 2) AS org_share_total,
      ROUND(COALESCE(u.total_earnings, 0)::numeric * (v_artist_split_pct / 100.0), 2) AS artist_share_total,
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
    ORDER BY gross_total DESC
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
    'org_split_pct', v_org_split_pct,
    'artist_split_pct', v_artist_split_pct,
    'gross_total', v_total,
    'org_share_total', ROUND(v_total * (v_org_split_pct / 100.0), 2),
    'artist_share_total', ROUND(v_total * (v_artist_split_pct / 100.0), 2),
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
