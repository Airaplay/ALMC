/*
  # Update admin_get_withdrawal_requests with Payment Completion Fields

  1. Changes
    - Add payment_reference to return fields
    - Add payment_completed_date to return fields
    - Add payment_completed_by to return fields
    - Add amount_usd to return fields
    - Add amount_local to return fields
    - Add currency_code to return fields
    - Add currency_symbol to return fields
    - Add currency_name to return fields
    - Add swift_code to return fields
    - Add country to return fields

  2. Reason
    - The UI expects these fields for the 3-stage payment workflow
    - Without these fields, the payment completion system won't work properly
*/

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
  amount_usd numeric,
  amount_local numeric,
  currency_code text,
  currency_symbol text,
  currency_name text,
  balance_before numeric,
  balance_after numeric,
  withdrawal_method_id uuid,
  method_type text,
  wallet_address text,
  bank_name text,
  account_number text,
  account_holder_name text,
  swift_code text,
  country text,
  requested_date timestamptz,
  processed_date timestamptz,
  admin_notes text,
  payment_reference text,
  payment_completed_date timestamptz,
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
    wr.amount_usd,
    wr.amount_local,
    wr.currency_code,
    wr.currency_symbol,
    wr.currency_name,
    wr.balance_before,
    wr.balance_after,
    wr.withdrawal_method_id,
    wm.method_type,
    wm.wallet_address,
    wm.bank_name,
    wm.account_number,
    wr.account_holder_name,
    wm.swift_code,
    wm.country,
    wr.request_date as requested_date,
    wr.processed_date,
    wr.admin_notes,
    wr.payment_reference,
    wr.payment_completed_date,
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
COMMENT ON FUNCTION admin_get_withdrawal_requests IS 'Gets withdrawal requests with all transaction tracking details including payment completion fields for admin dashboard';
