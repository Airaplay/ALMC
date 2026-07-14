/*
  # Financial Reserve and Monitoring System
  
  1. Platform Financial Reserves
    - Tracks platform's cash position
    - Records all revenue and payouts
    - Calculates reserve ratio
    
  2. Reserve Requirement Checks
    - Enforces minimum reserve before allowing withdrawals
    - Prevents bank run scenarios
    - Provides safety buffer
    
  3. Financial Monitoring Dashboard
    - Real-time financial metrics
    - Daily snapshots of platform health
    - Alert thresholds
    
  4. Updated Withdrawal Functions
    - Checks reserve requirements before approval
    - Prevents payouts that would drain reserves
    
  5. Security
    - Admin-only access to financial data
    - Audit trail for all financial operations
*/

-- ============================================================================
-- 1. PLATFORM FINANCIAL RESERVES
-- ============================================================================

-- Track platform's cash position
CREATE TABLE IF NOT EXISTS platform_financial_reserves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  opening_balance numeric(10,2) DEFAULT 0 NOT NULL,
  total_revenue numeric(10,2) DEFAULT 0 NOT NULL,
  total_payouts numeric(10,2) DEFAULT 0 NOT NULL,
  closing_balance numeric(10,2) DEFAULT 0 NOT NULL,
  pending_withdrawals numeric(10,2) DEFAULT 0 NOT NULL,
  available_reserve numeric(10,2) DEFAULT 0 NOT NULL,
  reserve_ratio numeric(5,2) DEFAULT 0 NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(transaction_date)
);

CREATE INDEX IF NOT EXISTS idx_reserves_date ON platform_financial_reserves(transaction_date DESC);

-- Initialize today's reserves if not exists
INSERT INTO platform_financial_reserves (
  transaction_date,
  opening_balance,
  total_revenue,
  total_payouts,
  closing_balance,
  pending_withdrawals,
  available_reserve,
  reserve_ratio
)
SELECT
  CURRENT_DATE,
  0,
  COALESCE(SUM(amount_usd), 0),
  COALESCE((SELECT SUM(amount_usd) FROM withdrawal_requests WHERE status = 'completed'), 0),
  COALESCE(SUM(amount_usd), 0) - COALESCE((SELECT SUM(amount_usd) FROM withdrawal_requests WHERE status = 'completed'), 0),
  COALESCE((SELECT SUM(amount_usd) FROM withdrawal_requests WHERE status IN ('pending', 'processing')), 0),
  COALESCE(SUM(amount_usd), 0) - COALESCE((SELECT SUM(amount_usd) FROM withdrawal_requests WHERE status IN ('pending', 'processing', 'completed')), 0),
  CASE 
    WHEN COALESCE((SELECT SUM(amount_usd) FROM withdrawal_requests WHERE status IN ('pending', 'processing')), 0) > 0
    THEN (COALESCE(SUM(amount_usd), 0) - COALESCE((SELECT SUM(amount_usd) FROM withdrawal_requests WHERE status IN ('pending', 'processing', 'completed')), 0)) / 
         COALESCE((SELECT SUM(amount_usd) FROM withdrawal_requests WHERE status IN ('pending', 'processing')), 0) * 100
    ELSE 100
  END
FROM treat_payments
WHERE status = 'completed'
ON CONFLICT (transaction_date) DO NOTHING;

-- RLS
ALTER TABLE platform_financial_reserves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view reserves"
  ON platform_financial_reserves FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- ============================================================================
-- 2. FINANCIAL ALERTS AND THRESHOLDS
-- ============================================================================

CREATE TABLE IF NOT EXISTS financial_alert_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  threshold_name text UNIQUE NOT NULL,
  threshold_value numeric(10,2) NOT NULL,
  alert_level text NOT NULL CHECK (alert_level IN ('info', 'warning', 'critical')),
  is_active boolean DEFAULT true NOT NULL,
  description text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Insert default thresholds
INSERT INTO financial_alert_thresholds (threshold_name, threshold_value, alert_level, description)
VALUES 
  ('minimum_reserve_amount', 100.00, 'critical', 'Minimum cash reserve before freezing withdrawals'),
  ('minimum_reserve_ratio', 20.00, 'warning', 'Minimum reserve ratio (%) relative to pending withdrawals'),
  ('daily_payout_limit', 500.00, 'warning', 'Maximum total payouts allowed per day'),
  ('low_balance_alert', 200.00, 'warning', 'Alert when available reserve drops below this amount')
ON CONFLICT (threshold_name) DO NOTHING;

-- RLS
ALTER TABLE financial_alert_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage alert thresholds"
  ON financial_alert_thresholds FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- ============================================================================
-- 3. DAILY FINANCIAL SNAPSHOTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_financial_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  total_users integer DEFAULT 0,
  active_creators integer DEFAULT 0,
  total_revenue_collected numeric(10,2) DEFAULT 0,
  total_withdrawals_completed numeric(10,2) DEFAULT 0,
  total_withdrawals_pending numeric(10,2) DEFAULT 0,
  total_treats_in_wallets numeric(10,2) DEFAULT 0,
  total_earned_balance numeric(10,2) DEFAULT 0,
  total_purchased_balance numeric(10,2) DEFAULT 0,
  net_financial_position numeric(10,2) DEFAULT 0,
  reserve_ratio numeric(5,2) DEFAULT 0,
  alert_level text CHECK (alert_level IN ('healthy', 'warning', 'critical')),
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_date ON daily_financial_snapshots(snapshot_date DESC);

-- RLS
ALTER TABLE daily_financial_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view snapshots"
  ON daily_financial_snapshots FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- ============================================================================
-- 4. RESERVE REQUIREMENT CHECK FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION check_reserve_requirements(
  p_withdrawal_amount_usd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_revenue numeric;
  v_total_paid numeric;
  v_pending_withdrawals numeric;
  v_available_reserve numeric;
  v_minimum_reserve numeric;
  v_reserve_ratio numeric;
  v_minimum_ratio numeric;
  v_can_process boolean;
  v_reason text;
BEGIN
  -- Get minimum reserve thresholds
  SELECT threshold_value INTO v_minimum_reserve
  FROM financial_alert_thresholds
  WHERE threshold_name = 'minimum_reserve_amount' AND is_active = true;
  
  SELECT threshold_value INTO v_minimum_ratio
  FROM financial_alert_thresholds
  WHERE threshold_name = 'minimum_reserve_ratio' AND is_active = true;
  
  -- Calculate current financial position
  SELECT COALESCE(SUM(amount_usd), 0) INTO v_total_revenue
  FROM treat_payments
  WHERE status = 'completed';
  
  SELECT COALESCE(SUM(amount_usd), 0) INTO v_total_paid
  FROM withdrawal_requests
  WHERE status = 'completed';
  
  SELECT COALESCE(SUM(amount_usd), 0) INTO v_pending_withdrawals
  FROM withdrawal_requests
  WHERE status IN ('pending', 'processing');
  
  -- Calculate available reserve after this withdrawal
  v_available_reserve := v_total_revenue - v_total_paid - v_pending_withdrawals - p_withdrawal_amount_usd;
  
  -- Calculate reserve ratio
  IF (v_pending_withdrawals + p_withdrawal_amount_usd) > 0 THEN
    v_reserve_ratio := (v_available_reserve / (v_pending_withdrawals + p_withdrawal_amount_usd)) * 100;
  ELSE
    v_reserve_ratio := 100;
  END IF;
  
  -- Determine if withdrawal can be processed
  v_can_process := true;
  v_reason := 'Sufficient reserves available';
  
  IF v_available_reserve < v_minimum_reserve THEN
    v_can_process := false;
    v_reason := format('Insufficient reserves. Available: $%s, Minimum required: $%s', 
                       v_available_reserve, v_minimum_reserve);
  ELSIF v_reserve_ratio < v_minimum_ratio THEN
    v_can_process := false;
    v_reason := format('Reserve ratio too low. Current: %s%%, Minimum required: %s%%', 
                       ROUND(v_reserve_ratio, 2), v_minimum_ratio);
  END IF;
  
  -- Return result
  RETURN jsonb_build_object(
    'can_process', v_can_process,
    'reason', v_reason,
    'financial_details', jsonb_build_object(
      'total_revenue', v_total_revenue,
      'total_paid', v_total_paid,
      'pending_withdrawals', v_pending_withdrawals,
      'withdrawal_amount', p_withdrawal_amount_usd,
      'available_reserve_after', v_available_reserve,
      'reserve_ratio', ROUND(v_reserve_ratio, 2),
      'minimum_reserve_required', v_minimum_reserve,
      'minimum_ratio_required', v_minimum_ratio
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_reserve_requirements TO authenticated;

-- ============================================================================
-- 5. UPDATE WITHDRAWAL APPROVAL TO CHECK RESERVES
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_approve_withdrawal_with_reserve_check(
  p_withdrawal_id uuid,
  p_admin_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_withdrawal_amount_usd numeric;
  v_user_id uuid;
  v_reserve_check jsonb;
  v_withdrawal_frozen boolean;
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only admins can approve withdrawals'
    );
  END IF;
  
  -- Check if withdrawals are frozen
  SELECT is_active INTO v_withdrawal_frozen
  FROM platform_financial_controls
  WHERE control_name = 'withdrawal_freeze';
  
  IF v_withdrawal_frozen THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawals are currently frozen. Please contact platform administrator.'
    );
  END IF;
  
  -- Get withdrawal details
  SELECT amount_usd, user_id
  INTO v_withdrawal_amount_usd, v_user_id
  FROM withdrawal_requests
  WHERE id = p_withdrawal_id
  AND status = 'pending';
  
  IF v_withdrawal_amount_usd IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal not found or not in pending status'
    );
  END IF;
  
  -- Check reserve requirements
  v_reserve_check := check_reserve_requirements(v_withdrawal_amount_usd);
  
  IF NOT (v_reserve_check->>'can_process')::boolean THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot approve withdrawal due to insufficient reserves',
      'reserve_check', v_reserve_check
    );
  END IF;
  
  -- All checks passed - approve withdrawal
  UPDATE withdrawal_requests
  SET 
    status = 'completed',
    processed_at = NOW(),
    admin_notes = COALESCE(p_admin_notes, admin_notes)
  WHERE id = p_withdrawal_id;
  
  -- Log in admin audit trail (if exists)
  INSERT INTO admin_audit_logs (
    admin_id,
    action_type,
    target_type,
    target_id,
    details,
    ip_address
  ) VALUES (
    auth.uid(),
    'withdrawal_approved',
    'withdrawal_request',
    p_withdrawal_id,
    jsonb_build_object(
      'amount_usd', v_withdrawal_amount_usd,
      'user_id', v_user_id,
      'reserve_check', v_reserve_check
    ),
    NULL
  )
  ON CONFLICT DO NOTHING; -- Table may not exist yet
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Withdrawal approved successfully',
    'reserve_status', v_reserve_check
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_approve_withdrawal_with_reserve_check TO authenticated;

-- ============================================================================
-- 6. DAILY SNAPSHOT GENERATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_daily_financial_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_users integer;
  v_active_creators integer;
  v_total_revenue numeric;
  v_withdrawals_completed numeric;
  v_withdrawals_pending numeric;
  v_total_treats numeric;
  v_earned_balance numeric;
  v_purchased_balance numeric;
  v_net_position numeric;
  v_reserve_ratio numeric;
  v_alert_level text;
BEGIN
  -- Gather metrics
  SELECT COUNT(*) INTO v_total_users FROM users;
  
  SELECT COUNT(*) INTO v_active_creators 
  FROM users WHERE role = 'creator';
  
  SELECT COALESCE(SUM(amount_usd), 0) INTO v_total_revenue
  FROM treat_payments WHERE status = 'completed';
  
  SELECT COALESCE(SUM(amount_usd), 0) INTO v_withdrawals_completed
  FROM withdrawal_requests WHERE status = 'completed';
  
  SELECT COALESCE(SUM(amount_usd), 0) INTO v_withdrawals_pending
  FROM withdrawal_requests WHERE status IN ('pending', 'processing');
  
  SELECT 
    COALESCE(SUM(earned_balance + purchased_balance + pending_balance), 0),
    COALESCE(SUM(earned_balance), 0),
    COALESCE(SUM(purchased_balance), 0)
  INTO v_total_treats, v_earned_balance, v_purchased_balance
  FROM treat_wallets;
  
  -- Calculate net position
  v_net_position := v_total_revenue - v_withdrawals_completed - v_withdrawals_pending;
  
  -- Calculate reserve ratio
  IF v_withdrawals_pending > 0 THEN
    v_reserve_ratio := (v_net_position / v_withdrawals_pending) * 100;
  ELSE
    v_reserve_ratio := 100;
  END IF;
  
  -- Determine alert level
  IF v_net_position < 100 OR v_reserve_ratio < 10 THEN
    v_alert_level := 'critical';
  ELSIF v_net_position < 200 OR v_reserve_ratio < 20 THEN
    v_alert_level := 'warning';
  ELSE
    v_alert_level := 'healthy';
  END IF;
  
  -- Insert snapshot
  INSERT INTO daily_financial_snapshots (
    snapshot_date,
    total_users,
    active_creators,
    total_revenue_collected,
    total_withdrawals_completed,
    total_withdrawals_pending,
    total_treats_in_wallets,
    total_earned_balance,
    total_purchased_balance,
    net_financial_position,
    reserve_ratio,
    alert_level
  ) VALUES (
    CURRENT_DATE,
    v_total_users,
    v_active_creators,
    v_total_revenue,
    v_withdrawals_completed,
    v_withdrawals_pending,
    v_total_treats,
    v_earned_balance,
    v_purchased_balance,
    v_net_position,
    v_reserve_ratio,
    v_alert_level
  )
  ON CONFLICT (snapshot_date)
  DO UPDATE SET
    total_users = EXCLUDED.total_users,
    active_creators = EXCLUDED.active_creators,
    total_revenue_collected = EXCLUDED.total_revenue_collected,
    total_withdrawals_completed = EXCLUDED.total_withdrawals_completed,
    total_withdrawals_pending = EXCLUDED.total_withdrawals_pending,
    total_treats_in_wallets = EXCLUDED.total_treats_in_wallets,
    total_earned_balance = EXCLUDED.total_earned_balance,
    total_purchased_balance = EXCLUDED.total_purchased_balance,
    net_financial_position = EXCLUDED.net_financial_position,
    reserve_ratio = EXCLUDED.reserve_ratio,
    alert_level = EXCLUDED.alert_level,
    created_at = NOW();
END;
$$;

-- Generate initial snapshot
SELECT generate_daily_financial_snapshot();

-- ============================================================================
-- 7. ADMIN DASHBOARD HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_financial_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can view financial dashboard';
  END IF;
  
  -- Get latest snapshot and combine with real-time data
  SELECT jsonb_build_object(
    'latest_snapshot', (
      SELECT row_to_json(dfs)
      FROM daily_financial_snapshots dfs
      ORDER BY snapshot_date DESC
      LIMIT 1
    ),
    'financial_controls', (
      SELECT jsonb_object_agg(control_name, is_active)
      FROM platform_financial_controls
    ),
    'alert_thresholds', (
      SELECT jsonb_agg(fat)
      FROM financial_alert_thresholds fat
      WHERE is_active = true
    ),
    'pending_withdrawals', (
      SELECT jsonb_build_object(
        'count', COUNT(*),
        'total_amount_usd', COALESCE(SUM(amount_usd), 0)
      )
      FROM withdrawal_requests
      WHERE status IN ('pending', 'processing')
    )
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_financial_dashboard TO authenticated;
