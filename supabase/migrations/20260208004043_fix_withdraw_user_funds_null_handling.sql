/*
  # Fix withdraw_user_funds NULL Handling

  1. Changes
    - Add proper NULL handling for withdrawal_method_record
    - Ensure all record field accesses are safe
    - Add better error messages

  2. Security
    - Maintains existing security checks
*/

CREATE OR REPLACE FUNCTION withdraw_user_funds(
  withdrawal_amount DECIMAL,
  method_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID;
  current_user_record RECORD;
  withdrawal_settings_record RECORD;
  withdrawal_method_record RECORD;
  exchange_rate_record RECORD;
  v_transaction_id TEXT;
  v_gross_amount_usd DECIMAL;
  v_fee_amount_usd DECIMAL;
  v_net_amount_usd DECIMAL;
  v_balance_before DECIMAL;
  v_balance_after DECIMAL;
  v_user_country TEXT;
  v_exchange_rate DECIMAL;
  v_currency_code TEXT;
  v_currency_symbol TEXT;
  v_currency_name TEXT;
  v_net_amount_local DECIMAL;
  new_withdrawal_id UUID;
  v_method_type TEXT;
  v_wallet_address TEXT;
  v_bank_name TEXT;
  v_account_number TEXT;
  v_account_holder_name TEXT;
  v_swift_code TEXT;
  v_method_country TEXT;
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

    -- Store values in local variables
    v_method_type := withdrawal_method_record.method_type;
    v_wallet_address := withdrawal_method_record.wallet_address;
    v_bank_name := withdrawal_method_record.bank_name;
    v_account_number := withdrawal_method_record.account_number;
    v_account_holder_name := withdrawal_method_record.account_holder_name;
    v_swift_code := withdrawal_method_record.swift_code;
    v_method_country := withdrawal_method_record.country;
  ELSE
    -- Set defaults when no method provided
    v_method_type := NULL;
    v_wallet_address := NULL;
    v_bank_name := NULL;
    v_account_number := NULL;
    v_account_holder_name := NULL;
    v_swift_code := NULL;
    v_method_country := NULL;
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
    v_exchange_rate,
    withdrawal_settings_record.withdrawal_fee_type,
    withdrawal_settings_record.withdrawal_fee_value,
    v_gross_amount_usd,
    v_fee_amount_usd,
    v_net_amount_usd,
    v_net_amount_usd,
    v_net_amount_local,
    v_currency_code,
    v_currency_symbol,
    v_currency_name,
    v_balance_before,
    v_balance_after,
    v_wallet_address,
    v_bank_name,
    v_account_number,
    v_account_holder_name,
    jsonb_build_object(
      'requested_at', now(),
      'currency_conversion', jsonb_build_object(
        'usd_amount', ROUND(v_net_amount_usd, 2),
        'local_amount', ROUND(v_net_amount_local, 2),
        'currency_code', v_currency_code,
        'currency_symbol', v_currency_symbol,
        'exchange_rate', v_exchange_rate,
        'conversion_time', now()
      ),
      'withdrawal_details', jsonb_build_object(
        'method_type', v_method_type,
        'wallet_address', v_wallet_address,
        'bank_name', v_bank_name,
        'account_number', v_account_number,
        'account_holder_name', v_account_holder_name,
        'swift_code', v_swift_code,
        'country', v_method_country
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
      'method_type', v_method_type,
      'wallet_address', v_wallet_address,
      'bank_name', v_bank_name,
      'account_number', v_account_number,
      'account_holder_name', v_account_holder_name
    )
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION withdraw_user_funds TO authenticated;
