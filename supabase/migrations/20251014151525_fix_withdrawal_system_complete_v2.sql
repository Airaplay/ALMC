/*
  # Fix Complete Withdrawal System V2

  1. Updates
    - Drop and recreate admin_get_withdrawal_requests with new fields
    - Update withdraw_user_funds function to work with withdrawal_methods table
    - Store selected withdrawal method details in withdrawal_requests
    - Add columns to withdrawal_requests for method details
    
  2. Changes
    - Add method_type, bank_name, account_number, account_holder_name, swift_code, country fields to withdrawal_requests
    - Update withdraw_user_funds to accept method_id and populate all fields
    - Ensure proper data capture for both USDT and bank withdrawals
*/

-- Add new columns to withdrawal_requests table for full withdrawal method details
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'method_type'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN method_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'withdrawal_method_id'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN withdrawal_method_id uuid REFERENCES withdrawal_methods(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'bank_name'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN bank_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'account_number'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN account_number text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'account_holder_name'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN account_holder_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'swift_code'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN swift_code text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'country'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN country text;
  END IF;
END $$;

-- Drop existing function
DROP FUNCTION IF EXISTS admin_get_withdrawal_requests(text);

-- Update admin_get_withdrawal_requests to include all new fields
CREATE OR REPLACE FUNCTION admin_get_withdrawal_requests(
  status_filter text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_email text,
  user_display_name text,
  amount numeric,
  wallet_address text,
  method_type text,
  bank_name text,
  account_number text,
  account_holder_name text,
  swift_code text,
  country text,
  status text,
  request_date timestamptz,
  processed_date timestamptz,
  admin_notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  -- Return withdrawal requests with optional status filter
  RETURN QUERY
  SELECT 
    wr.id,
    wr.user_id,
    u.email as user_email,
    u.display_name as user_display_name,
    wr.amount,
    wr.wallet_address,
    wr.method_type,
    wr.bank_name,
    wr.account_number,
    wr.account_holder_name,
    wr.swift_code,
    wr.country,
    wr.status,
    wr.request_date,
    wr.processed_date,
    wr.admin_notes
  FROM withdrawal_requests wr
  LEFT JOIN users u ON wr.user_id = u.id
  WHERE status_filter IS NULL OR wr.status = status_filter
  ORDER BY wr.request_date DESC;
END;
$$;

-- Drop existing withdraw_user_funds functions
DROP FUNCTION IF EXISTS withdraw_user_funds(numeric);
DROP FUNCTION IF EXISTS withdraw_user_funds(numeric, uuid);

-- Update withdraw_user_funds function to accept withdrawal_method_id
CREATE OR REPLACE FUNCTION withdraw_user_funds(
  withdrawal_amount numeric,
  method_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_earnings numeric;
  payout_threshold numeric;
  withdrawal_method RECORD;
  new_request_id uuid;
  result jsonb;
BEGIN
  -- Check if user is authenticated
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Validate amount
  IF withdrawal_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be greater than 0';
  END IF;

  -- Get current user earnings
  SELECT total_earnings INTO current_earnings
  FROM users
  WHERE id = current_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Check if user has sufficient funds
  IF current_earnings < withdrawal_amount THEN
    RAISE EXCEPTION 'Insufficient funds for withdrawal';
  END IF;

  -- Get applicable payout threshold
  SELECT (get_user_payout_settings(current_user_id)->>'payout_threshold')::numeric INTO payout_threshold;
  
  -- Check if withdrawal meets minimum threshold
  IF withdrawal_amount < payout_threshold THEN
    RAISE EXCEPTION 'Minimum withdrawal amount is $%', payout_threshold;
  END IF;

  -- Get withdrawal method details
  IF method_id IS NULL THEN
    -- Try to get default method
    SELECT * INTO withdrawal_method
    FROM withdrawal_methods
    WHERE user_id = current_user_id AND is_default = true
    LIMIT 1;
    
    IF NOT FOUND THEN
      -- Get any method
      SELECT * INTO withdrawal_method
      FROM withdrawal_methods
      WHERE user_id = current_user_id
      LIMIT 1;
    END IF;
  ELSE
    -- Get specific method
    SELECT * INTO withdrawal_method
    FROM withdrawal_methods
    WHERE id = method_id AND user_id = current_user_id;
  END IF;

  -- Check if withdrawal method exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No withdrawal method found. Please add a withdrawal method first.';
  END IF;

  -- Create withdrawal request with all method details
  INSERT INTO withdrawal_requests (
    user_id,
    amount,
    wallet_address,
    method_type,
    withdrawal_method_id,
    bank_name,
    account_number,
    account_holder_name,
    swift_code,
    country,
    status,
    request_date
  ) VALUES (
    current_user_id,
    withdrawal_amount,
    COALESCE(withdrawal_method.wallet_address, ''),
    withdrawal_method.method_type,
    withdrawal_method.id,
    withdrawal_method.bank_name,
    withdrawal_method.account_number,
    withdrawal_method.account_holder_name,
    withdrawal_method.swift_code,
    withdrawal_method.country,
    'pending',
    now()
  ) RETURNING id INTO new_request_id;

  -- Deduct amount from user earnings
  UPDATE users
  SET 
    total_earnings = total_earnings - withdrawal_amount,
    updated_at = now()
  WHERE id = current_user_id;

  RETURN jsonb_build_object(
    'success', true, 
    'message', 'Withdrawal request submitted successfully',
    'request_id', new_request_id,
    'amount', withdrawal_amount,
    'remaining_balance', current_earnings - withdrawal_amount,
    'method_type', withdrawal_method.method_type
  );
END;
$$;