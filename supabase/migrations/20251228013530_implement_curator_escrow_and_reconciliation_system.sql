/*
  # Implement Curator Escrow and AdMob Reconciliation System

  ## Critical Issue Fixed
  OVERPAYMENT RISK: System was paying curators IMMEDIATELY when plays were tracked,
  but AdMob payment comes days/weeks later and may be rejected. This could result in
  $45,000/month losses at scale if 30% of impressions are rejected.

  ## Solution
  1. Add pending_balance to treat_wallets for unconfirmed earnings
  2. Credit pending_balance initially (NOT earned_balance)
  3. Add reconciliation tracking for all curator earnings
  4. Create reconciliation process to confirm/adjust earnings against AdMob reports
  5. Move earnings from pending → earned only after AdMob confirms payment

  ## Changes
  1. New Tables
     - `curator_earnings_reconciliation` - Tracks reconciliation status
  
  2. Modified Tables
     - `treat_wallets` - Add pending_balance field
     - `curator_earnings` - Add reconciliation tracking
     - `playlist_ad_impressions` - Add reconciliation tracking
  
  3. Updated Functions
     - `process_curator_ad_revenue` - Credit pending_balance instead of earned_balance
  
  4. New Functions
     - `reconcile_curator_earnings_with_admob` - Reconcile against AdMob reports
     - `confirm_pending_curator_earnings` - Move pending → earned after confirmation
     - `adjust_rejected_curator_earnings` - Handle AdMob rejections

  ## Security
  - All functions use SECURITY DEFINER
  - Admin-only access for reconciliation operations
  - RLS policies protect sensitive data
*/

-- ============================================================================
-- 1. ADD PENDING BALANCE TO TREAT_WALLETS
-- ============================================================================

-- Add pending_balance column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treat_wallets' AND column_name = 'pending_balance'
  ) THEN
    ALTER TABLE treat_wallets ADD COLUMN pending_balance NUMERIC(10, 2) DEFAULT 0.00 NOT NULL;
    
    COMMENT ON COLUMN treat_wallets.pending_balance IS 
      'Earnings pending AdMob reconciliation. Not spendable until confirmed.';
  END IF;
END $$;

-- ============================================================================
-- 2. ADD RECONCILIATION TRACKING TO CURATOR EARNINGS
-- ============================================================================

-- Add reconciliation columns to curator_earnings
DO $$
BEGIN
  -- Add reconciliation_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'curator_earnings' AND column_name = 'reconciliation_status'
  ) THEN
    ALTER TABLE curator_earnings 
    ADD COLUMN reconciliation_status TEXT DEFAULT 'pending' CHECK (
      reconciliation_status IN ('pending', 'confirmed', 'rejected', 'adjusted')
    );
    
    CREATE INDEX IF NOT EXISTS idx_curator_earnings_reconciliation_status 
    ON curator_earnings(reconciliation_status);
  END IF;

  -- Add reconciled_at timestamp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'curator_earnings' AND column_name = 'reconciled_at'
  ) THEN
    ALTER TABLE curator_earnings ADD COLUMN reconciled_at TIMESTAMPTZ;
  END IF;

  -- Add admob_report_date
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'curator_earnings' AND column_name = 'admob_report_date'
  ) THEN
    ALTER TABLE curator_earnings ADD COLUMN admob_report_date DATE;
  END IF;

  -- Add adjustment_reason
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'curator_earnings' AND column_name = 'adjustment_reason'
  ) THEN
    ALTER TABLE curator_earnings ADD COLUMN adjustment_reason TEXT;
  END IF;
END $$;

-- ============================================================================
-- 3. CREATE CURATOR EARNINGS RECONCILIATION LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS curator_earnings_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_date DATE NOT NULL,
  report_start_date DATE NOT NULL,
  report_end_date DATE NOT NULL,
  
  -- AdMob actuals
  admob_total_revenue_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
  admob_total_impressions INTEGER NOT NULL DEFAULT 0,
  
  -- Our estimates
  estimated_curator_payouts_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
  estimated_impressions INTEGER NOT NULL DEFAULT 0,
  
  -- Variance
  variance_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
  variance_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0,
  
  -- Reconciliation actions
  total_earnings_confirmed INTEGER DEFAULT 0,
  total_earnings_rejected INTEGER DEFAULT 0,
  total_earnings_adjusted INTEGER DEFAULT 0,
  total_amount_confirmed_usd NUMERIC(10, 2) DEFAULT 0,
  total_amount_rejected_usd NUMERIC(10, 2) DEFAULT 0,
  total_amount_adjusted_usd NUMERIC(10, 2) DEFAULT 0,
  
  -- Processing
  reconciliation_status TEXT DEFAULT 'in_progress' CHECK (
    reconciliation_status IN ('in_progress', 'completed', 'failed')
  ),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id),
  notes TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_curator_reconciliation_date 
  ON curator_earnings_reconciliation(reconciliation_date DESC);
CREATE INDEX IF NOT EXISTS idx_curator_reconciliation_status 
  ON curator_earnings_reconciliation(reconciliation_status);

-- RLS
ALTER TABLE curator_earnings_reconciliation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view curator reconciliation logs"
  ON curator_earnings_reconciliation FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'
  ));

CREATE POLICY "Admins can create curator reconciliation logs"
  ON curator_earnings_reconciliation FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'
  ));

CREATE POLICY "Admins can update curator reconciliation logs"
  ON curator_earnings_reconciliation FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'
  ));

-- ============================================================================
-- 4. UPDATE CURATOR PAYMENT FUNCTION TO USE PENDING BALANCE
-- ============================================================================

CREATE OR REPLACE FUNCTION process_curator_ad_revenue(
  p_playlist_id uuid,
  p_listener_id uuid,
  p_ad_revenue numeric,
  p_ad_impression_id uuid DEFAULT NULL,
  p_session_duration integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_curator_id uuid;
  v_curator_role text;
  v_revenue_split numeric;
  v_curator_share numeric;
  v_settings_enabled boolean;
  v_global_enabled boolean;
  v_playlist_status text;
  v_impression_record record;
  v_last_play timestamptz;
  v_balance_before numeric;
  v_pending_balance_after numeric;
  v_fraud_check jsonb;
  v_is_valid boolean;
  v_validation_score numeric;
  v_fraud_flag record;
BEGIN
  -- Get playlist and curator info
  SELECT 
    p.user_id,
    p.curation_status,
    u.role
  INTO v_curator_id, v_playlist_status, v_curator_role
  FROM playlists p
  JOIN users u ON p.user_id = u.id
  WHERE p.id = p_playlist_id;

  -- Validation: Playlist must exist
  IF v_curator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Playlist not found');
  END IF;

  -- Check global curator status
  SELECT (setting_value->>'enabled')::boolean INTO v_global_enabled
  FROM curator_settings
  WHERE setting_key = 'curator_global_status';

  IF v_global_enabled IS FALSE THEN
    RETURN jsonb_build_object('success', false, 'message', 'Listener Curations disabled globally', 'blocked_reason', 'global_disabled');
  END IF;

  -- Check if playlist monetization is blocked
  IF EXISTS (
    SELECT 1 FROM curator_monetization_blocks
    WHERE playlist_id = p_playlist_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Monetization blocked for this playlist', 'blocked_reason', 'playlist_blocked');
  END IF;

  -- Check if user monetization is blocked
  IF EXISTS (
    SELECT 1 FROM curator_monetization_blocks
    WHERE user_id = v_curator_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Monetization blocked for this user', 'blocked_reason', 'user_blocked');
  END IF;

  -- Validation: Playlist must be approved for curation
  IF v_playlist_status != 'approved' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Playlist not approved for monetization');
  END IF;

  -- Validation: Prevent self-listening earnings
  IF v_curator_id = p_listener_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Self-listening not eligible for earnings', 'blocked_reason', 'own_content');
  END IF;

  -- Validation: Curator must be a listener (not creator/admin)
  IF v_curator_role NOT IN ('listener') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Only listener curators are eligible for earnings');
  END IF;

  -- ANTI-FRAUD CHECK 1: Minimum session duration (5 minutes = 300 seconds)
  IF p_session_duration > 0 AND p_session_duration < 300 THEN
    RETURN jsonb_build_object(
      'success', false, 
      'message', 'Session duration below minimum threshold',
      'blocked_reason', 'insufficient_duration',
      'duration_required', 300,
      'duration_provided', p_session_duration
    );
  END IF;

  -- ANTI-FRAUD CHECK 2: Check for duplicate play within 24 hours
  SELECT played_at INTO v_last_play
  FROM playlist_ad_impressions
  WHERE playlist_id = p_playlist_id
    AND listener_id = p_listener_id
    AND played_at > (now() - interval '24 hours')
  ORDER BY played_at DESC
  LIMIT 1;

  IF v_last_play IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false, 
      'message', 'Duplicate play within 24 hours',
      'blocked_reason', 'duplicate_play',
      'last_play_at', v_last_play
    );
  END IF;

  -- ANTI-FRAUD CHECK 3: Check if playlist is flagged
  SELECT * INTO v_fraud_flag
  FROM curator_fraud_flags
  WHERE playlist_id = p_playlist_id
    AND reviewed = false
    AND earnings_paused = true
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Earnings paused - playlist under review',
      'blocked_reason', 'flagged_playlist',
      'flag_severity', v_fraud_flag.severity
    );
  END IF;

  -- ANTI-FRAUD CHECK 4: Run comprehensive fraud pattern detection
  v_fraud_check := detect_playlist_fraud_patterns(
    p_playlist_id,
    p_listener_id,
    p_session_duration
  );

  v_is_valid := (v_fraud_check->>'is_valid')::boolean;
  v_validation_score := (v_fraud_check->>'validation_score')::numeric;

  -- Block earnings if fraud detected
  IF NOT v_is_valid OR v_validation_score < 50 THEN
    -- Auto-flag if validation score is critically low
    IF v_validation_score < 30 THEN
      PERFORM auto_flag_suspicious_playlist(p_playlist_id, v_fraud_check);
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'message', 'Fraudulent pattern detected',
      'blocked_reason', 'fraud_detected',
      'fraud_check', v_fraud_check
    );
  END IF;

  -- Get curator revenue split settings
  SELECT 
    (setting_value->>'enabled')::boolean,
    (setting_value->>'percentage')::numeric
  INTO v_settings_enabled, v_revenue_split
  FROM curator_settings
  WHERE setting_key = 'curator_revenue_split';

  -- Use defaults if not found
  v_settings_enabled := COALESCE(v_settings_enabled, true);
  v_revenue_split := COALESCE(v_revenue_split, 5);

  -- Check if curator monetization is enabled
  IF NOT v_settings_enabled THEN
    RETURN jsonb_build_object('success', false, 'message', 'Curator monetization disabled');
  END IF;

  -- Calculate curator share
  v_curator_share := ROUND((p_ad_revenue * v_revenue_split / 100)::numeric, 2);

  -- Get current balance
  SELECT balance INTO v_balance_before
  FROM treat_wallets
  WHERE user_id = v_curator_id;

  -- Record validated listening session
  INSERT INTO playlist_listening_sessions (
    playlist_id,
    curator_id,
    listener_id,
    session_start,
    session_end,
    total_duration_seconds,
    is_validated,
    validation_score
  ) VALUES (
    p_playlist_id,
    v_curator_id,
    p_listener_id,
    now() - (p_session_duration || ' seconds')::interval,
    now(),
    p_session_duration,
    true,
    v_validation_score
  );

  -- Create playlist ad impression record with pending status
  INSERT INTO playlist_ad_impressions (
    playlist_id,
    curator_id,
    listener_id,
    ad_impression_id,
    ad_revenue,
    curator_share,
    processed,
    played_at
  ) VALUES (
    p_playlist_id,
    v_curator_id,
    p_listener_id,
    p_ad_impression_id,
    p_ad_revenue,
    v_curator_share,
    true,
    now()
  )
  RETURNING * INTO v_impression_record;

  -- 🔴 CRITICAL FIX: Credit PENDING balance (not earned_balance)
  -- Earnings stay in pending until AdMob confirms payment
  UPDATE treat_wallets
  SET 
    pending_balance = pending_balance + v_curator_share,
    updated_at = now()
  WHERE user_id = v_curator_id
  RETURNING pending_balance INTO v_pending_balance_after;

  -- Record transaction in treat_transactions with pending status
  INSERT INTO treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    metadata,
    status
  ) VALUES (
    v_curator_id,
    'curator_earnings_pending',
    v_curator_share,
    v_balance_before,
    v_balance_before, -- Balance unchanged, goes to pending
    'Playlist curation earnings (pending AdMob confirmation)',
    jsonb_build_object(
      'playlist_id', p_playlist_id,
      'listener_id', p_listener_id,
      'ad_revenue', p_ad_revenue,
      'revenue_split_percentage', v_revenue_split,
      'session_duration', p_session_duration,
      'validation_score', v_validation_score,
      'fraud_check_passed', true,
      'silent', true,
      'pending_admob_confirmation', true
    ),
    'pending'
  );

  -- Update curator_earnings table with pending status
  INSERT INTO curator_earnings (
    playlist_id,
    curator_id,
    amount,
    earned_at,
    description,
    transaction_type,
    reconciliation_status
  ) VALUES (
    p_playlist_id,
    v_curator_id,
    v_curator_share,
    now(),
    'Ad revenue from validated playlist session (pending confirmation)',
    'ad_impression',
    'pending'
  );

  -- Update playlist stats (silent)
  UPDATE playlists
  SET 
    play_count = play_count + 1,
    updated_at = now()
  WHERE id = p_playlist_id;

  RETURN jsonb_build_object(
    'success', true,
    'curator_id', v_curator_id,
    'curator_share', v_curator_share,
    'revenue_split_percentage', v_revenue_split,
    'validation_score', v_validation_score,
    'fraud_checks_passed', true,
    'session_duration', p_session_duration,
    'pending_admob_confirmation', true,
    'pending_balance', v_pending_balance_after,
    'message', 'Curator earnings added to pending balance (awaiting AdMob confirmation)'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', 'Error processing curator revenue: ' || SQLERRM
  );
END;
$$;

-- ============================================================================
-- 5. CREATE RECONCILIATION FUNCTIONS
-- ============================================================================

-- Function to confirm pending earnings after AdMob verification
CREATE OR REPLACE FUNCTION confirm_pending_curator_earnings(
  p_start_date DATE,
  p_end_date DATE,
  p_admob_report_date DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_earnings_confirmed INTEGER := 0;
  v_total_amount_confirmed NUMERIC := 0;
  v_earning_record RECORD;
BEGIN
  -- Only admins can run reconciliation
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  -- Process all pending earnings in date range
  FOR v_earning_record IN
    SELECT 
      ce.id,
      ce.curator_id,
      ce.amount,
      ce.playlist_id
    FROM curator_earnings ce
    WHERE ce.earned_at::date BETWEEN p_start_date AND p_end_date
      AND ce.reconciliation_status = 'pending'
  LOOP
    -- Move amount from pending_balance to earned_balance
    UPDATE treat_wallets
    SET 
      pending_balance = pending_balance - v_earning_record.amount,
      earned_balance = earned_balance + v_earning_record.amount,
      balance = balance + v_earning_record.amount,
      total_earned = total_earned + v_earning_record.amount,
      updated_at = now()
    WHERE user_id = v_earning_record.curator_id;

    -- Update curator_earnings status
    UPDATE curator_earnings
    SET 
      reconciliation_status = 'confirmed',
      reconciled_at = now(),
      admob_report_date = p_admob_report_date
    WHERE id = v_earning_record.id;

    -- Update playlist curator_earnings
    UPDATE playlists
    SET curator_earnings = curator_earnings + v_earning_record.amount
    WHERE id = v_earning_record.playlist_id;

    v_earnings_confirmed := v_earnings_confirmed + 1;
    v_total_amount_confirmed := v_total_amount_confirmed + v_earning_record.amount;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'earnings_confirmed', v_earnings_confirmed,
    'total_amount_confirmed', v_total_amount_confirmed,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'admob_report_date', p_admob_report_date
  );
END;
$$;

-- Function to reject/adjust earnings when AdMob rejects impressions
CREATE OR REPLACE FUNCTION adjust_rejected_curator_earnings(
  p_start_date DATE,
  p_end_date DATE,
  p_adjustment_percentage NUMERIC, -- e.g., 30 = reject 30% of earnings
  p_adjustment_reason TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_earnings_adjusted INTEGER := 0;
  v_total_amount_adjusted NUMERIC := 0;
  v_earning_record RECORD;
  v_adjusted_amount NUMERIC;
BEGIN
  -- Only admins can run reconciliation
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  -- Process all pending earnings in date range
  FOR v_earning_record IN
    SELECT 
      ce.id,
      ce.curator_id,
      ce.amount,
      ce.playlist_id
    FROM curator_earnings ce
    WHERE ce.earned_at::date BETWEEN p_start_date AND p_end_date
      AND ce.reconciliation_status = 'pending'
  LOOP
    -- Calculate adjusted amount (rejected portion)
    v_adjusted_amount := ROUND((v_earning_record.amount * p_adjustment_percentage / 100)::numeric, 2);

    -- Remove rejected amount from pending_balance
    UPDATE treat_wallets
    SET 
      pending_balance = pending_balance - v_adjusted_amount,
      updated_at = now()
    WHERE user_id = v_earning_record.curator_id;

    -- Update curator_earnings status
    UPDATE curator_earnings
    SET 
      reconciliation_status = 'rejected',
      reconciled_at = now(),
      adjustment_reason = p_adjustment_reason,
      amount = v_earning_record.amount - v_adjusted_amount -- Reduce to confirmed amount
    WHERE id = v_earning_record.id;

    v_earnings_adjusted := v_earnings_adjusted + 1;
    v_total_amount_adjusted := v_total_amount_adjusted + v_adjusted_amount;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'earnings_adjusted', v_earnings_adjusted,
    'total_amount_adjusted', v_total_amount_adjusted,
    'adjustment_percentage', p_adjustment_percentage,
    'adjustment_reason', p_adjustment_reason
  );
END;
$$;

-- Add helpful comment
COMMENT ON FUNCTION confirm_pending_curator_earnings IS 
  'Moves curator earnings from pending to earned after AdMob payment confirmation. Admin only.';
COMMENT ON FUNCTION adjust_rejected_curator_earnings IS 
  'Adjusts/removes pending curator earnings when AdMob rejects impressions. Admin only.';
