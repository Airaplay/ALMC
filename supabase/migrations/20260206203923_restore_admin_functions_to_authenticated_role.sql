/*
  # Restore Admin Functions to Authenticated Role

  ## Issue
  The previous migration revoked EXECUTE on admin functions from `authenticated` role,
  but even admin users authenticate as `authenticated` in Postgres. This caused the
  admin dashboard to fail because the RPC calls were rejected at the GRANT level
  before reaching the internal admin role checks within the functions.

  ## Solution
  Re-grant EXECUTE permission on admin functions to `authenticated` role.
  Security is maintained because each function has internal checks that verify
  the user's role from the `users` table before performing any operations.

  ## Changes
  Restore EXECUTE grants for functions that exist and were revoked.
*/

-- Withdrawal functions (safe to grant - internal checks verify admin role)
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_approve_withdrawal TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_reject_withdrawal TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_bulk_approve_withdrawals TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_bulk_reject_withdrawals TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_get_withdrawal_requests TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_export_approved_withdrawals TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_detect_withdrawal_anomalies TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_approve_withdrawal_with_reserve_check TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Payout settings
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_get_payout_settings TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_update_payout_settings TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_create_payout_settings TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_get_withdrawal_settings TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_update_withdrawal_settings TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Revenue and analytics
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_get_revenue_summary TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_get_ad_analytics TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_get_financial_dashboard TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_get_financial_controls TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_input_daily_admob_revenue TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- User management
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_update_user_status TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_adjust_user_earnings TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Financial controls
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION check_reserve_requirements TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Treat functions
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_add_treats_to_user TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_remove_treats_from_user TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_credit_payment_manually TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Contribution management
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_adjust_contribution_score TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_get_all_contribution_scores TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_get_contribution_adjustments TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Curator admin
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_get_top_curated_playlists TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_feature_playlist TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_block_curator_monetization TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Exchange rates
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_update_exchange_rate TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Promo stats
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION admin_get_promo_stats TO authenticated;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

/*
  Security Note:
  These functions are safe to grant to `authenticated` because:
  1. Each function internally checks if the caller has admin/manager/editor role
  2. They use SECURITY DEFINER with proper search_path
  3. They validate auth.uid() against the users table role column
  4. No function performs actions without first verifying the caller's permissions
  
  This is defense-in-depth: the GRANT allows authenticated users to call the functions,
  but the functions themselves verify admin privileges before executing any operations.
*/
