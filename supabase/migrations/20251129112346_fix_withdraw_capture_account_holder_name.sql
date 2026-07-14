/*
  # Fix Withdrawal Function to Capture Account Holder Name

  ## Overview
  Updates the withdraw_user_funds function to capture and store the account_holder_name
  from withdrawal_methods table into the withdrawal_requests table.

  ## Changes
  - Add account_holder_name to SELECT from withdrawal_methods
  - Add account_holder_name to INSERT statement
  - Include account_holder_name in metadata for comprehensive tracking
*/

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

  -- Check if user has sufficient balance (accounting for fees)
  v_gross_amount := withdrawal_amount;

  -- Calculate fees
  IF withdrawal_settings_record.withdrawal_fee_type = 'percentage' THEN
    v_fee_amount := v_gross_amount * (withdrawal_settings_record.withdrawal_fee_value / 100);
  ELSE
    v_fee_amount := withdrawal_settings_record.withdrawal_fee_value;
  END IF;

  v_net_amount := v_gross_amount - v_fee_amount;

  IF v_balance_before < v_gross_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance'
    );
  END IF;

  -- Get withdrawal method details if provided (including account_holder_name)
  IF method_id IS NOT NULL THEN
    SELECT
      method_type,
      wallet_address,
      bank_name,
      account_number,
      account_holder_name,
      swift_code,
      country
    INTO withdrawal_method_record
    FROM withdrawal_methods
    WHERE id = method_id AND user_id = current_user_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Withdrawal method not found'
      );
    END IF;
  END IF;

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

  -- Create withdrawal request with comprehensive tracking INCLUDING account_holder_name
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
    wallet_address,
    bank_name,
    account_number,
    account_holder_name,
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
    withdrawal_method_record.wallet_address,
    withdrawal_method_record.bank_name,
    withdrawal_method_record.account_number,
    withdrawal_method_record.account_holder_name,
    jsonb_build_object(
      'requested_at', now(),
      'user_agent', current_setting('request.headers', true)::json->>'user-agent',
      'withdrawal_details', jsonb_build_object(
        'method_type', withdrawal_method_record.method_type,
        'wallet_address', withdrawal_method_record.wallet_address,
        'bank_name', withdrawal_method_record.bank_name,
        'account_number', withdrawal_method_record.account_number,
        'account_holder_name', withdrawal_method_record.account_holder_name,
        'swift_code', withdrawal_method_record.swift_code,
        'country', withdrawal_method_record.country
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
    'method_details', jsonb_build_object(
      'method_type', withdrawal_method_record.method_type,
      'wallet_address', withdrawal_method_record.wallet_address,
      'bank_name', withdrawal_method_record.bank_name,
      'account_number', withdrawal_method_record.account_number,
      'account_holder_name', withdrawal_method_record.account_holder_name
    )
  );
END;
$$;

-- Ensure permissions
GRANT EXECUTE ON FUNCTION withdraw_user_funds(numeric, uuid) TO authenticated;

-- Update comment
COMMENT ON FUNCTION withdraw_user_funds IS 'Creates withdrawal request with comprehensive transaction tracking including account holder name, transaction ID, country, exchange rates, fees, and balance snapshots';
