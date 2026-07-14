/*
  # Revoke Admin Function Grants from Authenticated Role

  1. Security Fix
    - Revoke EXECUTE permission on admin functions from authenticated role
    - Functions still have internal admin checks
    - Adds defense-in-depth security layer

  2. Critical Functions to Restrict
    - admin_approve_withdrawal
    - admin_reject_withdrawal
    - admin_get_payout_settings
    - admin_update_payout_settings
    - admin_get_withdrawal_requests
    - admin_get_revenue_summary
    - And other admin-prefixed functions

  Note: Functions will still check admin role internally,
  but this prevents even attempting to call them.
*/

-- Revoke admin withdrawal functions
DO $$
BEGIN
  -- Withdrawal management
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_approve_withdrawal') THEN
    REVOKE EXECUTE ON FUNCTION admin_approve_withdrawal FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_approve_withdrawal TO service_role;
    RAISE NOTICE 'Revoked admin_approve_withdrawal from authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_reject_withdrawal') THEN
    REVOKE EXECUTE ON FUNCTION admin_reject_withdrawal FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_reject_withdrawal TO service_role;
    RAISE NOTICE 'Revoked admin_reject_withdrawal from authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_bulk_approve_withdrawals') THEN
    REVOKE EXECUTE ON FUNCTION admin_bulk_approve_withdrawals FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_bulk_approve_withdrawals TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_bulk_reject_withdrawals') THEN
    REVOKE EXECUTE ON FUNCTION admin_bulk_reject_withdrawals FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_bulk_reject_withdrawals TO service_role;
  END IF;

  -- Payout settings
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_get_payout_settings') THEN
    REVOKE EXECUTE ON FUNCTION admin_get_payout_settings FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_get_payout_settings TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_update_payout_settings') THEN
    REVOKE EXECUTE ON FUNCTION admin_update_payout_settings FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_update_payout_settings TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_create_payout_settings') THEN
    REVOKE EXECUTE ON FUNCTION admin_create_payout_settings FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_create_payout_settings TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_get_withdrawal_requests') THEN
    REVOKE EXECUTE ON FUNCTION admin_get_withdrawal_requests FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_get_withdrawal_requests TO service_role;
  END IF;

  -- Revenue and analytics
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_get_revenue_summary') THEN
    REVOKE EXECUTE ON FUNCTION admin_get_revenue_summary FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_get_revenue_summary TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_get_ad_analytics') THEN
    REVOKE EXECUTE ON FUNCTION admin_get_ad_analytics FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_get_ad_analytics TO service_role;
  END IF;

  -- User management
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_update_user_status') THEN
    REVOKE EXECUTE ON FUNCTION admin_update_user_status FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_update_user_status TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_adjust_user_earnings') THEN
    REVOKE EXECUTE ON FUNCTION admin_adjust_user_earnings FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_adjust_user_earnings TO service_role;
  END IF;

  -- Financial controls
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_toggle_financial_control') THEN
    REVOKE EXECUTE ON FUNCTION admin_toggle_financial_control FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_toggle_financial_control TO service_role;
  END IF;

  -- Manual credit (keep authenticated but has internal check)
  -- admin_credit_payment_manually - keep accessible with internal admin check

  -- Contribution management
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_adjust_contribution_score') THEN
    REVOKE EXECUTE ON FUNCTION admin_adjust_contribution_score FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_adjust_contribution_score TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_reset_contribution_scores') THEN
    REVOKE EXECUTE ON FUNCTION admin_reset_contribution_scores FROM authenticated;
    GRANT EXECUTE ON FUNCTION admin_reset_contribution_scores TO service_role;
  END IF;

END $$;

-- Log completion
DO $$
DECLARE
  v_admin_functions integer;
BEGIN
  -- Count admin functions still granted to authenticated
  SELECT COUNT(*) INTO v_admin_functions
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname LIKE 'admin_%'
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  RAISE NOTICE '================================================================';
  RAISE NOTICE 'ADMIN FUNCTION GRANTS REVOKED';
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Revoked EXECUTE from authenticated role for:';
  RAISE NOTICE '  - Withdrawal management functions';
  RAISE NOTICE '  - Payout settings functions';
  RAISE NOTICE '  - Revenue/analytics functions';
  RAISE NOTICE '  - User management functions';
  RAISE NOTICE '  - Financial control functions';
  RAISE NOTICE '  - Contribution management functions';
  RAISE NOTICE '';
  RAISE NOTICE 'Remaining admin functions with authenticated access: %', v_admin_functions;
  RAISE NOTICE '(These have internal admin role checks)';
  RAISE NOTICE '================================================================';
END $$;
