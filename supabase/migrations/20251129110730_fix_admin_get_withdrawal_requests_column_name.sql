/*
  # Fix admin_get_withdrawal_requests Column Name

  ## Overview
  Fixes the column name reference in admin_get_withdrawal_requests function.
  The table uses `request_date` not `requested_date`.

  ## Changes
  - Update function to return `request_date` as `requested_date` for consistency
*/

-- Drop and recreate the function with correct column name
DROP FUNCTION IF EXISTS admin_get_withdrawal_requests(text, integer, integer);

CREATE OR REPLACE FUNCTION admin_get_withdrawal_requests(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_email text,
  user_display_name text,
  amount numeric,
  status text,
  transaction_id text,
  user_country text,
  exchange_rate_applied numeric,
  service_fee_type text,
  service_fee_value numeric,
  gross_amount numeric,
  fee_amount numeric,
  net_amount numeric,
  balance_before numeric,
  balance_after numeric,
  withdrawal_method_id uuid,
  method_type text,
  wallet_address text,
  bank_name text,
  account_number text,
  requested_date timestamptz,
  processed_date timestamptz,
  admin_notes text,
  metadata jsonb
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
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
    wr.id,
    wr.user_id,
    u.email as user_email,
    u.display_name as user_display_name,
    wr.amount,
    wr.status,
    wr.transaction_id,
    wr.user_country,
    wr.exchange_rate_applied,
    wr.service_fee_type,
    wr.service_fee_value,
    wr.gross_amount,
    wr.fee_amount,
    wr.net_amount,
    wr.balance_before,
    wr.balance_after,
    wr.withdrawal_method_id,
    wm.method_type,
    wm.wallet_address,
    wm.bank_name,
    wm.account_number,
    wr.request_date as requested_date,  -- Use correct column name
    wr.processed_date,
    wr.admin_notes,
    wr.metadata
  FROM withdrawal_requests wr
  INNER JOIN users u ON u.id = wr.user_id
  LEFT JOIN withdrawal_methods wm ON wm.id = wr.withdrawal_method_id
  WHERE (p_status IS NULL OR wr.status = p_status)
  ORDER BY wr.request_date DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION admin_get_withdrawal_requests(text, integer, integer) TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION admin_get_withdrawal_requests IS 'Gets withdrawal requests with all transaction tracking details for admin dashboard (fixed column name)';
