/*
  # Fix Analytics Overview platform revenue totals

  Platform revenue only comes from:
  - AdMob daily input (gross + usable net after safety buffer)
  - Completed Treat purchases (USD)
  - External revenue entries (gross + net after fees)

  Gross/Net USD on Analytics Overview must use these sources — not user balances
  (users.total_earnings), which reflect liabilities already paid out from revenue.
*/

CREATE OR REPLACE FUNCTION public.admin_get_analytics_overview_totals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_song_plays numeric := 0;
  v_video_plays numeric := 0;
  v_total_treat_earnings numeric := 0;
  v_treat_wallet_balance numeric := 0;
  v_total_treat_revenue_usd numeric := 0;
  v_curator_earnings numeric := 0;
  v_earnings jsonb;
  v_user_gross_usd numeric := 0;
  v_admob_gross_usd numeric := 0;
  v_admob_net_usd numeric := 0;
  v_external_gross_usd numeric := 0;
  v_external_net_usd numeric := 0;
  v_creator_pool_paid_usd numeric := 0;
  v_platform_share_usd numeric := 0;
  v_admob_platform_component numeric := 0;
  v_platform_gross_usd numeric := 0;
  v_platform_revenue_gross_usd numeric := 0;
  v_platform_revenue_net_usd numeric := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  SELECT COALESCE(SUM(COALESCE(play_count, 0)), 0) INTO v_song_plays
  FROM public.songs;

  SELECT COALESCE(SUM(COALESCE(play_count, 0)), 0) INTO v_video_plays
  FROM public.content_uploads
  WHERE content_type IN ('video', 'short_clip');

  SELECT
    COALESCE(SUM(COALESCE(total_earned, 0)), 0),
    COALESCE(SUM(COALESCE(balance, 0)), 0)
  INTO v_total_treat_earnings, v_treat_wallet_balance
  FROM public.treat_wallets;

  SELECT COALESCE(SUM(COALESCE(amount_usd, 0)), 0) INTO v_total_treat_revenue_usd
  FROM public.treat_payments
  WHERE status = 'completed';

  SELECT COALESCE(SUM(COALESCE(amount, 0)), 0) INTO v_curator_earnings
  FROM public.curator_earnings;

  SELECT
    COALESCE(SUM(COALESCE(total_revenue_usd, 0)), 0),
    COALESCE(SUM(
      COALESCE(total_revenue_usd, 0)
      * (COALESCE(safety_buffer_percentage, 0) / 100.0)
    ), 0)
  INTO v_admob_gross_usd, v_admob_net_usd
  FROM public.ad_daily_revenue_input;

  SELECT
    COALESCE(SUM(COALESCE(gross_amount_usd, 0)), 0),
    COALESCE(SUM(COALESCE(net_amount_usd, 0)), 0)
  INTO v_external_gross_usd, v_external_net_usd
  FROM public.external_revenue_entries;

  v_platform_revenue_gross_usd :=
    COALESCE(v_admob_gross_usd, 0)
    + COALESCE(v_total_treat_revenue_usd, 0)
    + COALESCE(v_external_gross_usd, 0);

  v_platform_revenue_net_usd :=
    COALESCE(v_admob_net_usd, 0)
    + COALESCE(v_total_treat_revenue_usd, 0)
    + COALESCE(v_external_net_usd, 0);

  v_earnings := public.admin_get_usd_earnings_totals();
  IF v_earnings ? 'error' THEN
    RETURN v_earnings;
  END IF;

  v_user_gross_usd := COALESCE((v_earnings->>'gross_usd')::numeric, 0);

  SELECT COALESCE(SUM(COALESCE(creator_pool_usd, 0)), 0) INTO v_creator_pool_paid_usd
  FROM public.ad_creator_pool_distributions
  WHERE status = 'completed';

  SELECT COALESCE(SUM(COALESCE(net_revenue_usd, 0) - COALESCE(creator_pool_usd, 0)), 0) INTO v_platform_share_usd
  FROM public.ad_creator_pool_distributions
  WHERE status = 'completed';

  v_admob_platform_component := COALESCE(v_platform_share_usd, 0);
  IF v_admob_platform_component = 0 AND COALESCE(v_admob_gross_usd, 0) > 0 THEN
    v_admob_platform_component := v_admob_gross_usd * 0.40;
  END IF;

  v_platform_gross_usd :=
    COALESCE(v_user_gross_usd, 0)
    + COALESCE(v_total_treat_revenue_usd, 0)
    + COALESCE(v_curator_earnings, 0)
    + COALESCE(v_admob_platform_component, 0);

  RETURN jsonb_build_object(
    'song_plays', v_song_plays,
    'video_plays', v_video_plays,
    'total_plays', (v_song_plays + v_video_plays),
    'total_treat_earnings', v_total_treat_earnings,
    'treat_wallet_balance', v_treat_wallet_balance,
    'total_treat_revenue_usd', v_total_treat_revenue_usd,
    'curator_earnings', v_curator_earnings,
    'usd_earnings', v_earnings,
    'admob_total_revenue_usd', v_admob_gross_usd,
    'admob_net_revenue_usd', v_admob_net_usd,
    'external_revenue_gross_usd', v_external_gross_usd,
    'external_revenue_net_usd', v_external_net_usd,
    'platform_revenue_gross_usd', v_platform_revenue_gross_usd,
    'platform_revenue_net_usd', v_platform_revenue_net_usd,
    'platform_revenue_components', jsonb_build_object(
      'admob_gross_usd', v_admob_gross_usd,
      'admob_net_usd', v_admob_net_usd,
      'treat_revenue_usd', v_total_treat_revenue_usd,
      'external_gross_usd', v_external_gross_usd,
      'external_net_usd', v_external_net_usd
    ),
    'admob_creator_pool_paid_usd', v_creator_pool_paid_usd,
    'admob_platform_share_usd', v_platform_share_usd,
    'platform_gross_usd', v_platform_gross_usd,
    'platform_gross_components', jsonb_build_object(
      'user_usd_gross', v_user_gross_usd,
      'treat_revenue_usd', v_total_treat_revenue_usd,
      'curator_earnings_usd', v_curator_earnings,
      'admob_platform_component_usd', v_admob_platform_component
    )
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_analytics_overview_totals() IS
  'Admin overview totals. platform_revenue_gross_usd/net_usd = AdMob + Treat purchases + External revenue only. usd_earnings remains user balance totals for withdrawal metrics.';
