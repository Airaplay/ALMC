/*
  Admin reset: clear Ad Revenue dashboard data to start fresh.

  Clears (in order):
  - admob_sync_history
  - ad_daily_revenue_input
  - ad_revenue_events (Recent Revenue Events)
  - ad_creator_payout_ledger, ad_creator_daily_payouts, ad_creator_pool_distributions (Creator Pool Payout History)

  Optional:
  - ad_impressions (NOT enabled by default, because it can affect other analytics/anti-fraud).

  Safety:
  - Requires admin role AND an explicit confirmation string.
  - Returns counts of deleted rows.
*/

CREATE OR REPLACE FUNCTION public.admin_reset_ad_revenue_data(
  p_confirm text,
  p_include_ad_impressions boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  c_confirm constant text := 'RESET_AD_REVENUE_DATA';
  n_sync_history bigint := 0;
  n_daily_inputs bigint := 0;
  n_revenue_events bigint := 0;
  n_reconciliation bigint := 0;
  n_ledger bigint := 0;
  n_daily_payouts bigint := 0;
  n_distributions bigint := 0;
  n_impressions bigint := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized: admin role required');
  END IF;

  IF COALESCE(p_confirm, '') <> c_confirm THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Confirmation required',
      'required_confirm', c_confirm
    );
  END IF;

  -- Creator pool tables (delete most-dependent first)
  DELETE FROM public.ad_creator_payout_ledger;
  GET DIAGNOSTICS n_ledger = ROW_COUNT;

  DELETE FROM public.ad_creator_daily_payouts;
  GET DIAGNOSTICS n_daily_payouts = ROW_COUNT;

  DELETE FROM public.ad_creator_pool_distributions;
  GET DIAGNOSTICS n_distributions = ROW_COUNT;

  -- Ad revenue events (Recent Revenue Events)
  DELETE FROM public.ad_revenue_events;
  GET DIAGNOSTICS n_revenue_events = ROW_COUNT;

  -- Reconciliation Log
  DELETE FROM public.ad_reconciliation_log;
  GET DIAGNOSTICS n_reconciliation = ROW_COUNT;

  -- AdMob sync history + daily inputs
  DELETE FROM public.admob_sync_history;
  GET DIAGNOSTICS n_sync_history = ROW_COUNT;

  DELETE FROM public.ad_daily_revenue_input;
  GET DIAGNOSTICS n_daily_inputs = ROW_COUNT;

  IF COALESCE(p_include_ad_impressions, false) THEN
    DELETE FROM public.ad_impressions;
    GET DIAGNOSTICS n_impressions = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', jsonb_build_object(
      'admob_sync_history', n_sync_history,
      'ad_daily_revenue_input', n_daily_inputs,
      'ad_revenue_events', n_revenue_events,
      'ad_reconciliation_log', n_reconciliation,
      'ad_creator_payout_ledger', n_ledger,
      'ad_creator_daily_payouts', n_daily_payouts,
      'ad_creator_pool_distributions', n_distributions,
      'ad_impressions', n_impressions
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_ad_revenue_data(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_ad_revenue_data(text, boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_reset_ad_revenue_data(text, boolean) IS
  'Admin-only. Deletes Ad Revenue dashboard data (sync history, daily inputs, revenue events, creator pool history). Requires confirm string RESET_AD_REVENUE_DATA.';

