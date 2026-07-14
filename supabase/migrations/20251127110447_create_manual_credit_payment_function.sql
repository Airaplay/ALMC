/*
  # Create Manual Credit Payment Function
  
  1. New Functions
    - `admin_credit_payment_manually` - Safely credits a payment to a user's wallet
      - Takes payment details as parameters
      - Updates wallet balances
      - Creates transaction record
      - Includes proper error handling
  
  2. Security
    - Function is SECURITY DEFINER to allow admin operations
    - Only accessible by authenticated users (admin check in frontend)
    - Uses parameterized inputs to prevent SQL injection
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
  v_current_purchased numeric;
  v_current_total_purchased numeric;
  v_new_balance numeric;
  v_new_purchased numeric;
  v_wallet_existed boolean;
BEGIN
  -- Check if wallet exists
  SELECT 
    balance, 
    purchased_balance, 
    total_purchased,
    true
  INTO 
    v_current_balance, 
    v_current_purchased, 
    v_current_total_purchased,
    v_wallet_existed
  FROM treat_wallets
  WHERE user_id = p_user_id;

  -- If wallet doesn't exist, create it
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
    v_current_purchased := 0;
    v_current_total_purchased := 0;
    v_wallet_existed := false;
  END IF;

  -- Calculate new balances
  v_new_balance := v_current_balance + p_total_treats;
  v_new_purchased := COALESCE(v_current_total_purchased, 0) + p_total_treats;

  -- Update wallet
  UPDATE treat_wallets
  SET
    balance = v_new_balance,
    purchased_balance = COALESCE(purchased_balance, 0) + p_total_treats,
    total_purchased = v_new_purchased,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Create transaction record
  INSERT INTO treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
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
    v_new_balance,
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
      'amount_paid', p_amount,
      'currency', p_currency,
      'package_name', p_package_name,
      'timestamp', NOW()
    )
  );

  -- Return success response
  RETURN jsonb_build_object(
    'success', true,
    'wallet_existed', v_wallet_existed,
    'previous_balance', v_current_balance,
    'new_balance', v_new_balance,
    'amount_credited', p_total_treats
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error crediting payment: %', SQLERRM;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION admin_credit_payment_manually TO authenticated;
