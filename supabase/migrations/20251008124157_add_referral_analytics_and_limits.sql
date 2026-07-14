/*
  # Add Referral Analytics and Limits

  1. Changes to Tables
    - `referral_settings`
      - Add `max_referrals_monthly` (integer, default null for unlimited)
      - Add `max_referrals_lifetime` (integer, default null for unlimited)
      - Add `program_active` (boolean, default true)
      - Add `detect_abuse` (boolean, default true)
    
    - `referral_codes`
      - Add `monthly_referrals` (integer, default 0)
      - Add `lifetime_referrals` (integer, default 0)
      - Add `last_referral_reset` (timestamp, default now())
    
    - `referrals`
      - Add `treat_spent` (integer, default 0) - tracks treats spent from referral rewards
      - Add `is_active` (boolean, default false) - tracks if user is currently active
      - Add `last_activity` (timestamp, nullable) - last time user was active
      - Add `flagged_for_abuse` (boolean, default false)

  2. New Views
    - `referral_analytics_overview` - aggregated stats for admin dashboard

  3. New Functions
    - `reset_monthly_referral_counts()` - resets monthly counts
    - `check_referral_limit()` - checks if user can receive more referrals

  4. Security
    - Admin-only policies for viewing all referral data
    - Service role functions for limit checking
*/

-- Add new columns to referral_settings
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'referral_settings' AND column_name = 'max_referrals_monthly'
  ) THEN
    ALTER TABLE referral_settings 
    ADD COLUMN max_referrals_monthly integer DEFAULT NULL,
    ADD COLUMN max_referrals_lifetime integer DEFAULT NULL,
    ADD COLUMN program_active boolean DEFAULT true,
    ADD COLUMN detect_abuse boolean DEFAULT true;
  END IF;
END $$;

-- Add new columns to referral_codes
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'referral_codes' AND column_name = 'monthly_referrals'
  ) THEN
    ALTER TABLE referral_codes 
    ADD COLUMN monthly_referrals integer DEFAULT 0,
    ADD COLUMN lifetime_referrals integer DEFAULT 0,
    ADD COLUMN last_referral_reset timestamptz DEFAULT now();
  END IF;
END $$;

-- Add new columns to referrals
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'referrals' AND column_name = 'treat_spent'
  ) THEN
    ALTER TABLE referrals 
    ADD COLUMN treat_spent integer DEFAULT 0,
    ADD COLUMN is_active boolean DEFAULT false,
    ADD COLUMN last_activity timestamptz DEFAULT NULL,
    ADD COLUMN flagged_for_abuse boolean DEFAULT false;
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_referrals_is_active ON referrals(is_active);
CREATE INDEX IF NOT EXISTS idx_referrals_flagged ON referrals(flagged_for_abuse);
CREATE INDEX IF NOT EXISTS idx_referral_codes_user_id ON referral_codes(user_id);

-- Create view for referral analytics overview
CREATE OR REPLACE VIEW referral_analytics_overview AS
SELECT 
  COUNT(DISTINCT r.id) as total_referrals,
  COUNT(DISTINCT CASE WHEN r.is_active = true THEN r.id END) as active_referrals,
  COUNT(DISTINCT CASE WHEN r.is_active = false THEN r.id END) as inactive_referrals,
  COUNT(DISTINCT CASE WHEN r.status = 'rewarded' THEN r.id END) as rewarded_referrals,
  COUNT(DISTINCT CASE WHEN r.flagged_for_abuse = true THEN r.id END) as flagged_referrals,
  COALESCE(SUM(r.treat_spent), 0) as total_treats_spent_on_promotions,
  COALESCE(SUM(r.reward_amount), 0) as total_treats_rewarded,
  COUNT(DISTINCT r.referrer_id) as unique_referrers,
  COUNT(DISTINCT r.referred_id) as unique_referred_users
FROM referrals r;

-- Function to reset monthly referral counts
CREATE OR REPLACE FUNCTION reset_monthly_referral_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE referral_codes
  SET 
    monthly_referrals = 0,
    last_referral_reset = now()
  WHERE last_referral_reset < date_trunc('month', now());
END;
$$;

-- Function to check if user can receive more referral rewards
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
BEGIN
  -- Get current settings
  SELECT * INTO v_settings
  FROM referral_settings
  ORDER BY created_at DESC
  LIMIT 1;

  -- Check if program is active
  IF v_settings.program_active = false THEN
    RETURN jsonb_build_object(
      'can_refer', false,
      'reason', 'Referral program is currently inactive'
    );
  END IF;

  -- Get user's referral code stats
  SELECT * INTO v_code
  FROM referral_codes
  WHERE user_id = p_user_id;

  -- Check monthly limit
  IF v_settings.max_referrals_monthly IS NOT NULL THEN
    IF v_code.monthly_referrals >= v_settings.max_referrals_monthly THEN
      v_can_refer := false;
      v_reason := 'Monthly referral limit reached';
    END IF;
  END IF;

  -- Check lifetime limit
  IF v_settings.max_referrals_lifetime IS NOT NULL THEN
    IF v_code.lifetime_referrals >= v_settings.max_referrals_lifetime THEN
      v_can_refer := false;
      v_reason := 'Lifetime referral limit reached';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'can_refer', v_can_refer,
    'reason', v_reason,
    'monthly_count', v_code.monthly_referrals,
    'lifetime_count', v_code.lifetime_referrals,
    'monthly_limit', v_settings.max_referrals_monthly,
    'lifetime_limit', v_settings.max_referrals_lifetime
  );
END;
$$;

-- Function to increment referral counts
CREATE OR REPLACE FUNCTION increment_referral_counts(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE referral_codes
  SET 
    monthly_referrals = monthly_referrals + 1,
    lifetime_referrals = lifetime_referrals + 1,
    updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

-- Add RLS policies for admin access to referral analytics
CREATE POLICY "Admins can view all referral data"
  ON referrals
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Create policy for service role to update referral data
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'referral_codes' 
    AND policyname = 'Service role can update referral codes'
  ) THEN
    CREATE POLICY "Service role can update referral codes"
      ON referral_codes
      FOR UPDATE
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'referrals' 
    AND policyname = 'Service role can update referrals'
  ) THEN
    CREATE POLICY "Service role can update referrals"
      ON referrals
      FOR UPDATE
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;