/*
  # Fix Withdrawal Currency Conversion

  ## Overview
  Updates the `withdraw_user_funds` function to use country-specific exchange rates
  from the new `withdrawal_exchange_rates` table instead of the single global rate.

  ## Changes
  
  1. Function Updates
    - Modify `withdraw_user_funds` to look up exchange rate by user's country
    - Fall back to USD (1.0) if country not found or no rate available
    - Add currency information to withdrawal_requests (code, symbol, name)
    - Track both USD amount and local currency amount
  
  2. Schema Updates
    - Add currency_code, currency_symbol, currency_name columns to withdrawal_requests
    - Add amount_local column to store local currency amount
    - Add amount_usd column to store original USD amount (for clarity)
  
  3. Backward Compatibility
    - amount column still represents the withdrawal amount (USD for now, local later)
    - exchange_rate_applied now uses country-specific rate
    - Old withdrawals remain unchanged
  
  ## Impact
  - Fixes critical bug where all users got rate 1.0
  - Nigerian users will now get correct conversion (USD × 1,650)
  - All international users get proper local currency amounts
  - Full audit trail of currency conversion details
*/

-- Add new columns to withdrawal_requests if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'withdrawal_requests' 
                 AND column_name = 'currency_code') THEN
    ALTER TABLE withdrawal_requests ADD COLUMN currency_code TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'withdrawal_requests' 
                 AND column_name = 'currency_symbol') THEN
    ALTER TABLE withdrawal_requests ADD COLUMN currency_symbol TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'withdrawal_requests' 
                 AND column_name = 'currency_name') THEN
    ALTER TABLE withdrawal_requests ADD COLUMN currency_name TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'withdrawal_requests' 
                 AND column_name = 'amount_local') THEN
    ALTER TABLE withdrawal_requests ADD COLUMN amount_local NUMERIC;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'withdrawal_requests' 
                 AND column_name = 'amount_usd') THEN
    ALTER TABLE withdrawal_requests ADD COLUMN amount_usd NUMERIC;
  END IF;
END $$;

-- Update withdraw_user_funds function with proper currency conversion
CREATE OR REPLACE FUNCTION withdraw_user_funds(withdrawal_amount numeric, method_id uuid DEFAULT NULL::uuid)
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
  exchange_rate_record record;
  v_transaction_id text;
  v_gross_amount_usd decimal;
  v_fee_amount_usd decimal;
  v_net_amount_usd decimal;
  v_balance_before decimal;
  v_balance_after decimal;
  v_user_country text;
  v_exchange_rate decimal;
  v_currency_code text;
  v_currency_symbol text;
  v_currency_name text;
  v_net_amount_local decimal;
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
  v_user_country := COALESCE(current_user_record.country, 'US');
  
  -- Get country-specific exchange rate
  SELECT
    country_code,
    currency_code,
    currency_symbol,
    currency_name,
    exchange_rate
  INTO exchange_rate_record
  FROM withdrawal_exchange_rates
  WHERE country_code = v_user_country
    AND is_active = true;
  
  -- If country not found, default to USD
  IF exchange_rate_record IS NULL THEN
    v_exchange_rate := 1.0;
    v_currency_code := 'USD';
    v_currency_symbol := '$';
    v_currency_name := 'US Dollar';
  ELSE
    v_exchange_rate := exchange_rate_record.exchange_rate;
    v_currency_code := exchange_rate_record.currency_code;
    v_currency_symbol := exchange_rate_record.currency_symbol;
    v_currency_name := exchange_rate_record.currency_name;
  END IF;
  
  -- Get withdrawal settings
  SELECT
    withdrawals_enabled,
    minimum_withdrawal_usd,
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
  
  -- Check if withdrawals are enabled
  IF NOT withdrawal_settings_record.withdrawals_enabled THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawals are currently disabled'
    );
  END IF;
  
  -- Validate withdrawal amount (in USD)
  IF withdrawal_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal amount must be greater than 0'
    );
  END IF;
  
  IF withdrawal_amount < withdrawal_settings_record.minimum_withdrawal_usd THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Minimum withdrawal amount is $%s USD', withdrawal_settings_record.minimum_withdrawal_usd)
    );
  END IF;
  
  -- Calculate fees (in USD)
  v_gross_amount_usd := withdrawal_amount;
  
  IF withdrawal_settings_record.withdrawal_fee_type = 'percentage' THEN
    v_fee_amount_usd := v_gross_amount_usd * (withdrawal_settings_record.withdrawal_fee_value / 100);
  ELSE
    v_fee_amount_usd := withdrawal_settings_record.withdrawal_fee_value;
  END IF;
  
  v_net_amount_usd := v_gross_amount_usd - v_fee_amount_usd;
  
  -- Check if user has sufficient balance
  IF v_balance_before < v_gross_amount_usd THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance'
    );
  END IF;
  
  -- Get withdrawal method details if provided
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
  IF v_net_amount_usd <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal amount too small after fees'
    );
  END IF;
  
  -- Calculate local currency amount (net amount × exchange rate)
  v_net_amount_local := v_net_amount_usd * v_exchange_rate;
  
  -- Calculate balance after withdrawal
  v_balance_after := v_balance_before - v_gross_amount_usd;
  
  -- Generate unique transaction ID
  v_transaction_id := generate_withdrawal_transaction_id();
  
  -- Deduct the gross amount from user's earnings
  UPDATE users
  SET total_earnings = total_earnings - v_gross_amount_usd
  WHERE id = current_user_id;
  
  -- Create withdrawal request with comprehensive tracking INCLUDING currency details
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
    amount_usd,
    amount_local,
    currency_code,
    currency_symbol,
    currency_name,
    balance_before,
    balance_after,
    wallet_address,
    bank_name,
    account_number,
    account_holder_name,
    metadata
  ) VALUES (
    current_user_id,
    v_gross_amount_usd,
    method_id,
    'pending',
    v_transaction_id,
    v_user_country,
    v_exchange_rate,  -- Now uses country-specific rate!
    withdrawal_settings_record.withdrawal_fee_type,
    withdrawal_settings_record.withdrawal_fee_value,
    v_gross_amount_usd,
    v_fee_amount_usd,
    v_net_amount_usd,
    v_net_amount_usd,  -- Store USD amount
    v_net_amount_local,  -- Store local currency amount
    v_currency_code,
    v_currency_symbol,
    v_currency_name,
    v_balance_before,
    v_balance_after,
    withdrawal_method_record.wallet_address,
    withdrawal_method_record.bank_name,
    withdrawal_method_record.account_number,
    withdrawal_method_record.account_holder_name,
    jsonb_build_object(
      'requested_at', now(),
      'user_agent', current_setting('request.headers', true)::json->>'user-agent',
      'currency_conversion', jsonb_build_object(
        'usd_amount', ROUND(v_net_amount_usd, 2),
        'local_amount', ROUND(v_net_amount_local, 2),
        'currency_code', v_currency_code,
        'currency_symbol', v_currency_symbol,
        'exchange_rate', v_exchange_rate,
        'conversion_time', now()
      ),
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
  
  -- Return comprehensive success response with currency details
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'withdrawal_id', new_withdrawal_id,
    'amounts', jsonb_build_object(
      'usd', jsonb_build_object(
        'gross', ROUND(v_gross_amount_usd, 2),
        'fee', ROUND(v_fee_amount_usd, 2),
        'net', ROUND(v_net_amount_usd, 2)
      ),
      'local', jsonb_build_object(
        'amount', ROUND(v_net_amount_local, 2),
        'currency_code', v_currency_code,
        'currency_symbol', v_currency_symbol,
        'currency_name', v_currency_name,
        'formatted', format('%s%s', v_currency_symbol, ROUND(v_net_amount_local, 2))
      )
    ),
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
