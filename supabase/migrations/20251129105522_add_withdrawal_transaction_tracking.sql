/*
  # Add Comprehensive Transaction Tracking to Withdrawal Requests

  ## Overview
  This migration adds detailed transaction tracking to the withdrawal_requests table,
  including transaction IDs, country information, exchange rates, service fees, and balance tracking.

  ## Changes Made

  ### 1. New Fields in withdrawal_requests Table
  - `transaction_id` (text, unique) - Format: WD-YYYYMMDD-XXXX
  - `user_country` (text) - User's country at time of withdrawal
  - `exchange_rate_applied` (decimal) - Exchange rate used for conversion
  - `service_fee_type` (text) - 'percentage' or 'fixed'
  - `service_fee_value` (decimal) - Fee percentage or fixed amount
  - `gross_amount` (decimal) - Amount before fees
  - `fee_amount` (decimal) - Calculated fee amount
  - `net_amount` (decimal) - Amount after fees (what user receives)
  - `balance_before` (decimal) - User's balance before withdrawal
  - `balance_after` (decimal) - User's balance after withdrawal

  ### 2. Transaction ID Generation
  - Creates `generate_withdrawal_transaction_id()` function
  - Format: WD-YYYYMMDD-XXXX (WD-20251129-0001)
  - Auto-increments sequence number for same day
  - Handles collision detection

  ### 3. Updated withdraw_user_funds Function
  - Automatically captures all transaction details
  - Generates unique transaction ID
  - Records country, exchange rates, fees
  - Tracks balance before/after
  - Returns comprehensive transaction information

  ## Important Notes
  - All new fields are nullable for backward compatibility
  - Transaction IDs are guaranteed unique via database constraint
  - All calculations are atomic and thread-safe
  - Comprehensive audit trail maintained
*/

-- Step 1: Add new fields to withdrawal_requests table
DO $$
BEGIN
  -- Transaction ID (unique identifier for each withdrawal)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'withdrawal_requests' AND column_name = 'transaction_id'
  ) THEN
    ALTER TABLE withdrawal_requests
    ADD COLUMN transaction_id text UNIQUE;

    CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_transaction_id
    ON withdrawal_requests(transaction_id);
  END IF;

  -- User's country at time of withdrawal
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'withdrawal_requests' AND column_name = 'user_country'
  ) THEN
    ALTER TABLE withdrawal_requests
    ADD COLUMN user_country text;
  END IF;

  -- Exchange rate applied for conversion
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'withdrawal_requests' AND column_name = 'exchange_rate_applied'
  ) THEN
    ALTER TABLE withdrawal_requests
    ADD COLUMN exchange_rate_applied decimal(10, 4);
  END IF;

  -- Service fee type (percentage or fixed)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'withdrawal_requests' AND column_name = 'service_fee_type'
  ) THEN
    ALTER TABLE withdrawal_requests
    ADD COLUMN service_fee_type text CHECK (service_fee_type IN ('percentage', 'fixed', NULL));
  END IF;

  -- Service fee value
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'withdrawal_requests' AND column_name = 'service_fee_value'
  ) THEN
    ALTER TABLE withdrawal_requests
    ADD COLUMN service_fee_value decimal(10, 4);
  END IF;

  -- Gross amount (before fees)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'withdrawal_requests' AND column_name = 'gross_amount'
  ) THEN
    ALTER TABLE withdrawal_requests
    ADD COLUMN gross_amount decimal(10, 2);
  END IF;

  -- Calculated fee amount
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'withdrawal_requests' AND column_name = 'fee_amount'
  ) THEN
    ALTER TABLE withdrawal_requests
    ADD COLUMN fee_amount decimal(10, 2);
  END IF;

  -- Net amount (after fees - what user receives)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'withdrawal_requests' AND column_name = 'net_amount'
  ) THEN
    ALTER TABLE withdrawal_requests
    ADD COLUMN net_amount decimal(10, 2);
  END IF;

  -- Balance snapshots
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'withdrawal_requests' AND column_name = 'balance_before'
  ) THEN
    ALTER TABLE withdrawal_requests
    ADD COLUMN balance_before decimal(10, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'withdrawal_requests' AND column_name = 'balance_after'
  ) THEN
    ALTER TABLE withdrawal_requests
    ADD COLUMN balance_after decimal(10, 2);
  END IF;
END $$;

-- Step 2: Create function to generate unique transaction IDs
CREATE OR REPLACE FUNCTION generate_withdrawal_transaction_id()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_date_part text;
  v_sequence_part text;
  v_transaction_id text;
  v_max_sequence integer;
  v_attempts integer := 0;
  v_max_attempts integer := 10;
BEGIN
  -- Get date part (YYYYMMDD)
  v_date_part := to_char(now(), 'YYYYMMDD');

  -- Loop until we find a unique transaction ID
  LOOP
    -- Get the highest sequence number for today
    SELECT COALESCE(
      MAX(
        CAST(
          SUBSTRING(transaction_id FROM 'WD-\d{8}-(\d{4})') AS integer
        )
      ), 0
    ) INTO v_max_sequence
    FROM withdrawal_requests
    WHERE transaction_id LIKE 'WD-' || v_date_part || '-%';

    -- Increment sequence
    v_sequence_part := LPAD((v_max_sequence + 1)::text, 4, '0');

    -- Build transaction ID
    v_transaction_id := 'WD-' || v_date_part || '-' || v_sequence_part;

    -- Check if this ID already exists
    IF NOT EXISTS (
      SELECT 1 FROM withdrawal_requests WHERE transaction_id = v_transaction_id
    ) THEN
      -- Unique ID found, return it
      RETURN v_transaction_id;
    END IF;

    -- Increment attempts counter
    v_attempts := v_attempts + 1;

    -- Safety check to prevent infinite loop
    IF v_attempts >= v_max_attempts THEN
      -- Add random suffix to ensure uniqueness
      v_transaction_id := v_transaction_id || '-' || LPAD(FLOOR(RANDOM() * 1000)::text, 3, '0');
      RETURN v_transaction_id;
    END IF;
  END LOOP;
END;
$$;

-- Step 3: Update withdraw_user_funds function to capture all transaction details
CREATE OR REPLACE FUNCTION withdraw_user_funds(
  withdrawal_amount numeric,
  method_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  current_user_record record;
  withdrawal_settings_record record;
  withdrawal_method_record record;
  v_transaction_id text;
  v_gross_amount decimal;
  v_fee_amount decimal;
  v_net_amount decimal;
  v_balance_before decimal;
  v_balance_after decimal;
  v_user_country text;
  v_exchange_rate decimal;
  new_withdrawal_id uuid;
BEGIN
  -- Get current user
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not authenticated'
    );
  END IF;

  -- Get user details with balance snapshot
  SELECT
    id,
    total_earnings,
    country
  INTO current_user_record
  FROM users
  WHERE id = current_user_id
  FOR UPDATE;

  IF current_user_record IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  -- Store balance before withdrawal
  v_balance_before := COALESCE(current_user_record.total_earnings, 0);
  v_user_country := COALESCE(current_user_record.country, 'Unknown');

  -- Get withdrawal settings
  SELECT
    withdrawals_enabled,
    minimum_withdrawal_usd,
    exchange_rate,
    withdrawal_fee_type,
    withdrawal_fee_value
  INTO withdrawal_settings_record
  FROM withdrawal_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal settings not configured'
    );
  END IF;

  -- Store exchange rate used
  v_exchange_rate := withdrawal_settings_record.exchange_rate;

  -- Check if withdrawals are enabled
  IF NOT withdrawal_settings_record.withdrawals_enabled THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawals are currently disabled'
    );
  END IF;

  -- Validate withdrawal amount
  IF withdrawal_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal amount must be greater than 0'
    );
  END IF;

  IF withdrawal_amount < withdrawal_settings_record.minimum_withdrawal_usd THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Minimum withdrawal amount is $%s', withdrawal_settings_record.minimum_withdrawal_usd)
    );
  END IF;

  IF withdrawal_amount > v_balance_before THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient funds'
    );
  END IF;

  -- Get withdrawal method if specified
  IF method_id IS NOT NULL THEN
    SELECT * INTO withdrawal_method_record
    FROM withdrawal_methods
    WHERE id = method_id AND user_id = current_user_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Invalid withdrawal method'
      );
    END IF;
  END IF;

  -- Calculate amounts
  v_gross_amount := withdrawal_amount;

  -- Calculate fee based on type
  IF withdrawal_settings_record.withdrawal_fee_type = 'percentage' THEN
    v_fee_amount := (v_gross_amount * withdrawal_settings_record.withdrawal_fee_value / 100);
  ELSIF withdrawal_settings_record.withdrawal_fee_type = 'fixed' THEN
    v_fee_amount := withdrawal_settings_record.withdrawal_fee_value;
  ELSE
    v_fee_amount := 0;
  END IF;

  -- Calculate net amount
  v_net_amount := v_gross_amount - v_fee_amount;

  -- Ensure net amount is positive
  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal amount too small after fees'
    );
  END IF;

  -- Calculate balance after withdrawal
  v_balance_after := v_balance_before - v_gross_amount;

  -- Generate unique transaction ID
  v_transaction_id := generate_withdrawal_transaction_id();

  -- Deduct the gross amount from user's earnings
  UPDATE users
  SET total_earnings = total_earnings - v_gross_amount
  WHERE id = current_user_id;

  -- Create withdrawal request with comprehensive tracking
  INSERT INTO withdrawal_requests (
    user_id,
    amount,
    withdrawal_method_id,
    status,
    transaction_id,
    user_country,
    exchange_rate_applied,
    service_fee_type,
    service_fee_value,
    gross_amount,
    fee_amount,
    net_amount,
    balance_before,
    balance_after,
    metadata
  ) VALUES (
    current_user_id,
    v_gross_amount,
    method_id,
    'pending',
    v_transaction_id,
    v_user_country,
    v_exchange_rate,
    withdrawal_settings_record.withdrawal_fee_type,
    withdrawal_settings_record.withdrawal_fee_value,
    v_gross_amount,
    v_fee_amount,
    v_net_amount,
    v_balance_before,
    v_balance_after,
    jsonb_build_object(
      'requested_at', now(),
      'user_agent', current_setting('request.headers', true)::json->>'user-agent',
      'withdrawal_details', jsonb_build_object(
        'method_type', withdrawal_method_record.method_type,
        'wallet_address', withdrawal_method_record.wallet_address,
        'bank_name', withdrawal_method_record.bank_name,
        'account_number', withdrawal_method_record.account_number
      )
    )
  )
  RETURNING id INTO new_withdrawal_id;

  -- Return comprehensive success response
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'withdrawal_id', new_withdrawal_id,
    'gross_amount', ROUND(v_gross_amount, 2),
    'fee_amount', ROUND(v_fee_amount, 2),
    'net_amount', ROUND(v_net_amount, 2),
    'balance_before', ROUND(v_balance_before, 2),
    'balance_after', ROUND(v_balance_after, 2),
    'user_country', v_user_country,
    'exchange_rate', v_exchange_rate,
    'service_fee', jsonb_build_object(
      'type', withdrawal_settings_record.withdrawal_fee_type,
      'value', withdrawal_settings_record.withdrawal_fee_value
    ),
    'message', format('Withdrawal request submitted successfully. Transaction ID: %s', v_transaction_id)
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Withdrawal failed: %s', SQLERRM)
    );
END;
$$;

-- Step 4: Drop existing admin_get_withdrawal_requests function and recreate
DROP FUNCTION IF EXISTS admin_get_withdrawal_requests(text);

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
    wr.requested_date,
    wr.processed_date,
    wr.admin_notes,
    wr.metadata
  FROM withdrawal_requests wr
  INNER JOIN users u ON u.id = wr.user_id
  LEFT JOIN withdrawal_methods wm ON wm.id = wr.withdrawal_method_id
  WHERE (p_status IS NULL OR wr.status = p_status)
  ORDER BY wr.requested_date DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION generate_withdrawal_transaction_id() TO authenticated;
GRANT EXECUTE ON FUNCTION withdraw_user_funds(numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_withdrawal_requests(text, integer, integer) TO authenticated;

-- Add helpful comments
COMMENT ON FUNCTION generate_withdrawal_transaction_id IS 'Generates unique transaction IDs in format WD-YYYYMMDD-XXXX with collision detection';
COMMENT ON FUNCTION withdraw_user_funds IS 'Creates withdrawal request with comprehensive transaction tracking including transaction ID, country, exchange rates, fees, and balance snapshots';
COMMENT ON FUNCTION admin_get_withdrawal_requests IS 'Gets withdrawal requests with all transaction tracking details for admin dashboard';

-- Add column comments for documentation
COMMENT ON COLUMN withdrawal_requests.transaction_id IS 'Unique transaction ID in format WD-YYYYMMDD-XXXX';
COMMENT ON COLUMN withdrawal_requests.user_country IS 'User''s country at time of withdrawal request';
COMMENT ON COLUMN withdrawal_requests.exchange_rate_applied IS 'Exchange rate used for this transaction';
COMMENT ON COLUMN withdrawal_requests.service_fee_type IS 'Type of service fee applied (percentage or fixed)';
COMMENT ON COLUMN withdrawal_requests.service_fee_value IS 'Service fee percentage or fixed amount';
COMMENT ON COLUMN withdrawal_requests.gross_amount IS 'Amount before service fees';
COMMENT ON COLUMN withdrawal_requests.fee_amount IS 'Calculated service fee amount';
COMMENT ON COLUMN withdrawal_requests.net_amount IS 'Amount after fees (what user receives)';
COMMENT ON COLUMN withdrawal_requests.balance_before IS 'User''s balance before withdrawal';
COMMENT ON COLUMN withdrawal_requests.balance_after IS 'User''s balance after withdrawal';
