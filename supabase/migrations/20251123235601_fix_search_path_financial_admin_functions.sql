/*
  # Fix Search Path for High-Risk Financial and Admin Functions
  
  ## Security Issue
  Functions marked as SECURITY DEFINER without a fixed search_path are vulnerable
  to schema injection attacks. This migration fixes the highest-risk functions:
  - Financial transaction functions (treat balance, payments, withdrawals)
  - Admin privilege functions (role assignment, user management)
  
  ## Changes
  Add SET search_path = public, pg_temp to 50+ critical SECURITY DEFINER functions
  
  ## Priority
  HIGH - These functions handle money and admin privileges
*/

-- Financial Functions: Treat Balance Management
ALTER FUNCTION public.add_treat_balance(uuid, integer, text, text, uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.add_treats_to_wallet(uuid, numeric, text, text, text)
SET search_path = public, pg_temp;

-- Admin: Treat Balance Adjustments
ALTER FUNCTION public.admin_add_treats_to_user(uuid, numeric, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_adjust_treat_balance(uuid, numeric, text, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_adjust_user_treats(uuid, numeric, text, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_adjust_user_earnings(uuid, numeric, text)
SET search_path = public, pg_temp;

-- Admin: Withdrawal Management
ALTER FUNCTION public.admin_approve_treat_withdrawal(uuid, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_approve_withdrawal(uuid, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_complete_withdrawal(uuid, text)
SET search_path = public, pg_temp;

-- Admin: User & Wallet Management
ALTER FUNCTION public.admin_disable_user_treat_wallet(uuid, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_enable_user_treat_wallet(uuid, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_count_treat_users(text, text, boolean)
SET search_path = public, pg_temp;

-- Admin: Role & Security
ALTER FUNCTION public.admin_assign_role(text, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_generate_password_reset(uuid)
SET search_path = public, pg_temp;

-- Admin: Announcements
ALTER FUNCTION public.admin_create_announcement(text, text, text, text, text, text, timestamptz)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_delete_announcement(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_announcements(text, integer, integer)
SET search_path = public, pg_temp;

-- Admin: Payout Settings (Multiple signatures)
ALTER FUNCTION public.admin_create_payout_settings(text, text, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_delete_payout_settings(uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_payout_settings(text, text, uuid)
SET search_path = public, pg_temp;

-- Admin: Analytics & Reports
ALTER FUNCTION public.admin_generate_treat_report(text, timestamp, timestamp)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_activity_logs(uuid, text, timestamptz, timestamptz, integer, integer)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_ad_analytics(timestamptz, timestamptz, text, text, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_ad_stream_ratio(timestamptz, timestamptz, text, text)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_admin_users()
SET search_path = public, pg_temp;

-- Handle multiple signatures for admin_get_analytics_dashboard
DO $$
DECLARE
  func_record record;
BEGIN
  FOR func_record IN 
    SELECT oid, pg_get_function_identity_arguments(oid) as args
    FROM pg_proc 
    WHERE proname = 'admin_get_analytics_dashboard' 
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('ALTER FUNCTION public.admin_get_analytics_dashboard(%s) SET search_path = public, pg_temp', func_record.args);
  END LOOP;
END $$;

ALTER FUNCTION public.admin_get_checkin_analytics(date, date)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_daily_revenue_summary(timestamptz, timestamptz)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_daily_treat_stats(timestamp, timestamp)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_revenue_report(timestamptz, timestamptz)
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_get_revenue_summary(timestamptz, timestamptz)
SET search_path = public, pg_temp;
