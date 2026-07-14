/*
  # Bulk Withdrawal Actions and Fraud Detection System

  1. New Functions
    - admin_bulk_approve_withdrawals - Approve multiple withdrawals at once
    - admin_bulk_reject_withdrawals - Reject multiple withdrawals at once
    - admin_detect_withdrawal_anomalies - Find suspicious withdrawals with balance mismatches
    - admin_export_approved_withdrawals - Get approved withdrawals ready for bank processing

  2. Features
    - Bulk approval/rejection for efficiency
    - Balance validation to detect fraud
    - Export format for bank managers
    - Detailed logging of bulk actions

  3. Security
    - Admin-only access
    - Validates each withdrawal individually
    - Prevents processing already-processed requests
    - Logs all bulk actions for audit
*/

-- Function to bulk approve multiple withdrawals
CREATE OR REPLACE FUNCTION admin_bulk_approve_withdrawals(
  p_withdrawal_ids uuid[],
  p_admin_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_approved_count integer := 0;
  v_failed_count integer := 0;
  v_failed_ids uuid[] := ARRAY[]::uuid[];
  v_withdrawal_id uuid;
  v_result jsonb;
BEGIN
  -- Get admin user
  v_admin_id := auth.uid();
  
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not authenticated'
    );
  END IF;
  
  -- Verify admin role
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = v_admin_id 
    AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only admins can approve withdrawals'
    );
  END IF;

  -- Process each withdrawal
  FOREACH v_withdrawal_id IN ARRAY p_withdrawal_ids
  LOOP
    -- Call individual approve function
    SELECT admin_approve_withdrawal(v_withdrawal_id, p_admin_notes) INTO v_result;
    
    IF v_result->>'success' = 'true' THEN
      v_approved_count := v_approved_count + 1;
    ELSE
      v_failed_count := v_failed_count + 1;
      v_failed_ids := array_append(v_failed_ids, v_withdrawal_id);
    END IF;
  END LOOP;

  -- Log bulk action
  INSERT INTO admin_activity_logs (admin_id, action_type, details, created_at)
  VALUES (
    v_admin_id,
    'bulk_approve_withdrawals',
    jsonb_build_object(
      'total_requested', array_length(p_withdrawal_ids, 1),
      'approved_count', v_approved_count,
      'failed_count', v_failed_count,
      'failed_ids', v_failed_ids,
      'admin_notes', p_admin_notes
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'approved_count', v_approved_count,
    'failed_count', v_failed_count,
    'failed_ids', v_failed_ids,
    'message', format('Successfully approved %s of %s withdrawal requests', 
                      v_approved_count, 
                      array_length(p_withdrawal_ids, 1))
  );
END;
$$;

-- Function to bulk reject multiple withdrawals
CREATE OR REPLACE FUNCTION admin_bulk_reject_withdrawals(
  p_withdrawal_ids uuid[],
  p_admin_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_rejected_count integer := 0;
  v_failed_count integer := 0;
  v_failed_ids uuid[] := ARRAY[]::uuid[];
  v_withdrawal_id uuid;
  v_result jsonb;
BEGIN
  -- Get admin user
  v_admin_id := auth.uid();
  
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not authenticated'
    );
  END IF;
  
  -- Verify admin role
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = v_admin_id 
    AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only admins can reject withdrawals'
    );
  END IF;

  -- Process each withdrawal
  FOREACH v_withdrawal_id IN ARRAY p_withdrawal_ids
  LOOP
    -- Call individual reject function
    SELECT admin_reject_withdrawal(v_withdrawal_id, p_admin_notes) INTO v_result;
    
    IF v_result->>'success' = 'true' THEN
      v_rejected_count := v_rejected_count + 1;
    ELSE
      v_failed_count := v_failed_count + 1;
      v_failed_ids := array_append(v_failed_ids, v_withdrawal_id);
    END IF;
  END LOOP;

  -- Log bulk action
  INSERT INTO admin_activity_logs (admin_id, action_type, details, created_at)
  VALUES (
    v_admin_id,
    'bulk_reject_withdrawals',
    jsonb_build_object(
      'total_requested', array_length(p_withdrawal_ids, 1),
      'rejected_count', v_rejected_count,
      'failed_count', v_failed_count,
      'failed_ids', v_failed_ids,
      'admin_notes', p_admin_notes
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'rejected_count', v_rejected_count,
    'failed_count', v_failed_count,
    'failed_ids', v_failed_ids,
    'message', format('Successfully rejected %s of %s withdrawal requests', 
                      v_rejected_count, 
                      array_length(p_withdrawal_ids, 1))
  );
END;
$$;

-- Function to detect withdrawal anomalies (balance mismatches)
CREATE OR REPLACE FUNCTION admin_detect_withdrawal_anomalies(
  p_status text DEFAULT NULL
)
RETURNS TABLE (
  withdrawal_id uuid,
  user_id uuid,
  user_email text,
  user_display_name text,
  transaction_id text,
  amount numeric,
  balance_before numeric,
  balance_after numeric,
  expected_balance_after numeric,
  balance_difference numeric,
  status text,
  request_date timestamptz,
  anomaly_type text,
  anomaly_severity text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  WITH withdrawal_data AS (
    SELECT
      wr.id,
      wr.user_id,
      u.email,
      u.display_name,
      wr.transaction_id,
      wr.amount,
      wr.balance_before,
      wr.balance_after,
      (wr.balance_before - wr.amount) as calculated_balance_after,
      ABS((wr.balance_before - wr.amount) - COALESCE(wr.balance_after, 0)) as balance_diff,
      wr.status,
      wr.request_date
    FROM withdrawal_requests wr
    INNER JOIN users u ON u.id = wr.user_id
    WHERE (p_status IS NULL OR wr.status = p_status)
      AND wr.balance_before IS NOT NULL
      AND wr.balance_after IS NOT NULL
  )
  SELECT
    wd.id,
    wd.user_id,
    wd.email,
    wd.display_name,
    wd.transaction_id,
    wd.amount,
    wd.balance_before,
    wd.balance_after,
    wd.calculated_balance_after,
    wd.balance_diff,
    wd.status,
    wd.request_date,
    CASE
      WHEN wd.balance_diff > 0.01 THEN 'balance_mismatch'
      WHEN wd.balance_before < wd.amount THEN 'negative_balance'
      ELSE 'unknown'
    END as anomaly_type,
    CASE
      WHEN wd.balance_diff > 100 THEN 'critical'
      WHEN wd.balance_diff > 10 THEN 'high'
      WHEN wd.balance_diff > 1 THEN 'medium'
      ELSE 'low'
    END as anomaly_severity
  FROM withdrawal_data wd
  WHERE wd.balance_diff > 0.01  -- Flag if difference is more than 1 cent
     OR wd.balance_before < wd.amount  -- Flag if user didn't have enough balance
  ORDER BY wd.balance_diff DESC, wd.request_date DESC;
END;
$$;

-- Function to export approved withdrawals for bank processing
CREATE OR REPLACE FUNCTION admin_export_approved_withdrawals()
RETURNS TABLE (
  transaction_id text,
  request_date timestamptz,
  user_name text,
  user_email text,
  user_country text,
  method_type text,
  bank_name text,
  account_holder_name text,
  account_number text,
  swift_code text,
  country text,
  wallet_address text,
  gross_amount_usd numeric,
  fee_amount_usd numeric,
  net_amount_usd numeric,
  currency_code text,
  amount_local numeric,
  exchange_rate numeric,
  admin_notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    wr.transaction_id,
    wr.request_date,
    u.display_name as user_name,
    u.email as user_email,
    wr.user_country,
    wm.method_type,
    wm.bank_name,
    wr.account_holder_name,
    wm.account_number,
    wm.swift_code,
    wm.country,
    wm.wallet_address,
    COALESCE(wr.gross_amount, wr.amount) as gross_amount_usd,
    COALESCE(wr.fee_amount, 0) as fee_amount_usd,
    COALESCE(wr.net_amount, wr.amount) as net_amount_usd,
    wr.currency_code,
    wr.amount_local,
    wr.exchange_rate_applied as exchange_rate,
    wr.admin_notes
  FROM withdrawal_requests wr
  INNER JOIN users u ON u.id = wr.user_id
  LEFT JOIN withdrawal_methods wm ON wm.id = wr.withdrawal_method_id
  WHERE wr.status = 'approved'
  ORDER BY wr.request_date ASC;
END;
$$;

-- Create admin_activity_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES auth.users(id) NOT NULL,
  action_type text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_admin_id 
  ON admin_activity_logs(admin_id);

CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_action_type 
  ON admin_activity_logs(action_type);

CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_created_at 
  ON admin_activity_logs(created_at DESC);

-- Enable RLS
ALTER TABLE admin_activity_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can view activity logs"
  ON admin_activity_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "System can insert activity logs"
  ON admin_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    admin_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Grant permissions
GRANT EXECUTE ON FUNCTION admin_bulk_approve_withdrawals TO authenticated;
GRANT EXECUTE ON FUNCTION admin_bulk_reject_withdrawals TO authenticated;
GRANT EXECUTE ON FUNCTION admin_detect_withdrawal_anomalies TO authenticated;
GRANT EXECUTE ON FUNCTION admin_export_approved_withdrawals TO authenticated;

-- Add helpful comments
COMMENT ON FUNCTION admin_bulk_approve_withdrawals IS 'Approve multiple withdrawal requests at once. Returns count of successful and failed approvals.';
COMMENT ON FUNCTION admin_bulk_reject_withdrawals IS 'Reject multiple withdrawal requests at once. Returns count of successful and failed rejections.';
COMMENT ON FUNCTION admin_detect_withdrawal_anomalies IS 'Detect withdrawal requests with balance mismatches or other anomalies for fraud detection.';
COMMENT ON FUNCTION admin_export_approved_withdrawals IS 'Export all approved withdrawals in format suitable for bank manager processing.';
COMMENT ON TABLE admin_activity_logs IS 'Logs of bulk admin actions for audit trail.';
