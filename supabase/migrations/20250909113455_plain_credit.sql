/*
  # Create Treat System Database Functions

  1. Functions
    - `admin_get_treat_stats` - Get treat system statistics
    - `admin_get_treat_withdrawal_requests` - Get withdrawal requests for admin
    - `admin_get_treat_transactions` - Get all treat transactions for admin
    - `admin_approve_treat_withdrawal` - Approve a withdrawal request
    - `admin_reject_treat_withdrawal` - Reject a withdrawal request

  2. Security
    - All functions require admin authentication
    - Proper error handling and validation
*/

-- Function to get treat system statistics
CREATE OR REPLACE FUNCTION admin_get_treat_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  total_circulation NUMERIC := 0;
  total_purchased NUMERIC := 0;
  total_spent NUMERIC := 0;
  total_withdrawn NUMERIC := 0;
  total_usd_value NUMERIC := 0;
  active_users_count INTEGER := 0;
  pending_withdrawals_count INTEGER := 0;
  pending_withdrawal_amount NUMERIC := 0;
  treat_rate NUMERIC := 1.0;
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Get treat to USD rate
  SELECT treat_to_usd_rate INTO treat_rate
  FROM treat_withdrawal_settings
  LIMIT 1;

  -- Calculate total treats in circulation
  SELECT COALESCE(SUM(balance), 0) INTO total_circulation
  FROM treat_wallets;

  -- Calculate total purchased
  SELECT COALESCE(SUM(total_purchased), 0) INTO total_purchased
  FROM treat_wallets;

  -- Calculate total spent
  SELECT COALESCE(SUM(total_spent), 0) INTO total_spent
  FROM treat_wallets;

  -- Calculate total withdrawn
  SELECT COALESCE(SUM(total_withdrawn), 0) INTO total_withdrawn
  FROM treat_wallets;

  -- Calculate total USD value
  total_usd_value := total_circulation * treat_rate;

  -- Count active users with treats
  SELECT COUNT(*) INTO active_users_count
  FROM treat_wallets
  WHERE balance > 0;

  -- Count pending withdrawals
  SELECT COUNT(*), COALESCE(SUM(amount), 0) 
  INTO pending_withdrawals_count, pending_withdrawal_amount
  FROM withdrawal_requests
  WHERE status = 'pending';

  -- Build result JSON
  result := json_build_object(
    'total_treats_in_circulation', total_circulation,
    'total_treats_purchased', total_purchased,
    'total_treats_spent', total_spent,
    'total_treats_withdrawn', total_withdrawn,
    'total_usd_value', total_usd_value,
    'active_users_with_treats', active_users_count,
    'pending_withdrawals', pending_withdrawals_count,
    'pending_withdrawal_amount', pending_withdrawal_amount
  );

  RETURN result;
END;
$$;

-- Function to get treat withdrawal requests for admin
CREATE OR REPLACE FUNCTION admin_get_treat_withdrawal_requests(
  status_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  user_email TEXT,
  user_display_name TEXT,
  amount NUMERIC,
  wallet_address TEXT,
  status TEXT,
  request_date TIMESTAMPTZ,
  processed_date TIMESTAMPTZ,
  admin_notes TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE users.id = auth.uid() AND users.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  RETURN QUERY
  SELECT 
    wr.id,
    wr.user_id,
    u.email,
    u.display_name,
    wr.amount,
    wr.wallet_address,
    wr.status,
    wr.request_date,
    wr.processed_date,
    wr.admin_notes
  FROM withdrawal_requests wr
  JOIN users u ON u.id = wr.user_id
  WHERE (status_filter IS NULL OR wr.status = status_filter)
  ORDER BY wr.request_date DESC;
END;
$$;

-- Function to get treat transactions for admin
CREATE OR REPLACE FUNCTION admin_get_treat_transactions(
  limit_param INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  user_email TEXT,
  user_display_name TEXT,
  transaction_type TEXT,
  amount NUMERIC,
  description TEXT,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE users.id = auth.uid() AND users.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  RETURN QUERY
  SELECT 
    tt.id,
    u.email,
    u.display_name,
    tt.transaction_type,
    tt.amount,
    tt.description,
    tt.status,
    tt.created_at
  FROM treat_transactions tt
  JOIN users u ON u.id = tt.user_id
  ORDER BY tt.created_at DESC
  LIMIT limit_param;
END;
$$;

-- Function to approve treat withdrawal
CREATE OR REPLACE FUNCTION admin_approve_treat_withdrawal(
  request_id UUID,
  admin_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  withdrawal_record RECORD;
  result JSON;
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Get withdrawal request
  SELECT * INTO withdrawal_record
  FROM withdrawal_requests
  WHERE id = request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal request not found or already processed.';
  END IF;

  -- Update withdrawal request status
  UPDATE withdrawal_requests
  SET 
    status = 'approved',
    processed_date = NOW(),
    admin_notes = admin_notes
  WHERE id = request_id;

  -- Update user's treat wallet (subtract withdrawn amount)
  UPDATE treat_wallets
  SET 
    total_withdrawn = total_withdrawn + withdrawal_record.amount,
    updated_at = NOW()
  WHERE user_id = withdrawal_record.user_id;

  result := json_build_object(
    'success', true,
    'message', 'Withdrawal approved successfully'
  );

  RETURN result;
END;
$$;

-- Function to reject treat withdrawal
CREATE OR REPLACE FUNCTION admin_reject_treat_withdrawal(
  request_id UUID,
  admin_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Update withdrawal request status
  UPDATE withdrawal_requests
  SET 
    status = 'rejected',
    processed_date = NOW(),
    admin_notes = admin_notes
  WHERE id = request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal request not found or already processed.';
  END IF;

  result := json_build_object(
    'success', true,
    'message', 'Withdrawal rejected successfully'
  );

  RETURN result;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION admin_get_treat_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_treat_withdrawal_requests(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_treat_transactions(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_approve_treat_withdrawal(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reject_treat_withdrawal(UUID, TEXT) TO authenticated;