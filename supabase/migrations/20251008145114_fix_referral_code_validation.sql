/*
  # Fix Referral Code Validation

  1. Changes
    - Update `check_referral_limit` function to handle cases where user doesn't have a referral code yet
    - Allow validation to succeed for users who haven't generated their own referral code
    - Only check limits if the referrer has a referral code record
  
  2. Behavior
    - If user doesn't have a referral code record yet, validation passes
    - If user has a referral code record, check monthly and lifetime limits
    - Referral program must still be active for validation to pass
*/

-- Update the check_referral_limit function to handle NULL referral codes
CREATE OR REPLACE FUNCTION check_referral_limit(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settings record;
  v_code record;
  v_can_refer boolean := true;
  v_reason text := null;
  v_monthly_count integer := 0;
  v_lifetime_count integer := 0;
BEGIN
  -- Get current settings
  SELECT * INTO v_settings
  FROM referral_settings
  ORDER BY created_at DESC
  LIMIT 1;

  -- If no settings exist, allow referral
  IF v_settings IS NULL THEN
    RETURN jsonb_build_object(
      'can_refer', true,
      'reason', null,
      'monthly_count', 0,
      'lifetime_count', 0,
      'monthly_limit', null,
      'lifetime_limit', null
    );
  END IF;

  -- Check if program is active
  IF v_settings.program_active = false THEN
    RETURN jsonb_build_object(
      'can_refer', false,
      'reason', 'Referral program is currently inactive'
    );
  END IF;

  -- Get user's referral code stats (may not exist yet)
  SELECT * INTO v_code
  FROM referral_codes
  WHERE user_id = p_user_id;

  -- If user doesn't have a referral code yet, they can refer (no limits applied)
  IF v_code IS NULL THEN
    RETURN jsonb_build_object(
      'can_refer', true,
      'reason', null,
      'monthly_count', 0,
      'lifetime_count', 0,
      'monthly_limit', v_settings.max_referrals_monthly,
      'lifetime_limit', v_settings.max_referrals_lifetime
    );
  END IF;

  -- Get current counts from the record
  v_monthly_count := COALESCE(v_code.monthly_referrals, 0);
  v_lifetime_count := COALESCE(v_code.lifetime_referrals, 0);

  -- Check monthly limit if set
  IF v_settings.max_referrals_monthly IS NOT NULL THEN
    IF v_monthly_count >= v_settings.max_referrals_monthly THEN
      v_can_refer := false;
      v_reason := 'Monthly referral limit reached';
    END IF;
  END IF;

  -- Check lifetime limit if set
  IF v_settings.max_referrals_lifetime IS NOT NULL THEN
    IF v_lifetime_count >= v_settings.max_referrals_lifetime THEN
      v_can_refer := false;
      v_reason := 'Lifetime referral limit reached';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'can_refer', v_can_refer,
    'reason', v_reason,
    'monthly_count', v_monthly_count,
    'lifetime_count', v_lifetime_count,
    'monthly_limit', v_settings.max_referrals_monthly,
    'lifetime_limit', v_settings.max_referrals_lifetime
  );
END;
$$;