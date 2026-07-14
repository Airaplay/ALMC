/*
  # Fix Treat Withdrawal to Add USD to Live Balance

  ## Overview
  The treat withdrawal system was deducting treats from the wallet but NOT adding the converted USD amount to the user's Live Balance (total_earnings).

  ## Problem
  - User withdraws treats from Treat Wallet
  - Treats are deducted successfully
  - USD amount is calculated correctly
  - BUT the USD is never added to users.total_earnings (Live Balance)

  ## Solution
  Update the `process_treat_withdrawal` function to:
  1. Deduct treats from wallet (existing)
  2. Convert to USD after fees (existing)
  3. **ADD the net USD amount to users.total_earnings** (NEW - this was missing!)
  4. Log the transaction (existing)

  ## Changes Made
  - Modified process_treat_withdrawal function to update users.total_earnings
  - Added validation to ensure user record exists
  - Atomic transaction ensures all updates happen together

  ## Security
  - Maintains SECURITY DEFINER
  - All validations remain in place
  - Transaction logging enhanced with live_balance tracking
*/

-- Drop and recreate the function with the fix
DROP FUNCTION IF EXISTS process_treat_withdrawal(uuid, integer);

CREATE OR REPLACE FUNCTION process_treat_withdrawal(
  p_user_id uuid,
  p_treats_amount integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_record RECORD;
  v_settings_record RECORD;
  v_user_record RECORD;
  v_usd_amount numeric;
  v_fee_amount numeric;
  v_net_amount numeric;
BEGIN
  -- Validate input
  IF p_treats_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal amount must be greater than 0'
    );
  END IF;

  -- Get withdrawal settings
  SELECT 
    is_withdrawal_enabled,
    minimum_withdrawal_amount,
    withdrawal_fee_percentage,
    withdrawal_fee_fixed,
    treat_to_usd_rate
  INTO v_settings_record
  FROM treat_withdrawal_settings
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal settings not configured'
    );
  END IF;

  -- Check if withdrawals are enabled
  IF NOT v_settings_record.is_withdrawal_enabled THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawals are currently disabled'
    );
  END IF;

  -- Check minimum withdrawal amount
  IF p_treats_amount < v_settings_record.minimum_withdrawal_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Minimum withdrawal is %s treats', v_settings_record.minimum_withdrawal_amount)
    );
  END IF;

  -- Lock wallet row
  SELECT 
    balance,
    earned_balance,
    purchased_balance,
    total_earned,
    total_withdrawn
  INTO v_wallet_record
  FROM treat_wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Wallet not found'
    );
  END IF;

  -- Check if user has sufficient earned balance
  IF v_wallet_record.earned_balance < p_treats_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Insufficient earned balance. You can withdraw %s treats. (Total Balance: %s treats = %s earned + %s purchased. Only earned treats can be withdrawn)', 
        v_wallet_record.earned_balance,
        v_wallet_record.balance,
        v_wallet_record.earned_balance,
        v_wallet_record.purchased_balance
      )
    );
  END IF;

  -- Calculate USD amount and fees
  v_usd_amount := p_treats_amount * v_settings_record.treat_to_usd_rate;
  v_fee_amount := (v_usd_amount * v_settings_record.withdrawal_fee_percentage / 100) + v_settings_record.withdrawal_fee_fixed;
  v_net_amount := GREATEST(v_usd_amount - v_fee_amount, 0);

  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal amount too small after fees'
    );
  END IF;

  -- Get user's current live balance (total_earnings) and lock the row
  SELECT total_earnings
  INTO v_user_record
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  -- Update wallet: reduce earned_balance and total balance
  UPDATE treat_wallets
  SET
    earned_balance = earned_balance - p_treats_amount,
    balance = balance - p_treats_amount,
    total_withdrawn = total_withdrawn + p_treats_amount,
    updated_at = now()
  WHERE user_id = p_user_id;

  -- CRITICAL FIX: Add the net USD amount to user's Live Balance (total_earnings)
  UPDATE users
  SET
    total_earnings = COALESCE(total_earnings, 0) + v_net_amount,
    updated_at = now()
  WHERE id = p_user_id;

  -- Log transaction with live balance tracking
  INSERT INTO treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    status,
    metadata
  ) VALUES (
    p_user_id,
    'withdrawal',
    -p_treats_amount,
    v_wallet_record.balance,
    v_wallet_record.balance - p_treats_amount,
    format('Withdrew %s treats → $%s USD added to Live Balance', p_treats_amount, v_net_amount::numeric(10,2)),
    'completed',
    jsonb_build_object(
      'treats_amount', p_treats_amount,
      'usd_amount', v_usd_amount,
      'fee_amount', v_fee_amount,
      'net_amount', v_net_amount,
      'conversion_rate', v_settings_record.treat_to_usd_rate,
      'earned_balance_before', v_wallet_record.earned_balance,
      'earned_balance_after', v_wallet_record.earned_balance - p_treats_amount,
      'live_balance_before', v_user_record.total_earnings,
      'live_balance_after', COALESCE(v_user_record.total_earnings, 0) + v_net_amount,
      'added_to_live_balance', true
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'treats_withdrawn', p_treats_amount,
    'usd_amount', v_usd_amount,
    'fee_amount', v_fee_amount,
    'net_amount', v_net_amount,
    'new_balance', v_wallet_record.balance - p_treats_amount,
    'new_earned_balance', v_wallet_record.earned_balance - p_treats_amount,
    'live_balance_before', v_user_record.total_earnings,
    'live_balance_after', COALESCE(v_user_record.total_earnings, 0) + v_net_amount,
    'message', format('Successfully withdrawn %s treats. $%s USD added to Live Balance', p_treats_amount, v_net_amount::numeric(10,2))
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Withdrawal failed: %s', SQLERRM)
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION process_treat_withdrawal(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION process_treat_withdrawal(uuid, integer) TO service_role;

-- Update function comment
COMMENT ON FUNCTION process_treat_withdrawal IS 'Processes treat withdrawal: deducts treats from wallet, converts to USD after fees, and adds net amount to users.total_earnings (Live Balance). Users can only withdraw earned treats.';
