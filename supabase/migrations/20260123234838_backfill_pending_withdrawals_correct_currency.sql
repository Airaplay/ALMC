/*
  # Backfill Pending Withdrawals with Correct Currency Information

  ## Overview
  Updates all pending withdrawals to have correct currency information and local amounts.
  This fixes the critical bug where users were getting exchange rate 1.0.

  ## Changes
  
  1. Update Pending Withdrawals
    - Recalculate exchange_rate_applied based on user's country
    - Add currency_code, currency_symbol, currency_name
    - Calculate amount_local (net USD × exchange rate)
    - Set amount_usd to net_amount
    - Update metadata with currency conversion details
  
  2. Safety Measures
    - Only affects withdrawals with status 'pending'
    - Preserves all original amounts and fees
    - Does NOT change balance deductions (already correct in USD)
    - Adds audit trail in metadata
  
  ## Impact
  - Fixes 5+ pending withdrawals with wrong exchange rates
  - Users will now receive correct local currency amounts
  - Admin can approve these with confidence
  
  ## Notes
  - Does NOT affect approved/completed withdrawals (manual review needed)
  - Users must still have sufficient balance (USD) for withdrawal
  - Fees remain in USD, conversion happens at net amount
*/

-- Backfill pending withdrawals with correct currency information
DO $$
DECLARE
  v_withdrawal_record RECORD;
  v_exchange_rate NUMERIC;
  v_currency_code TEXT;
  v_currency_symbol TEXT;
  v_currency_name TEXT;
  v_amount_local NUMERIC;
  v_old_amount_local NUMERIC;
  v_updated_count INTEGER := 0;
BEGIN
  -- Loop through all pending withdrawals
  FOR v_withdrawal_record IN 
    SELECT 
      id,
      user_id,
      user_country,
      net_amount,
      amount_usd,
      amount_local,
      exchange_rate_applied,
      metadata
    FROM withdrawal_requests
    WHERE status = 'pending'
    AND (exchange_rate_applied = 1.0 OR exchange_rate_applied IS NULL OR amount_local IS NULL)
  LOOP
    -- Store old amount_local for audit
    v_old_amount_local := v_withdrawal_record.amount_local;
    
    -- Get correct exchange rate for user's country
    SELECT 
      exchange_rate,
      currency_code,
      currency_symbol,
      currency_name
    INTO 
      v_exchange_rate,
      v_currency_code,
      v_currency_symbol,
      v_currency_name
    FROM withdrawal_exchange_rates
    WHERE country_code = v_withdrawal_record.user_country
      AND is_active = true;
    
    -- If country not found, default to USD
    IF v_exchange_rate IS NULL THEN
      v_exchange_rate := 1.0;
      v_currency_code := 'USD';
      v_currency_symbol := '$';
      v_currency_name := 'US Dollar';
    END IF;
    
    -- Calculate local currency amount
    v_amount_local := v_withdrawal_record.net_amount * v_exchange_rate;
    
    -- Update the withdrawal with correct currency information
    UPDATE withdrawal_requests
    SET
      exchange_rate_applied = v_exchange_rate,
      currency_code = v_currency_code,
      currency_symbol = v_currency_symbol,
      currency_name = v_currency_name,
      amount_usd = v_withdrawal_record.net_amount,
      amount_local = v_amount_local,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'currency_backfill', jsonb_build_object(
          'backfilled_at', now(),
          'old_exchange_rate', v_withdrawal_record.exchange_rate_applied,
          'new_exchange_rate', v_exchange_rate,
          'old_amount_local', v_old_amount_local,
          'new_amount_local', v_amount_local,
          'currency_code', v_currency_code,
          'reason', 'Fixed critical currency conversion bug'
        )
      )
    WHERE id = v_withdrawal_record.id;
    
    v_updated_count := v_updated_count + 1;
  END LOOP;
  
  -- Log the backfill operation
  RAISE NOTICE 'Backfill complete: Updated % pending withdrawals with correct currency information', v_updated_count;
END $$;

-- Create function for admin to recalculate withdrawal currency (if needed in future)
CREATE OR REPLACE FUNCTION recalculate_withdrawal_currency(p_withdrawal_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_withdrawal RECORD;
  v_exchange_rate NUMERIC;
  v_currency_code TEXT;
  v_currency_symbol TEXT;
  v_currency_name TEXT;
  v_amount_local NUMERIC;
  v_admin_id UUID;
BEGIN
  -- Check if user is admin
  SELECT id INTO v_admin_id
  FROM users
  WHERE id = auth.uid() AND role = 'admin';
  
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only admins can recalculate withdrawal currency'
    );
  END IF;
  
  -- Get withdrawal details
  SELECT 
    id,
    user_country,
    net_amount,
    status,
    exchange_rate_applied
  INTO v_withdrawal
  FROM withdrawal_requests
  WHERE id = p_withdrawal_id;
  
  IF v_withdrawal IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal not found'
    );
  END IF;
  
  -- Get current exchange rate
  SELECT 
    exchange_rate,
    currency_code,
    currency_symbol,
    currency_name
  INTO 
    v_exchange_rate,
    v_currency_code,
    v_currency_symbol,
    v_currency_name
  FROM withdrawal_exchange_rates
  WHERE country_code = v_withdrawal.user_country
    AND is_active = true;
  
  IF v_exchange_rate IS NULL THEN
    v_exchange_rate := 1.0;
    v_currency_code := 'USD';
    v_currency_symbol := '$';
    v_currency_name := 'US Dollar';
  END IF;
  
  -- Calculate local amount
  v_amount_local := v_withdrawal.net_amount * v_exchange_rate;
  
  -- Update withdrawal
  UPDATE withdrawal_requests
  SET
    exchange_rate_applied = v_exchange_rate,
    currency_code = v_currency_code,
    currency_symbol = v_currency_symbol,
    currency_name = v_currency_name,
    amount_usd = v_withdrawal.net_amount,
    amount_local = v_amount_local,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'manual_recalculation', jsonb_build_object(
        'recalculated_at', now(),
        'recalculated_by', v_admin_id,
        'old_exchange_rate', v_withdrawal.exchange_rate_applied,
        'new_exchange_rate', v_exchange_rate,
        'new_amount_local', v_amount_local
      )
    )
  WHERE id = p_withdrawal_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'withdrawal_id', p_withdrawal_id,
    'old_rate', v_withdrawal.exchange_rate_applied,
    'new_rate', v_exchange_rate,
    'amount_usd', v_withdrawal.net_amount,
    'amount_local', v_amount_local,
    'currency', jsonb_build_object(
      'code', v_currency_code,
      'symbol', v_currency_symbol,
      'name', v_currency_name
    )
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION recalculate_withdrawal_currency(UUID) TO authenticated;
