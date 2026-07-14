/*
  # Payment Monitoring and Wallet Consistency System

  This migration creates a comprehensive monitoring system to prevent and detect
  treat payment crediting failures automatically.

  ## Features Created:
  
  1. **Payment Monitoring View** - Identifies completed payments without transactions
  2. **Wallet Consistency Check Function** - Validates wallet balance integrity
  3. **Admin Alert Table** - Logs payment issues requiring review
  4. **Automated Monitoring Function** - Checks for uncredited payments periodically

  ## Security:
  - Admin-only access to monitoring views and alert table
  - Service role can insert alert records
  - RLS enabled on all new tables
*/

-- =====================================================
-- 1. Create admin alerts table for payment issues
-- =====================================================

CREATE TABLE IF NOT EXISTS public.payment_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL CHECK (alert_type IN ('uncredited_payment', 'wallet_inconsistency', 'failed_activation')),
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')) DEFAULT 'high',
  payment_id uuid REFERENCES treat_payments(id),
  user_id uuid REFERENCES users(id),
  title text NOT NULL,
  description text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('pending', 'investigating', 'resolved', 'ignored')) DEFAULT 'pending',
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id),
  resolution_notes text,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_payment_alerts_status ON payment_alerts(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payment_alerts_severity ON payment_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_payment_alerts_payment_id ON payment_alerts(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_alerts_user_id ON payment_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_alerts_created_at ON payment_alerts(created_at DESC);

-- Enable RLS
ALTER TABLE payment_alerts ENABLE ROW LEVEL SECURITY;

-- Admin can view all alerts
CREATE POLICY "Admins can view all payment alerts"
  ON payment_alerts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admin can update alerts
CREATE POLICY "Admins can update payment alerts"
  ON payment_alerts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Service role can insert alerts (for automated monitoring)
CREATE POLICY "Service role can insert alerts"
  ON payment_alerts
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- =====================================================
-- 2. Create view to identify uncredited payments
-- =====================================================

CREATE OR REPLACE VIEW uncredited_payments AS
SELECT 
  tp.id as payment_id,
  tp.user_id,
  u.display_name,
  u.email,
  tp.amount,
  tp.currency,
  tp.payment_method,
  tp.status as payment_status,
  tp.completed_at,
  tp.created_at as payment_created,
  pkg.name as package_name,
  pkg.treats as treats_amount,
  pkg.bonus as bonus_amount,
  (pkg.treats + pkg.bonus) as total_treats,
  EXTRACT(EPOCH FROM (NOW() - tp.completed_at))/3600 as hours_since_completion
FROM treat_payments tp
JOIN users u ON u.id = tp.user_id
JOIN treat_packages pkg ON pkg.id = tp.package_id
LEFT JOIN treat_transactions tt ON tt.payment_reference = tp.id::text AND tt.status = 'completed'
WHERE 
  tp.status = 'completed'
  AND tt.id IS NULL
  AND tp.completed_at IS NOT NULL
ORDER BY tp.completed_at DESC;

-- =====================================================
-- 3. Function to check wallet consistency
-- =====================================================

CREATE OR REPLACE FUNCTION check_wallet_consistency(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_balance numeric;
  v_calculated_balance numeric;
  v_wallet_purchased numeric;
  v_calculated_purchased numeric;
  v_wallet_earned numeric;
  v_calculated_earned numeric;
  v_wallet_spent numeric;
  v_calculated_spent numeric;
  v_is_consistent boolean := true;
  v_issues jsonb := '[]'::jsonb;
BEGIN
  -- Get wallet values
  SELECT 
    balance,
    purchased_balance,
    earned_balance,
    total_spent
  INTO 
    v_wallet_balance,
    v_wallet_purchased,
    v_wallet_earned,
    v_wallet_spent
  FROM treat_wallets
  WHERE user_id = p_user_id;

  -- Calculate from transactions
  SELECT 
    COALESCE(SUM(CASE 
      WHEN transaction_type IN ('purchase', 'tip_received', 'daily_checkin', 'referral_bonus', 'play_reward') 
      THEN amount 
      ELSE 0 
    END), 0) - COALESCE(SUM(CASE 
      WHEN transaction_type IN ('tip_sent', 'promotion', 'withdrawal') 
      THEN amount 
      ELSE 0 
    END), 0) as calculated_balance,
    COALESCE(SUM(CASE WHEN transaction_type = 'purchase' THEN amount ELSE 0 END), 0) as calculated_purchased,
    COALESCE(SUM(CASE 
      WHEN transaction_type IN ('tip_received', 'daily_checkin', 'referral_bonus', 'play_reward') 
      THEN amount 
      ELSE 0 
    END), 0) as calculated_earned,
    COALESCE(SUM(CASE 
      WHEN transaction_type IN ('tip_sent', 'promotion', 'withdrawal') 
      THEN amount 
      ELSE 0 
    END), 0) as calculated_spent
  INTO 
    v_calculated_balance,
    v_calculated_purchased,
    v_calculated_earned,
    v_calculated_spent
  FROM treat_transactions
  WHERE user_id = p_user_id
  AND status = 'completed';

  -- Check for inconsistencies
  IF v_wallet_balance != v_calculated_balance THEN
    v_is_consistent := false;
    v_issues := v_issues || jsonb_build_object(
      'field', 'balance',
      'wallet_value', v_wallet_balance,
      'calculated_value', v_calculated_balance,
      'difference', v_wallet_balance - v_calculated_balance
    );
  END IF;

  IF v_wallet_purchased != v_calculated_purchased THEN
    v_is_consistent := false;
    v_issues := v_issues || jsonb_build_object(
      'field', 'purchased_balance',
      'wallet_value', v_wallet_purchased,
      'calculated_value', v_calculated_purchased,
      'difference', v_wallet_purchased - v_calculated_purchased
    );
  END IF;

  IF v_wallet_spent != v_calculated_spent THEN
    v_is_consistent := false;
    v_issues := v_issues || jsonb_build_object(
      'field', 'total_spent',
      'wallet_value', v_wallet_spent,
      'calculated_value', v_calculated_spent,
      'difference', v_wallet_spent - v_calculated_spent
    );
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'is_consistent', v_is_consistent,
    'wallet', jsonb_build_object(
      'balance', v_wallet_balance,
      'purchased_balance', v_wallet_purchased,
      'earned_balance', v_wallet_earned,
      'total_spent', v_wallet_spent
    ),
    'calculated', jsonb_build_object(
      'balance', v_calculated_balance,
      'purchased_balance', v_calculated_purchased,
      'earned_balance', v_calculated_earned,
      'total_spent', v_calculated_spent
    ),
    'issues', v_issues,
    'checked_at', NOW()
  );
END;
$$;

-- =====================================================
-- 4. Function to monitor and alert on uncredited payments
-- =====================================================

CREATE OR REPLACE FUNCTION monitor_uncredited_payments()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uncredited_count integer;
  v_alert_count integer := 0;
  v_payment_record record;
BEGIN
  -- Find all uncredited payments
  FOR v_payment_record IN 
    SELECT * FROM uncredited_payments
    WHERE hours_since_completion > 0.5  -- Alert after 30 minutes
  LOOP
    -- Check if alert already exists
    IF NOT EXISTS (
      SELECT 1 FROM payment_alerts
      WHERE payment_id = v_payment_record.payment_id
      AND status != 'resolved'
    ) THEN
      -- Create new alert
      INSERT INTO payment_alerts (
        alert_type,
        severity,
        payment_id,
        user_id,
        title,
        description,
        metadata
      ) VALUES (
        'uncredited_payment',
        CASE 
          WHEN v_payment_record.hours_since_completion > 24 THEN 'critical'
          WHEN v_payment_record.hours_since_completion > 12 THEN 'high'
          WHEN v_payment_record.hours_since_completion > 2 THEN 'medium'
          ELSE 'low'
        END,
        v_payment_record.payment_id,
        v_payment_record.user_id,
        format('Uncredited Payment: %s treats for %s', v_payment_record.total_treats, v_payment_record.display_name),
        format('Payment completed %s hours ago but treats not credited. User: %s, Amount: %s %s, Package: %s (%s treats)',
          ROUND(v_payment_record.hours_since_completion::numeric, 2),
          v_payment_record.display_name,
          v_payment_record.amount,
          v_payment_record.currency,
          v_payment_record.package_name,
          v_payment_record.total_treats
        ),
        jsonb_build_object(
          'payment_id', v_payment_record.payment_id,
          'user_id', v_payment_record.user_id,
          'user_email', v_payment_record.email,
          'amount_paid', v_payment_record.amount,
          'currency', v_payment_record.currency,
          'treats_owed', v_payment_record.total_treats,
          'package_name', v_payment_record.package_name,
          'completed_at', v_payment_record.completed_at,
          'hours_overdue', ROUND(v_payment_record.hours_since_completion::numeric, 2)
        )
      );
      
      v_alert_count := v_alert_count + 1;
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_uncredited_count FROM uncredited_payments;

  RETURN jsonb_build_object(
    'success', true,
    'uncredited_payments_found', v_uncredited_count,
    'new_alerts_created', v_alert_count,
    'checked_at', NOW()
  );
END;
$$;

-- =====================================================
-- 5. Grant necessary permissions
-- =====================================================

-- Allow admins to call monitoring functions
GRANT EXECUTE ON FUNCTION check_wallet_consistency(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION monitor_uncredited_payments() TO service_role;

-- Allow admins to view uncredited payments
GRANT SELECT ON uncredited_payments TO authenticated;

-- Create comment for documentation
COMMENT ON TABLE payment_alerts IS 'Tracks payment issues requiring admin attention';
COMMENT ON VIEW uncredited_payments IS 'Lists completed payments that have not been credited to user wallets';
COMMENT ON FUNCTION check_wallet_consistency IS 'Validates wallet balance against transaction history';
COMMENT ON FUNCTION monitor_uncredited_payments IS 'Automatically creates alerts for uncredited payments';
