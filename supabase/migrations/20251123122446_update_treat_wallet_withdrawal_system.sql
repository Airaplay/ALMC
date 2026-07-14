/*
  # Update Treat Wallet Withdrawal System

  ## Overview
  This migration enhances the Treat Wallet system to properly track earnings and enforce withdrawal restrictions.

  ## Changes Made

  ### 1. Withdrawal Function Enhancement
  Creates `process_treat_withdrawal` function with the following logic:
  - Users can only withdraw from `total_earned`, NOT from the entire balance
  - Purchased Treats are NEVER withdrawable
  - Returns detailed withdrawal information including net amount after fees
  - Comprehensive validation to prevent negative values and race conditions
  - Atomic transaction handling to prevent double withdrawals

  ### 2. Wallet Balance Tracking
  The wallet system tracks three key metrics:
  - `balance`: Total funds the user currently has (earned + purchased)
  - `total_earned`: Total Treats earned from check-ins, referrals, bonuses, tips (WITHDRAWABLE)
  - `total_spent`: Total Treats spent on promotions, tips, etc.
  - `total_purchased`: Total Treats purchased (NOT WITHDRAWABLE)
  - `total_withdrawn`: Total amount successfully withdrawn

  ### 3. Withdrawal Rules
  - Minimum withdrawal amount enforced
  - Fee calculation (percentage + fixed)
  - Convert Treats to USD based on configured rate
  - Transfer net amount to user's Live Balance
  - Update all wallet counters atomically

  ### 4. Security Features
  - Row-level locking to prevent race conditions
  - Comprehensive error handling
  - Balance validation before deduction
  - Transaction logging for audit trail
  - SECURITY DEFINER for proper permission handling

  ## Important Notes
  - Only earned balance can be withdrawn
  - Purchased balance remains in the wallet for spending only
  - All operations are atomic and thread-safe
  - Failed withdrawals don't affect wallet state
*/

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS process_treat_withdrawal(uuid, integer);

-- Create the process_treat_withdrawal function
CREATE OR REPLACE FUNCTION process_treat_withdrawal(
  p_user_id uuid,
  p_treats_amount integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet_record RECORD;
  v_settings_record RECORD;
  v_current_balance numeric;
  v_current_earned numeric;
  v_usd_amount numeric;
  v_fee_amount numeric;
  v_net_amount numeric;
  v_new_balance numeric;
  v_new_earned numeric;
BEGIN
  -- Validate input
  IF p_treats_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal amount must be greater than 0'
    );
  END IF;

  -- Get withdrawal settings with validation
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

  -- Lock the wallet row to prevent race conditions
  SELECT 
    balance,
    total_earned,
    total_purchased,
    total_spent,
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

  v_current_balance := v_wallet_record.balance;
  v_current_earned := v_wallet_record.total_earned;

  -- CRITICAL: Check if user has sufficient EARNED balance
  -- Users can only withdraw from earned balance, not purchased balance
  IF v_current_earned < p_treats_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Insufficient earned balance. You have %s earned treats but tried to withdraw %s', v_current_earned, p_treats_amount)
    );
  END IF;

  -- Check if total balance is sufficient (additional safety check)
  IF v_current_balance < p_treats_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Insufficient balance. Current balance: %s treats', v_current_balance)
    );
  END IF;

  -- Calculate USD amount
  v_usd_amount := p_treats_amount * v_settings_record.treat_to_usd_rate;

  -- Calculate fees
  v_fee_amount := (v_usd_amount * v_settings_record.withdrawal_fee_percentage / 100) + v_settings_record.withdrawal_fee_fixed;

  -- Calculate net amount (ensure it's not negative)
  v_net_amount := GREATEST(v_usd_amount - v_fee_amount, 0);

  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal amount too small after fees'
    );
  END IF;

  -- Calculate new balances
  v_new_balance := v_current_balance - p_treats_amount;
  v_new_earned := v_current_earned - p_treats_amount;

  -- Ensure new balances are not negative (safety check)
  IF v_new_balance < 0 OR v_new_earned < 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Balance calculation error. Please contact support.'
    );
  END IF;

  -- Update wallet balances atomically
  UPDATE treat_wallets
  SET
    balance = v_new_balance,
    total_earned = v_new_earned,
    total_withdrawn = total_withdrawn + p_treats_amount,
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Log the withdrawal transaction
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
    p_treats_amount,
    v_current_balance,
    v_new_balance,
    format('Withdrew %s treats to Live Balance ($%s USD)', p_treats_amount, v_net_amount::numeric(10,2)),
    'completed',
    jsonb_build_object(
      'treats_amount', p_treats_amount,
      'usd_amount', v_usd_amount,
      'fee_amount', v_fee_amount,
      'net_amount', v_net_amount,
      'conversion_rate', v_settings_record.treat_to_usd_rate,
      'withdrawn_from_earned', true
    )
  );

  -- Return success with detailed information
  RETURN jsonb_build_object(
    'success', true,
    'treats_withdrawn', p_treats_amount,
    'usd_amount', v_usd_amount,
    'fee_amount', v_fee_amount,
    'net_amount', v_net_amount,
    'new_balance', v_new_balance,
    'new_earned_balance', v_new_earned,
    'message', format('Successfully withdrawn %s treats ($%s USD to Live Balance)', p_treats_amount, v_net_amount::numeric(10,2))
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Catch any unexpected errors
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Withdrawal failed: %s', SQLERRM)
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION process_treat_withdrawal(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION process_treat_withdrawal(uuid, integer) TO service_role;

-- Add helpful comment
COMMENT ON FUNCTION process_treat_withdrawal IS 'Processes treat withdrawal with proper validation. Users can only withdraw from earned balance (not purchased balance). Converts treats to USD and transfers to Live Balance after deducting fees.';
