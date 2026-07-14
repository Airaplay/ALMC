/*
  # Fix Search Path for Confirmed Critical Functions
  
  ## Security Issue
  Fix only functions confirmed to exist with exact signatures.
  
  ## Changes
  Add SET search_path = public, pg_temp to verified functions
*/

-- Referral System (Confirmed)
ALTER FUNCTION public.auto_generate_referral_code()
SET search_path = public, pg_temp;

ALTER FUNCTION public.generate_referral_code(p_user_id uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.check_referral_limit(p_user_id uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.check_referral_reward()
SET search_path = public, pg_temp;

ALTER FUNCTION public.process_referral_reward(p_referred_id uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.increment_referral_counts(p_user_id uuid)
SET search_path = public, pg_temp;

ALTER FUNCTION public.reset_monthly_referral_counts()
SET search_path = public, pg_temp;

ALTER FUNCTION public.admin_process_all_pending_referrals()
SET search_path = public, pg_temp;

-- Daily Checkin (Confirmed)
ALTER FUNCTION public.process_daily_checkin(target_user_id uuid, ad_impression_id_param uuid)
SET search_path = public, pg_temp;

-- Tipping (Confirmed)
ALTER FUNCTION public.send_treat_tip(
  sender_uuid uuid,
  recipient_uuid uuid,
  amount_param numeric,
  message_param text,
  content_id_param uuid,
  content_type_param text
)
SET search_path = public, pg_temp;

ALTER FUNCTION public.process_treat_tip(
  sender_uuid uuid,
  recipient_uuid uuid,
  amount_param numeric,
  message_param text,
  content_id_param uuid,
  content_type_param text
)
SET search_path = public, pg_temp;

ALTER FUNCTION public.process_treat_tip_transactions()
SET search_path = public, pg_temp;
