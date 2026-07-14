/*
  # Fix Admin Double Credit - Remove Direct Wallet Update

  1. Critical Security Fix
    - Removes direct wallet updates from admin_credit_payment_manually
    - Lets trigger handle all wallet updates automatically
    - Prevents double-crediting bug

  ## Problem
  The function was:
  1. Updating wallet directly (lines 80-86)
  2. Inserting transaction (lines 89-123)
  3. Transaction insert triggered trigger_update_treat_wallet
  4. Trigger updated wallet AGAIN
  Result: User received 2x the intended amount

  ## Solution
  Remove direct wallet update, keep only transaction insert.
  The trigger will handle wallet updates correctly.

  2. Changes
    - Recreate admin_credit_payment_manually without wallet UPDATE
    - Keep transaction INSERT only
    - Ensure wallet exists before transaction insert
    - Add admin role verification
*/

CREATE OR REPLACE FUNCTION admin_credit_payment_manually(
  p_user_id uuid,
  p_payment_id uuid,
  p_total_treats numeric,
  p_treats_amount numeric,
  p_bonus_amount numeric,
  p_package_name text,
  p_payment_method text,
  p_amount numeric,
  p_currency text
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_balance numeric;
  v_wallet_existed boolean;
  v_admin_id uuid;
BEGIN
  -- Get the calling user's ID
  v_admin_id := auth.uid();

  -- Verify caller is admin
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = v_admin_id 
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can manually credit payments';
  END IF;

  -- Validate user exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  -- Get current balance (if wallet exists)
  SELECT balance, true
  INTO v_current_balance, v_wallet_existed
  FROM treat_wallets
  WHERE user_id = p_user_id;

  -- If wallet doesn't exist, create it with zero balances
  IF NOT FOUND THEN
    INSERT INTO treat_wallets (
      user_id, 
      balance, 
      purchased_balance, 
      earned_balance, 
      total_purchased, 
      total_spent, 
      total_earned, 
      total_withdrawn
    )
    VALUES (p_user_id, 0, 0, 0, 0, 0, 0, 0);
    
    v_current_balance := 0;
    v_wallet_existed := false;
  END IF;

  -- DO NOT UPDATE WALLET DIRECTLY
  -- Insert transaction only - trigger will update wallet
  INSERT INTO treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after, -- Will be calculated by trigger
    description,
    payment_method,
    payment_reference,
    status,
    metadata
  ) VALUES (
    p_user_id,
    'purchase',
    p_total_treats,
    v_current_balance,
    v_current_balance + p_total_treats, -- Expected balance
    format('Admin manual credit: Purchased %s treats%s (%s package)', 
      p_treats_amount,
      CASE WHEN p_bonus_amount > 0 THEN format(' + %s bonus', p_bonus_amount) ELSE '' END,
      p_package_name
    ),
    p_payment_method,
    p_payment_id::text,
    'completed',
    jsonb_build_object(
      'payment_id', p_payment_id,
      'manual_credit', true,
      'credited_by_admin', true,
      'admin_id', v_admin_id,
      'amount_paid', p_amount,
      'currency', p_currency,
      'package_name', p_package_name,
      'timestamp', NOW()
    )
  );

  -- Log admin action
  INSERT INTO admin_action_logs (admin_id, action, details)
  VALUES (
    v_admin_id,
    'manual_treat_credit',
    jsonb_build_object(
      'user_id', p_user_id,
      'payment_id', p_payment_id,
      'amount', p_total_treats,
      'package', p_package_name,
      'payment_method', p_payment_method
    )
  );

  -- Return success response
  RETURN jsonb_build_object(
    'success', true,
    'wallet_existed', v_wallet_existed,
    'previous_balance', v_current_balance,
    'amount_credited', p_total_treats,
    'note', 'Wallet will be updated by trigger'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error crediting payment: %', SQLERRM;
END;
$$;

-- Keep grant for authenticated (admin check is inside function)
GRANT EXECUTE ON FUNCTION admin_credit_payment_manually TO authenticated;

-- Log this fix
DO $$
BEGIN
  RAISE NOTICE 'Admin double-credit function fixed - Direct wallet update removed';
END $$;
