/*
  # Add Comprehensive Transaction Tracking to Withdrawal Requests

  ## Overview
  This migration adds complete transaction tracking to the withdrawal system including:
  - Unique transaction IDs
  - Country information and exchange rates
  - Service fee details (type, value, amount)
  - Balance snapshots (before/after)
  - Complete payment method details

  ## Changes Made

  ### 1. New Fields in withdrawal_requests Table
  - transaction_id: Unique identifier for tracking (WD-YYYYMMDD-XXXX format)
  - user_country: User's country code at time of withdrawal
  - exchange_rate_applied: Snapshot of exchange rate at request time
  - service_fee_type: Type of fee ('percentage' or 'fixed')
  - service_fee_value: Fee percentage or fixed amount
  - gross_amount: Original amount before fees
  - fee_amount: Calculated fee amount
  - net_amount: Final amount after fees
  - balance_before: User's balance before withdrawal
  - balance_after: User's balance after withdrawal
  - method_type: Type of withdrawal method
  - bank_name: Bank name if bank account
  - account_number: Account number if bank account
  - account_holder_name: Account holder name
  - swift_code: SWIFT code for international transfers
  - country: Country from withdrawal method
  - metadata: Additional withdrawal details in JSONB

  ### 2. New Functions
  - generate_withdrawal_transaction_id(): Creates unique transaction IDs
  - Updated withdraw_user_funds(): Captures all details automatically

  ### 3. Indexes
  - Index on transaction_id for fast lookups
  - Index on user_country for reporting
  - Composite index for date-based queries

  ## Important Notes
  - Transaction IDs are unique and immutable
  - All amounts are captured at request time
  - Exchange rates are locked in at submission
  - Balance snapshots ensure audit trail
*/

-- Step 1: Add new fields to withdrawal_requests table
DO $$
BEGIN
  -- Transaction ID (unique identifier)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'transaction_id'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN transaction_id text UNIQUE;
  END IF;

  -- User country at time of withdrawal
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'user_country'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN user_country text;
  END IF;

  -- Exchange rate applied
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'exchange_rate_applied'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN exchange_rate_applied decimal(10, 4) DEFAULT 1.0;
  END IF;

  -- Service fee details
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'service_fee_type'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN service_fee_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'service_fee_value'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN service_fee_value decimal(10, 4);
  END IF;

  -- Amount breakdown
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'gross_amount'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN gross_amount decimal(10, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'fee_amount'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN fee_amount decimal(10, 2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'net_amount'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN net_amount decimal(10, 2);
  END IF;

  -- Balance snapshots
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'balance_before'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN balance_before decimal(10, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'balance_after'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN balance_after decimal(10, 2);
  END IF;

  -- Payment method details (if not already present)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'method_type'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN method_type text;
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

  -- Metadata for additional details
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_requests' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE withdrawal_requests ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Step 2: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_transaction_id 
  ON withdrawal_requests(transaction_id);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_country 
  ON withdrawal_requests(user_country) WHERE user_country IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status_date 
  ON withdrawal_requests(status, request_date DESC);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_net_amount 
  ON withdrawal_requests(net_amount DESC) WHERE net_amount IS NOT NULL;

-- Step 3: Create function to generate unique transaction IDs
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
BEGIN
  -- Get date part (YYYYMMDD)
  v_date_part := to_char(CURRENT_DATE, 'YYYYMMDD');
  
  -- Get max sequence number for today
  SELECT COALESCE(MAX(
    CASE 
      WHEN transaction_id ~ ('^WD-' || v_date_part || '-[0-9]{4}$')
      THEN CAST(substring(transaction_id from length(v_date_part) + 5 for 4) AS integer)
      ELSE 0
    END
  ), 0) INTO v_max_sequence
  FROM withdrawal_requests
  WHERE transaction_id LIKE 'WD-' || v_date_part || '-%';
  
  -- Try to generate unique ID (with retry logic)
  LOOP
    v_max_sequence := v_max_sequence + 1;
    v_sequence_part := lpad(v_max_sequence::text, 4, '0');
    v_transaction_id := 'WD-' || v_date_part || '-' || v_sequence_part;
    
    -- Check if ID already exists
    IF NOT EXISTS (
      SELECT 1 FROM withdrawal_requests WHERE transaction_id = v_transaction_id
    ) THEN
      RETURN v_transaction_id;
    END IF;
    
    v_attempts := v_attempts + 1;
    IF v_attempts > 100 THEN
      RAISE EXCEPTION 'Could not generate unique transaction ID after 100 attempts';
    END IF;
  END LOOP;
END;
$$;

-- Step 4: Update withdraw_user_funds function to capture all details
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
  v_user_id uuid;
  v_user_country text;
  v_current_earnings numeric;
  v_balance_before numeric;
  v_balance_after numeric;
  v_transaction_id text;
  v_withdrawal_settings record;
  v_withdrawal_method record;
  v_gross_amount numeric;
  v_fee_amount numeric;
  v_net_amount numeric;
  v_withdrawal_id uuid;
BEGIN
  -- Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Authentication required');
  END IF;

  -- Validate amount
  IF withdrawal_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Withdrawal amount must be greater than 0');
  END IF;

  -- Get user's country from users table
  SELECT country INTO v_user_country
  FROM users
  WHERE id = v_user_id;

  -- Get current earnings (balance before)
  SELECT total_earnings INTO v_balance_before
  FROM users
  WHERE id = v_user_id;

  IF v_balance_before IS NULL THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  -- Get withdrawal settings
  SELECT 
    withdrawals_enabled,
    minimum_withdrawal_usd,
    exchange_rate,
    withdrawal_fee_type,
    withdrawal_fee_value
  INTO v_withdrawal_settings
  FROM withdrawal_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Withdrawal settings not configured');
  END IF;

  -- Check if withdrawals are enabled
  IF NOT v_withdrawal_settings.withdrawals_enabled THEN
    RETURN jsonb_build_object('error', 'Withdrawals are currently disabled by administrator');
  END IF;

  -- Set gross amount (input amount is the gross)
  v_gross_amount := withdrawal_amount;

  -- Calculate fee
  IF v_withdrawal_settings.withdrawal_fee_type = 'percentage' THEN
    v_fee_amount := (v_gross_amount * v_withdrawal_settings.withdrawal_fee_value / 100);
  ELSIF v_withdrawal_settings.withdrawal_fee_type = 'fixed' THEN
    v_fee_amount := v_withdrawal_settings.withdrawal_fee_value;
  ELSE
    v_fee_amount := 0;
  END IF;

  -- Calculate net amount
  v_net_amount := v_gross_amount - v_fee_amount;

  -- Validate net amount
  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Withdrawal amount too small after fees');
  END IF;

  -- Check minimum withdrawal
  IF v_gross_amount < v_withdrawal_settings.minimum_withdrawal_usd THEN
    RETURN jsonb_build_object(
      'error', 
      format('Minimum withdrawal is $%s USD', v_withdrawal_settings.minimum_withdrawal_usd)
    );
  END IF;

  -- Check sufficient balance
  IF v_balance_before < v_gross_amount THEN
    RETURN jsonb_build_object('error', 'Insufficient funds for withdrawal');
  END IF;

  -- Calculate balance after
  v_balance_after := v_balance_before - v_gross_amount;

  -- Get withdrawal method details
  IF method_id IS NOT NULL THEN
    SELECT 
      method_type,
      wallet_address,
      bank_name,
      account_number,
      account_holder_name,
      swift_code,
      country
    INTO v_withdrawal_method
    FROM withdrawal_methods
    WHERE id = method_id AND user_id = v_user_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Withdrawal method not found');
    END IF;

    -- Use country from withdrawal method if user country not set
    IF v_user_country IS NULL THEN
      v_user_country := v_withdrawal_method.country;
    END IF;
  ELSE
    -- Fallback: Get default method
    SELECT 
      id,
      method_type,
      wallet_address,
      bank_name,
      account_number,
      account_holder_name,
      swift_code,
      country
    INTO v_withdrawal_method
    FROM withdrawal_methods
    WHERE user_id = v_user_id AND is_default = true
    LIMIT 1;

    IF NOT FOUND THEN
      -- Try to get any method
      SELECT 
        id,
        method_type,
        wallet_address,
        bank_name,
        account_number,
        account_holder_name,
        swift_code,
        country
      INTO v_withdrawal_method
      FROM withdrawal_methods
      WHERE user_id = v_user_id
      LIMIT 1;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'No withdrawal method configured');
      END IF;
    END IF;
  END IF;

  -- Generate unique transaction ID
  v_transaction_id := generate_withdrawal_transaction_id();

  -- Deduct from user's balance
  UPDATE users
  SET 
    total_earnings = v_balance_after,
    updated_at = now()
  WHERE id = v_user_id;

  -- Create withdrawal request with all details
  INSERT INTO withdrawal_requests (
    user_id,
    transaction_id,
    user_country,
    amount,
    gross_amount,
    fee_amount,
    net_amount,
    balance_before,
    balance_after,
    exchange_rate_applied,
    service_fee_type,
    service_fee_value,
    wallet_address,
    method_type,
    bank_name,
    account_number,
    account_holder_name,
    swift_code,
    country,
    status,
    metadata
  ) VALUES (
    v_user_id,
    v_transaction_id,
    v_user_country,
    v_gross_amount,
    v_gross_amount,
    v_fee_amount,
    v_net_amount,
    v_balance_before,
    v_balance_after,
    v_withdrawal_settings.exchange_rate,
    v_withdrawal_settings.withdrawal_fee_type,
    v_withdrawal_settings.withdrawal_fee_value,
    CASE 
      WHEN v_withdrawal_method.method_type = 'usdt_wallet' 
      THEN v_withdrawal_method.wallet_address 
      ELSE NULL 
    END,
    v_withdrawal_method.method_type,
    v_withdrawal_method.bank_name,
    v_withdrawal_method.account_number,
    v_withdrawal_method.account_holder_name,
    v_withdrawal_method.swift_code,
    v_withdrawal_method.country,
    'pending',
    jsonb_build_object(
      'submitted_at', now(),
      'settings_snapshot', jsonb_build_object(
        'minimum_withdrawal_usd', v_withdrawal_settings.minimum_withdrawal_usd,
        'exchange_rate', v_withdrawal_settings.exchange_rate,
        'fee_type', v_withdrawal_settings.withdrawal_fee_type,
        'fee_value', v_withdrawal_settings.withdrawal_fee_value
      )
    )
  )
  RETURNING id INTO v_withdrawal_id;

  -- Return success with all details
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Withdrawal request submitted successfully',
    'withdrawal_id', v_withdrawal_id,
    'transaction_id', v_transaction_id,
    'gross_amount', ROUND(v_gross_amount, 2),
    'fee_amount', ROUND(v_fee_amount, 2),
    'net_amount', ROUND(v_net_amount, 2),
    'balance_before', ROUND(v_balance_before, 2),
    'balance_after', ROUND(v_balance_after, 2),
    'service_fee_type', v_withdrawal_settings.withdrawal_fee_type,
    'service_fee_value', v_withdrawal_settings.withdrawal_fee_value,
    'exchange_rate', v_withdrawal_settings.exchange_rate,
    'user_country', v_user_country,
    'status', 'pending'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'error', format('Withdrawal failed: %s', SQLERRM)
    );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION generate_withdrawal_transaction_id() TO authenticated;
GRANT EXECUTE ON FUNCTION withdraw_user_funds(numeric, uuid) TO authenticated;

-- Add helpful comments
COMMENT ON FUNCTION generate_withdrawal_transaction_id IS 'Generates unique transaction IDs in format WD-YYYYMMDD-XXXX';
COMMENT ON FUNCTION withdraw_user_funds IS 'Creates withdrawal request with complete transaction tracking including fees, country, and balance snapshots';
