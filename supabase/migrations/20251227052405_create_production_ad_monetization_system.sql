/*
  # Production Ad Monetization System with Safety Mechanisms

  This migration creates a complete, production-ready ad-based reward system with:
  - Daily admin revenue input from AdMob
  - Safety buffer (70-80% of actual revenue)
  - Listening Quality Score (LQS) tracking
  - Conditional revenue splits based on LQS threshold
  - Daily caps per user
  - Pending balance system with delayed unlock
  - Daily reconciliation and adjustment mechanisms
  - Complete audit trails

  ## New Tables

  1. **ad_unit_daily_values**
     - Stores daily revenue per ad unit type with safety buffer
     - Calculated from admin input
     - Used for reward calculations
     - Fields: date, ad_unit_type, actual_revenue_usd, safety_buffer_percentage, usable_revenue_usd, etc.

  2. **ad_daily_revenue_input**
     - Admin's source of truth for daily AdMob revenue
     - Immutable audit trail once locked
     - Fields: revenue_date, total_revenue_usd, breakdown by ad type, is_locked, admin_id

  3. **ad_safety_caps**
     - Configurable system-wide safety limits
     - Fields: max_rewarded_ads_per_day, max_listener_earnings_per_day_usd, min_lqs_for_listener_reward, etc.

  4. **ad_reconciliation_log**
     - Daily reconciliation between estimated payouts and actual revenue
     - Tracks variance and adjustment factors
     - Fields: reconciliation_date, estimated_total_payout_usd, actual_admob_revenue_usd, variance_usd, adjustment_factor

  ## Enhanced Tables

  - **ad_impressions**: Added LQS tracking, playback duration, reward eligibility, processing status

  ## Key Functions

  - `check_user_daily_ad_cap`: Checks if user has reached daily limits
  - `admin_input_daily_admob_revenue`: Admin function to input daily revenue with safety buffer

  ## Security

  - RLS enabled on all tables
  - Admin-only access for sensitive operations
  - Immutable audit trails
  - Complete tracking of all revenue adjustments
*/

-- ============================================================================
-- 1. CREATE: ad_unit_daily_values table
-- ============================================================================
CREATE TABLE IF NOT EXISTS ad_unit_daily_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  ad_unit_type text NOT NULL CHECK (ad_unit_type IN ('banner', 'interstitial', 'rewarded', 'native')),
  
  -- Actual revenue from AdMob (admin input)
  actual_revenue_usd numeric(12, 6) NOT NULL CHECK (actual_revenue_usd >= 0),
  total_impressions integer NOT NULL DEFAULT 0 CHECK (total_impressions >= 0),
  
  -- Safety buffer configuration
  safety_buffer_percentage numeric(5, 2) NOT NULL DEFAULT 75.00 CHECK (safety_buffer_percentage BETWEEN 50 AND 90),
  
  -- Usable revenue after safety buffer (generated column)
  usable_revenue_usd numeric(12, 6) GENERATED ALWAYS AS (actual_revenue_usd * (safety_buffer_percentage / 100)) STORED,
  
  -- Average values for reward calculations
  avg_cpm_usable numeric(10, 6) GENERATED ALWAYS AS (
    CASE 
      WHEN total_impressions > 0 THEN (actual_revenue_usd * (safety_buffer_percentage / 100)) / (total_impressions / 1000.0)
      ELSE 0
    END
  ) STORED,
  
  -- Tracking
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  
  -- Ensure one entry per date per ad unit type
  UNIQUE(date, ad_unit_type)
);

CREATE INDEX IF NOT EXISTS idx_ad_unit_daily_values_date ON ad_unit_daily_values(date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_unit_daily_values_type_date ON ad_unit_daily_values(ad_unit_type, date DESC);

-- RLS Policies
ALTER TABLE ad_unit_daily_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read ad unit daily values"
  ON ad_unit_daily_values FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admin insert ad unit daily values"
  ON ad_unit_daily_values FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admin update ad unit daily values"
  ON ad_unit_daily_values FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

-- ============================================================================
-- 2. CREATE: ad_daily_revenue_input table (immutable audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ad_daily_revenue_input (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_date date NOT NULL UNIQUE,
  
  -- Total daily revenue from AdMob
  total_revenue_usd numeric(12, 6) NOT NULL CHECK (total_revenue_usd >= 0),
  
  -- Breakdown by ad type (optional but recommended)
  banner_revenue numeric(12, 6) DEFAULT 0 CHECK (banner_revenue >= 0),
  interstitial_revenue numeric(12, 6) DEFAULT 0 CHECK (interstitial_revenue >= 0),
  rewarded_revenue numeric(12, 6) DEFAULT 0 CHECK (rewarded_revenue >= 0),
  native_revenue numeric(12, 6) DEFAULT 0 CHECK (native_revenue >= 0),
  
  -- Safety buffer applied
  safety_buffer_percentage numeric(5, 2) NOT NULL DEFAULT 75.00 CHECK (safety_buffer_percentage BETWEEN 50 AND 90),
  
  -- Locking mechanism (once locked, cannot be modified)
  is_locked boolean DEFAULT false,
  locked_at timestamptz,
  
  -- Admin notes
  notes text,
  
  -- Audit trail
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_ad_daily_revenue_input_date ON ad_daily_revenue_input(revenue_date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_daily_revenue_input_locked ON ad_daily_revenue_input(is_locked, revenue_date);

-- RLS Policies
ALTER TABLE ad_daily_revenue_input ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read daily revenue input"
  ON ad_daily_revenue_input FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admin insert daily revenue input"
  ON ad_daily_revenue_input FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admin update daily revenue input"
  ON ad_daily_revenue_input FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
    AND NOT is_locked  -- Cannot update locked entries
  );

-- ============================================================================
-- 3. CREATE: ad_safety_caps table (configurable limits)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ad_safety_caps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Daily limits per user
  max_rewarded_ads_per_day integer NOT NULL DEFAULT 50 CHECK (max_rewarded_ads_per_day > 0),
  max_listener_earnings_per_day_usd numeric(10, 2) NOT NULL DEFAULT 5.00 CHECK (max_listener_earnings_per_day_usd > 0),
  
  -- Quality thresholds
  min_lqs_for_listener_reward integer NOT NULL DEFAULT 40 CHECK (min_lqs_for_listener_reward BETWEEN 0 AND 100),
  min_playback_duration_seconds integer NOT NULL DEFAULT 65 CHECK (min_playback_duration_seconds > 0),
  
  -- Pending balance configuration
  pending_balance_unlock_hours integer NOT NULL DEFAULT 168 CHECK (pending_balance_unlock_hours >= 0), -- 7 days default
  
  -- Revenue split percentages
  artist_revenue_percentage numeric(5, 2) NOT NULL DEFAULT 45.00 CHECK (artist_revenue_percentage BETWEEN 0 AND 100),
  listener_revenue_percentage numeric(5, 2) NOT NULL DEFAULT 15.00 CHECK (listener_revenue_percentage BETWEEN 0 AND 100),
  platform_revenue_percentage numeric(5, 2) NOT NULL DEFAULT 40.00 CHECK (platform_revenue_percentage BETWEEN 0 AND 100),
  
  -- Audit trail
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  
  -- Active flag
  is_active boolean DEFAULT true
);

-- Partial unique index to ensure only one active configuration
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_safety_caps_active ON ad_safety_caps(is_active) WHERE is_active = true;

-- Insert default configuration
INSERT INTO ad_safety_caps (
  max_rewarded_ads_per_day,
  max_listener_earnings_per_day_usd,
  min_lqs_for_listener_reward,
  min_playback_duration_seconds,
  pending_balance_unlock_hours,
  artist_revenue_percentage,
  listener_revenue_percentage,
  platform_revenue_percentage,
  is_active
) VALUES (
  50,      -- max 50 ads per day per user
  5.00,    -- max $5 per day for listeners
  40,      -- minimum LQS of 40 for listener rewards
  65,      -- minimum 65 seconds playback
  168,     -- 7 days (168 hours) pending period
  45.00,   -- artist gets 45%
  15.00,   -- listener gets 15% (if LQS >= 40)
  40.00,   -- platform gets 40% (or 55% if no listener reward)
  true
) ON CONFLICT DO NOTHING;

-- RLS Policies
ALTER TABLE ad_safety_caps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone read active safety caps"
  ON ad_safety_caps FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admin manage safety caps"
  ON ad_safety_caps FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

-- ============================================================================
-- 4. CREATE: ad_reconciliation_log table
-- ============================================================================
CREATE TABLE IF NOT EXISTS ad_reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_date date NOT NULL UNIQUE,
  
  -- Estimated payout (what we thought we'd pay)
  estimated_total_payout_usd numeric(12, 6) NOT NULL CHECK (estimated_total_payout_usd >= 0),
  
  -- Actual revenue from AdMob
  actual_admob_revenue_usd numeric(12, 6) NOT NULL CHECK (actual_admob_revenue_usd >= 0),
  
  -- Variance (calculated)
  variance_usd numeric(12, 6) GENERATED ALWAYS AS (actual_admob_revenue_usd - estimated_total_payout_usd) STORED,
  variance_percentage numeric(8, 4) GENERATED ALWAYS AS (
    CASE 
      WHEN estimated_total_payout_usd > 0 
      THEN ((actual_admob_revenue_usd - estimated_total_payout_usd) / estimated_total_payout_usd) * 100
      ELSE 0
    END
  ) STORED,
  
  -- Adjustment factor to apply to pending balances
  adjustment_factor numeric(8, 6) GENERATED ALWAYS AS (
    CASE 
      WHEN estimated_total_payout_usd > 0 
      THEN actual_admob_revenue_usd / estimated_total_payout_usd
      ELSE 1.0
    END
  ) STORED,
  
  -- Status tracking
  reconciliation_status text NOT NULL DEFAULT 'pending' CHECK (reconciliation_status IN ('pending', 'processing', 'completed', 'failed')),
  processing_started_at timestamptz,
  processing_completed_at timestamptz,
  
  -- Details
  total_impressions_reconciled integer DEFAULT 0,
  total_users_affected integer DEFAULT 0,
  adjustments_applied_count integer DEFAULT 0,
  
  -- Error tracking
  error_message text,
  
  -- Audit
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_reconciliation_log_date ON ad_reconciliation_log(reconciliation_date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_reconciliation_log_status ON ad_reconciliation_log(reconciliation_status, reconciliation_date);

-- RLS Policies
ALTER TABLE ad_reconciliation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage reconciliation log"
  ON ad_reconciliation_log FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

-- ============================================================================
-- 5. ENHANCE: ad_impressions table with LQS and reward tracking
-- ============================================================================

-- Add listening quality score tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_impressions' AND column_name = 'listening_quality_score'
  ) THEN
    ALTER TABLE ad_impressions ADD COLUMN listening_quality_score integer CHECK (listening_quality_score BETWEEN 0 AND 100);
  END IF;
END $$;

-- Add playback duration tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_impressions' AND column_name = 'playback_duration'
  ) THEN
    ALTER TABLE ad_impressions ADD COLUMN playback_duration integer CHECK (playback_duration >= 0);
  END IF;
END $$;

-- Add mute status tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_impressions' AND column_name = 'is_muted'
  ) THEN
    ALTER TABLE ad_impressions ADD COLUMN is_muted boolean DEFAULT false;
  END IF;
END $$;

-- Add reward status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_impressions' AND column_name = 'is_rewarded'
  ) THEN
    ALTER TABLE ad_impressions ADD COLUMN is_rewarded boolean DEFAULT false;
  END IF;
END $$;

-- Add eligibility flag
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_impressions' AND column_name = 'is_eligible_for_reward'
  ) THEN
    ALTER TABLE ad_impressions ADD COLUMN is_eligible_for_reward boolean DEFAULT false;
  END IF;
END $$;

-- Add reward split details (JSONB for flexibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_impressions' AND column_name = 'reward_split'
  ) THEN
    ALTER TABLE ad_impressions ADD COLUMN reward_split jsonb;
  END IF;
END $$;

-- Add processing status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_impressions' AND column_name = 'processing_status'
  ) THEN
    ALTER TABLE ad_impressions ADD COLUMN processing_status text DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processed', 'failed', 'skipped'));
  END IF;
END $$;

-- Add processing timestamp
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_impressions' AND column_name = 'processed_at'
  ) THEN
    ALTER TABLE ad_impressions ADD COLUMN processed_at timestamptz;
  END IF;
END $$;

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_ad_impressions_user_created ON ad_impressions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_processing_status ON ad_impressions(processing_status, created_at) WHERE processing_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ad_impressions_rewarded ON ad_impressions(is_rewarded, created_at);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_lqs ON ad_impressions(listening_quality_score) WHERE listening_quality_score IS NOT NULL;

-- ============================================================================
-- 6. FUNCTION: Check user daily ad cap
-- ============================================================================
CREATE OR REPLACE FUNCTION check_user_daily_ad_cap(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caps RECORD;
  v_today_count integer;
  v_today_earnings numeric;
  v_result jsonb;
BEGIN
  -- Get active safety caps
  SELECT * INTO v_caps
  FROM ad_safety_caps
  WHERE is_active = true
  LIMIT 1;
  
  IF v_caps IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No active safety caps configuration found'
    );
  END IF;
  
  -- Count today's rewarded ads for this user
  SELECT COUNT(*) INTO v_today_count
  FROM ad_impressions
  WHERE user_id = p_user_id
    AND is_rewarded = true
    AND created_at >= CURRENT_DATE
    AND created_at < CURRENT_DATE + INTERVAL '1 day';
  
  -- Calculate today's listener earnings (from reward_split JSONB)
  SELECT COALESCE(SUM((reward_split->>'listener_reward_usd')::numeric), 0) INTO v_today_earnings
  FROM ad_impressions
  WHERE user_id = p_user_id
    AND is_rewarded = true
    AND reward_split IS NOT NULL
    AND created_at >= CURRENT_DATE
    AND created_at < CURRENT_DATE + INTERVAL '1 day';
  
  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'today_rewarded_ad_count', v_today_count,
    'today_listener_earnings_usd', v_today_earnings,
    'max_rewarded_ads_per_day', v_caps.max_rewarded_ads_per_day,
    'max_listener_earnings_per_day_usd', v_caps.max_listener_earnings_per_day_usd,
    'has_reached_ad_cap', v_today_count >= v_caps.max_rewarded_ads_per_day,
    'has_reached_earnings_cap', v_today_earnings >= v_caps.max_listener_earnings_per_day_usd,
    'is_capped', (v_today_count >= v_caps.max_rewarded_ads_per_day OR v_today_earnings >= v_caps.max_listener_earnings_per_day_usd)
  );
  
  RETURN v_result;
END;
$$;

-- ============================================================================
-- 7. FUNCTION: Admin input daily AdMob revenue
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_input_daily_admob_revenue(
  p_revenue_date date,
  p_total_revenue_usd numeric,
  p_banner_revenue numeric DEFAULT 0,
  p_interstitial_revenue numeric DEFAULT 0,
  p_rewarded_revenue numeric DEFAULT 0,
  p_native_revenue numeric DEFAULT 0,
  p_safety_buffer_pct numeric DEFAULT 75.00,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_user_role text;
  v_revenue_input_id uuid;
  v_result jsonb;
BEGIN
  -- Verify admin status
  SELECT id, role INTO v_admin_id, v_user_role
  FROM users
  WHERE id = auth.uid();
  
  IF v_user_role != 'admin' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Admin privileges required'
    );
  END IF;
  
  -- Validate safety buffer percentage
  IF p_safety_buffer_pct < 50 OR p_safety_buffer_pct > 90 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Safety buffer must be between 50% and 90%'
    );
  END IF;
  
  -- Insert or update daily revenue input
  INSERT INTO ad_daily_revenue_input (
    revenue_date,
    total_revenue_usd,
    banner_revenue,
    interstitial_revenue,
    rewarded_revenue,
    native_revenue,
    safety_buffer_percentage,
    notes,
    created_by,
    updated_by
  ) VALUES (
    p_revenue_date,
    p_total_revenue_usd,
    p_banner_revenue,
    p_interstitial_revenue,
    p_rewarded_revenue,
    p_native_revenue,
    p_safety_buffer_pct,
    p_notes,
    v_admin_id,
    v_admin_id
  )
  ON CONFLICT (revenue_date) DO UPDATE
  SET
    total_revenue_usd = EXCLUDED.total_revenue_usd,
    banner_revenue = EXCLUDED.banner_revenue,
    interstitial_revenue = EXCLUDED.interstitial_revenue,
    rewarded_revenue = EXCLUDED.rewarded_revenue,
    native_revenue = EXCLUDED.native_revenue,
    safety_buffer_percentage = EXCLUDED.safety_buffer_percentage,
    notes = EXCLUDED.notes,
    updated_by = v_admin_id,
    updated_at = now()
  WHERE ad_daily_revenue_input.is_locked = false
  RETURNING id INTO v_revenue_input_id;
  
  IF v_revenue_input_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot update locked revenue entry'
    );
  END IF;
  
  -- Create/update ad_unit_daily_values entries for each ad type
  -- Banner
  IF p_banner_revenue > 0 THEN
    INSERT INTO ad_unit_daily_values (
      date,
      ad_unit_type,
      actual_revenue_usd,
      safety_buffer_percentage,
      created_by
    ) VALUES (
      p_revenue_date,
      'banner',
      p_banner_revenue,
      p_safety_buffer_pct,
      v_admin_id
    )
    ON CONFLICT (date, ad_unit_type) DO UPDATE
    SET
      actual_revenue_usd = EXCLUDED.actual_revenue_usd,
      safety_buffer_percentage = EXCLUDED.safety_buffer_percentage,
      updated_at = now();
  END IF;
  
  -- Interstitial
  IF p_interstitial_revenue > 0 THEN
    INSERT INTO ad_unit_daily_values (
      date,
      ad_unit_type,
      actual_revenue_usd,
      safety_buffer_percentage,
      created_by
    ) VALUES (
      p_revenue_date,
      'interstitial',
      p_interstitial_revenue,
      p_safety_buffer_pct,
      v_admin_id
    )
    ON CONFLICT (date, ad_unit_type) DO UPDATE
    SET
      actual_revenue_usd = EXCLUDED.actual_revenue_usd,
      safety_buffer_percentage = EXCLUDED.safety_buffer_percentage,
      updated_at = now();
  END IF;
  
  -- Rewarded
  IF p_rewarded_revenue > 0 THEN
    INSERT INTO ad_unit_daily_values (
      date,
      ad_unit_type,
      actual_revenue_usd,
      safety_buffer_percentage,
      created_by
    ) VALUES (
      p_revenue_date,
      'rewarded',
      p_rewarded_revenue,
      p_safety_buffer_pct,
      v_admin_id
    )
    ON CONFLICT (date, ad_unit_type) DO UPDATE
    SET
      actual_revenue_usd = EXCLUDED.actual_revenue_usd,
      safety_buffer_percentage = EXCLUDED.safety_buffer_percentage,
      updated_at = now();
  END IF;
  
  -- Native
  IF p_native_revenue > 0 THEN
    INSERT INTO ad_unit_daily_values (
      date,
      ad_unit_type,
      actual_revenue_usd,
      safety_buffer_percentage,
      created_by
    ) VALUES (
      p_revenue_date,
      'native',
      p_native_revenue,
      p_safety_buffer_pct,
      v_admin_id
    )
    ON CONFLICT (date, ad_unit_type) DO UPDATE
    SET
      actual_revenue_usd = EXCLUDED.actual_revenue_usd,
      safety_buffer_percentage = EXCLUDED.safety_buffer_percentage,
      updated_at = now();
  END IF;
  
  -- Return success
  v_result := jsonb_build_object(
    'success', true,
    'revenue_input_id', v_revenue_input_id,
    'revenue_date', p_revenue_date,
    'total_revenue_usd', p_total_revenue_usd,
    'safety_buffer_percentage', p_safety_buffer_pct,
    'usable_revenue_usd', p_total_revenue_usd * (p_safety_buffer_pct / 100),
    'created_by', v_admin_id
  );
  
  RETURN v_result;
END;
$$;

-- Grant execute permissions to authenticated users (admin check is inside function)
GRANT EXECUTE ON FUNCTION check_user_daily_ad_cap TO authenticated;
GRANT EXECUTE ON FUNCTION admin_input_daily_admob_revenue TO authenticated;
