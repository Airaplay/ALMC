/*
  Admin-only full financial reset to start from zero.

  This function is intentionally destructive and should only be used for
  controlled reset scenarios (staging, pre-launch cleanup, or explicit admin request).
*/

CREATE OR REPLACE FUNCTION public.admin_reset_all_financial_data(
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
  c_confirm constant text := 'RESET_ALL_FINANCIAL_DATA';
  v_ad_reset jsonb := '{}'::jsonb;

  n_accounting_lines bigint := 0;
  n_accounting_entries bigint := 0;
  n_treat_transactions bigint := 0;
  n_treat_wallets bigint := 0;
  n_user_earnings bigint := 0;
  n_contribution_scores bigint := 0;
  n_withdrawals bigint := 0;
  n_treat_payments bigint := 0;

  v_wallet_set_clause text := '';
  v_score_set_clause text := '';
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

  -- Reset ad revenue domain first using existing guarded function (if present).
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'admin_reset_ad_revenue_data'
  ) THEN
    v_ad_reset := public.admin_reset_ad_revenue_data('RESET_AD_REVENUE_DATA', COALESCE(p_include_ad_impressions, false));
  END IF;

  -- Accounting: clear posted lines and entries.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='accounting_journal_lines') THEN
    DELETE FROM public.accounting_journal_lines;
    GET DIAGNOSTICS n_accounting_lines = ROW_COUNT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='accounting_journal_entries') THEN
    DELETE FROM public.accounting_journal_entries;
    GET DIAGNOSTICS n_accounting_entries = ROW_COUNT;
  END IF;

  -- Treat transactions history.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='treat_transactions') THEN
    DELETE FROM public.treat_transactions;
    GET DIAGNOSTICS n_treat_transactions = ROW_COUNT;
  END IF;

  -- Zero treat wallets dynamically (handles minor schema drift safely).
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='treat_wallets') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_wallets' AND column_name='balance') THEN
      v_wallet_set_clause := v_wallet_set_clause || 'balance = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_wallets' AND column_name='total_earned') THEN
      v_wallet_set_clause := v_wallet_set_clause || 'total_earned = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_wallets' AND column_name='total_purchased') THEN
      v_wallet_set_clause := v_wallet_set_clause || 'total_purchased = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_wallets' AND column_name='total_spent') THEN
      v_wallet_set_clause := v_wallet_set_clause || 'total_spent = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_wallets' AND column_name='total_withdrawn') THEN
      v_wallet_set_clause := v_wallet_set_clause || 'total_withdrawn = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_wallets' AND column_name='earned_balance') THEN
      v_wallet_set_clause := v_wallet_set_clause || 'earned_balance = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_wallets' AND column_name='purchased_balance') THEN
      v_wallet_set_clause := v_wallet_set_clause || 'purchased_balance = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_wallets' AND column_name='pending_balance') THEN
      v_wallet_set_clause := v_wallet_set_clause || 'pending_balance = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_wallets' AND column_name='promo_balance') THEN
      v_wallet_set_clause := v_wallet_set_clause || 'promo_balance = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_wallets' AND column_name='promo_lifetime_earned') THEN
      v_wallet_set_clause := v_wallet_set_clause || 'promo_lifetime_earned = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_wallets' AND column_name='promo_lifetime_spent') THEN
      v_wallet_set_clause := v_wallet_set_clause || 'promo_lifetime_spent = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_wallets' AND column_name='updated_at') THEN
      v_wallet_set_clause := v_wallet_set_clause || 'updated_at = now(),';
    END IF;

    IF v_wallet_set_clause <> '' THEN
      v_wallet_set_clause := left(v_wallet_set_clause, length(v_wallet_set_clause) - 1);
      EXECUTE 'UPDATE public.treat_wallets SET ' || v_wallet_set_clause;
      GET DIAGNOSTICS n_treat_wallets = ROW_COUNT;
    END IF;
  END IF;

  -- Zero users live earnings.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='total_earnings') THEN
    UPDATE public.users
    SET total_earnings = 0
    WHERE COALESCE(total_earnings, 0) <> 0;
    GET DIAGNOSTICS n_user_earnings = ROW_COUNT;
  END IF;

  -- Zero contribution score rows dynamically.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='listener_contribution_scores') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='listener_contribution_scores' AND column_name='total_points') THEN
      v_score_set_clause := v_score_set_clause || 'total_points = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='listener_contribution_scores' AND column_name='current_period_points') THEN
      v_score_set_clause := v_score_set_clause || 'current_period_points = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='listener_contribution_scores' AND column_name='playlist_creation_points') THEN
      v_score_set_clause := v_score_set_clause || 'playlist_creation_points = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='listener_contribution_scores' AND column_name='discovery_points') THEN
      v_score_set_clause := v_score_set_clause || 'discovery_points = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='listener_contribution_scores' AND column_name='curation_points') THEN
      v_score_set_clause := v_score_set_clause || 'curation_points = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='listener_contribution_scores' AND column_name='engagement_points') THEN
      v_score_set_clause := v_score_set_clause || 'engagement_points = 0,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='listener_contribution_scores' AND column_name='last_reward_date') THEN
      v_score_set_clause := v_score_set_clause || 'last_reward_date = NULL,';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='listener_contribution_scores' AND column_name='updated_at') THEN
      v_score_set_clause := v_score_set_clause || 'updated_at = now(),';
    END IF;

    IF v_score_set_clause <> '' THEN
      v_score_set_clause := left(v_score_set_clause, length(v_score_set_clause) - 1);
      EXECUTE 'UPDATE public.listener_contribution_scores SET ' || v_score_set_clause;
      GET DIAGNOSTICS n_contribution_scores = ROW_COUNT;
    END IF;
  END IF;

  -- Clear withdrawals so total withdrawn becomes zero in admin aggregates.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='withdrawal_requests') THEN
    DELETE FROM public.withdrawal_requests;
    GET DIAGNOSTICS n_withdrawals = ROW_COUNT;
  END IF;

  -- Zero treat purchase USD amount for revenue aggregates.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treat_payments' AND column_name='amount_usd') THEN
    UPDATE public.treat_payments
    SET amount_usd = 0
    WHERE COALESCE(amount_usd, 0) <> 0;
    GET DIAGNOSTICS n_treat_payments = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', jsonb_build_object(
      'accounting_journal_lines', n_accounting_lines,
      'accounting_journal_entries', n_accounting_entries,
      'treat_transactions', n_treat_transactions,
      'withdrawal_requests', n_withdrawals
    ),
    'updated', jsonb_build_object(
      'treat_wallets', n_treat_wallets,
      'users_total_earnings', n_user_earnings,
      'listener_contribution_scores', n_contribution_scores,
      'treat_payments_amount_usd', n_treat_payments
    ),
    'ad_revenue_reset', v_ad_reset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_all_financial_data(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_financial_data(text, boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_reset_all_financial_data(text, boolean) IS
  'Admin-only destructive reset. Clears core financial history and zeros balances/earnings to restart from zero. Requires confirm string RESET_ALL_FINANCIAL_DATA.';

