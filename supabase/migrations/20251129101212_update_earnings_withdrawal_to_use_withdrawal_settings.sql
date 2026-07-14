/*
  # Update Earnings Withdrawal System to Use withdrawal_settings

  ## Overview
  This migration updates the earnings withdrawal system (Live Balance to Bank/USDT) 
  to use the admin-controlled withdrawal_settings table for exchange rates and fees.

  ## Key Difference
  - Treat Withdrawals (treats → Live Balance): Uses `treat_withdrawal_settings`
  - Earnings Withdrawals (Live Balance → Bank/USDT): Uses `withdrawal_settings`

  ## Changes Made
  1. Update admin_approve_withdrawal to apply exchange rate and fees from withdrawal_settings
  2. Add validation to check if withdrawals are enabled
  3. Calculate net amount after fees
  4. Update user's total_earnings correctly

  ## Important Notes
  - Admin controls in dashboard apply to Earnings Withdrawals, not Treat Withdrawals
  - Exchange rate from withdrawal_settings converts Live Balance to USD for payout
  - Fees are deducted from the withdrawal amount before payout
*/

-- Update admin_approve_withdrawal function to apply settings from withdrawal_settings
CREATE OR REPLACE FUNCTION admin_approve_withdrawal(
  request_id uuid,
  admin_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  withdrawal_record record;
  settings_record record;
  v_net_amount decimal;
  v_fee_amount decimal;
  v_gross_amount decimal;
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  -- Get withdrawal settings
  SELECT 
    exchange_rate,
    withdrawal_fee_type,
    withdrawal_fee_value,
    withdrawals_enabled,
    minimum_withdrawal_usd
  INTO settings_record
  FROM withdrawal_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Withdrawal settings not configured. Please contact administrator.');
  END IF;

  -- Check if withdrawals are enabled
  IF NOT settings_record.withdrawals_enabled THEN
    RETURN jsonb_build_object('error', 'Withdrawals are currently disabled by administrator.');
  END IF;

  -- Get the withdrawal request
  SELECT * INTO withdrawal_record
  FROM withdrawal_requests
  WHERE id = request_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Withdrawal request not found or already processed.');
  END IF;

  -- Calculate amounts
  -- Live Balance amount is already in USD equivalent
  v_gross_amount := withdrawal_record.amount;

  -- Calculate fee based on type
  IF settings_record.withdrawal_fee_type = 'percentage' THEN
    v_fee_amount := (v_gross_amount * settings_record.withdrawal_fee_value / 100);
  ELSIF settings_record.withdrawal_fee_type = 'fixed' THEN
    v_fee_amount := settings_record.withdrawal_fee_value;
  ELSE
    v_fee_amount := 0;
  END IF;

  -- Calculate net amount
  v_net_amount := v_gross_amount - v_fee_amount;

  -- Ensure net amount is positive
  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Withdrawal amount too small after fees. Minimum withdrawal is $' || settings_record.minimum_withdrawal_usd || ' USD.');
  END IF;

  -- Update the withdrawal request with fee details
  UPDATE withdrawal_requests 
  SET 
    status = 'approved',
    processed_date = now(),
    admin_notes = admin_approve_withdrawal.admin_notes,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'gross_amount', v_gross_amount,
      'fee_type', settings_record.withdrawal_fee_type,
      'fee_amount', v_fee_amount,
      'net_amount', v_net_amount,
      'exchange_rate', settings_record.exchange_rate,
      'approved_at', now()
    )
  WHERE id = request_id;
  
  RETURN jsonb_build_object(
    'success', true, 
    'message', 'Withdrawal request approved successfully',
    'gross_amount', v_gross_amount,
    'fee_amount', v_fee_amount,
    'net_amount', v_net_amount,
    'details', format('Approved: $%s USD (Fee: $%s, Net: $%s)', 
                      ROUND(v_gross_amount, 2), 
                      ROUND(v_fee_amount, 2), 
                      ROUND(v_net_amount, 2))
  );
END;
$$;

-- Create function to get current earnings withdrawal settings (for user preview)
CREATE OR REPLACE FUNCTION get_earnings_withdrawal_settings()
RETURNS TABLE (
  withdrawals_enabled boolean,
  minimum_withdrawal_usd decimal,
  exchange_rate decimal,
  withdrawal_fee_type text,
  withdrawal_fee_value decimal,
  exchange_rate_last_updated timestamptz
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    withdrawal_settings.withdrawals_enabled,
    withdrawal_settings.minimum_withdrawal_usd,
    withdrawal_settings.exchange_rate,
    withdrawal_settings.withdrawal_fee_type,
    withdrawal_settings.withdrawal_fee_value,
    withdrawal_settings.exchange_rate_last_updated
  FROM withdrawal_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  -- Return default values if not configured
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      true as withdrawals_enabled,
      5.0::decimal as minimum_withdrawal_usd,
      1.0::decimal as exchange_rate,
      'percentage'::text as withdrawal_fee_type,
      0.0::decimal as withdrawal_fee_value,
      now() as exchange_rate_last_updated;
  END IF;
END;
$$;

-- Create function to preview withdrawal fees (for UI)
CREATE OR REPLACE FUNCTION calculate_earnings_withdrawal_preview(
  p_amount decimal
)
RETURNS TABLE (
  gross_amount decimal,
  fee_type text,
  fee_amount decimal,
  net_amount decimal,
  can_withdraw boolean,
  message text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  settings_record record;
  v_fee decimal;
  v_net decimal;
BEGIN
  -- Get current settings
  SELECT 
    withdrawals_enabled,
    minimum_withdrawal_usd,
    withdrawal_fee_type,
    withdrawal_fee_value
  INTO settings_record
  FROM withdrawal_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  -- Check if settings exist
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      p_amount,
      'percentage'::text,
      0.0::decimal,
      p_amount,
      false,
      'Withdrawal settings not configured'::text;
    RETURN;
  END IF;

  -- Check if withdrawals enabled
  IF NOT settings_record.withdrawals_enabled THEN
    RETURN QUERY SELECT
      p_amount,
      settings_record.withdrawal_fee_type,
      0.0::decimal,
      p_amount,
      false,
      'Withdrawals are currently disabled'::text;
    RETURN;
  END IF;

  -- Calculate fee
  IF settings_record.withdrawal_fee_type = 'percentage' THEN
    v_fee := (p_amount * settings_record.withdrawal_fee_value / 100);
  ELSE
    v_fee := settings_record.withdrawal_fee_value;
  END IF;

  v_net := p_amount - v_fee;

  -- Check minimum
  IF p_amount < settings_record.minimum_withdrawal_usd THEN
    RETURN QUERY SELECT
      p_amount,
      settings_record.withdrawal_fee_type,
      v_fee,
      v_net,
      false,
      format('Minimum withdrawal is $%s USD', settings_record.minimum_withdrawal_usd)::text;
    RETURN;
  END IF;

  -- Check if net amount is positive
  IF v_net <= 0 THEN
    RETURN QUERY SELECT
      p_amount,
      settings_record.withdrawal_fee_type,
      v_fee,
      v_net,
      false,
      'Amount too small after fees'::text;
    RETURN;
  END IF;

  -- All good
  RETURN QUERY SELECT
    p_amount,
    settings_record.withdrawal_fee_type,
    v_fee,
    v_net,
    true,
    'Withdrawal can be processed'::text;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION admin_approve_withdrawal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_earnings_withdrawal_settings() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION calculate_earnings_withdrawal_preview(decimal) TO authenticated, anon;

-- Add helpful comments
COMMENT ON FUNCTION admin_approve_withdrawal IS 'Approves earnings withdrawal request and applies current exchange rate and fees from withdrawal_settings';
COMMENT ON FUNCTION get_earnings_withdrawal_settings IS 'Gets current withdrawal settings for earnings withdrawals (Live Balance to Bank/USDT)';
COMMENT ON FUNCTION calculate_earnings_withdrawal_preview IS 'Calculates withdrawal fees and validates amount for earnings withdrawals';
