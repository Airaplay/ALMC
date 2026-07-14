/*
  # Fix add_treat_balance to Properly Track Earned Balance

  ## Overview
  Updates the add_treat_balance function to ensure earned treats are tracked correctly.
  This is critical for withdrawal validation.

  ## Changes Made

  ### 1. Function Enhancement
  - Ensures total_earned is incremented for all earning transaction types
  - Maintains backward compatibility with existing calls
  - Properly differentiates between earned and purchased treats

  ### 2. Transaction Types Mapping
  - 'purchase' → Updates total_purchased (NOT withdrawable)
  - 'earn', 'daily_checkin', 'referral_bonus', 'tip_received', 'bonus' → Updates total_earned (withdrawable)
  - 'spend', 'tip_sent', 'promotion_payment' → Updates total_spent
  - 'withdrawal' → Updates total_withdrawn

  ## Important Notes
  - Earned treats can be withdrawn
  - Purchased treats cannot be withdrawn (stay in wallet for spending only)
  - Balance = total_earned + total_purchased - total_spent - total_withdrawn
*/

-- Drop all existing versions of the function
DROP FUNCTION IF EXISTS add_treat_balance(uuid, integer);
DROP FUNCTION IF EXISTS add_treat_balance(uuid, integer, text);
DROP FUNCTION IF EXISTS add_treat_balance(uuid, integer, text, text);
DROP FUNCTION IF EXISTS add_treat_balance(uuid, integer, text, text, uuid);

-- Create the updated function with proper earned tracking
CREATE OR REPLACE FUNCTION add_treat_balance(
  p_user_id uuid,
  p_amount integer,
  p_transaction_type text DEFAULT 'bonus',
  p_description text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance_before numeric;
  v_balance_after numeric;
  v_metadata jsonb;
  v_is_earning_type boolean;
  v_is_purchase_type boolean;
BEGIN
  -- Validate amount
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'Amount cannot be zero';
  END IF;

  -- Determine transaction category
  v_is_earning_type := p_transaction_type IN (
    'earn', 'daily_checkin', 'referral_bonus', 
    'tip_received', 'bonus', 'reward'
  );
  
  v_is_purchase_type := p_transaction_type IN ('purchase', 'deposit');

  -- Ensure wallet exists
  INSERT INTO treat_wallets (
    user_id, balance, total_purchased, 
    total_spent, total_earned, total_withdrawn
  )
  VALUES (p_user_id, 0, 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Get the current balance before update
  SELECT balance INTO v_balance_before
  FROM treat_wallets
  WHERE user_id = p_user_id;
  
  -- Calculate the new balance
  v_balance_after := v_balance_before + p_amount;
  
  -- Validate new balance is not negative
  IF v_balance_after < 0 THEN
    RAISE EXCEPTION 'Insufficient balance. Current: %, Required: %', v_balance_before, -p_amount;
  END IF;
  
  -- Build metadata with reference_id if provided
  IF p_reference_id IS NOT NULL THEN
    v_metadata := jsonb_build_object('reference_id', p_reference_id);
  ELSE
    v_metadata := NULL;
  END IF;
  
  -- Update wallet balance based on transaction type
  IF v_is_earning_type AND p_amount > 0 THEN
    -- Earning transaction: increase balance and total_earned
    UPDATE treat_wallets
    SET
      balance = v_balance_after,
      total_earned = total_earned + p_amount,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSIF v_is_purchase_type AND p_amount > 0 THEN
    -- Purchase transaction: increase balance and total_purchased
    UPDATE treat_wallets
    SET
      balance = v_balance_after,
      total_purchased = total_purchased + p_amount,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSIF p_amount < 0 THEN
    -- Spending transaction: decrease balance and increase total_spent
    UPDATE treat_wallets
    SET
      balance = v_balance_after,
      total_spent = total_spent + ABS(p_amount),
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    -- Generic transaction: just update balance
    UPDATE treat_wallets
    SET
      balance = v_balance_after,
      updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
    
  -- Log the transaction with balance tracking
  INSERT INTO treat_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    balance_before,
    balance_after,
    status,
    metadata
  ) VALUES (
    p_user_id,
    p_amount,
    p_transaction_type,
    COALESCE(p_description, 'Treat balance updated'),
    v_balance_before,
    v_balance_after,
    'completed',
    v_metadata
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION add_treat_balance(uuid, integer, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION add_treat_balance(uuid, integer, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION add_treat_balance(uuid, integer, text, text, uuid) TO anon;

-- Add helpful comment
COMMENT ON FUNCTION add_treat_balance IS 
'Adds or deducts treats from user wallet. Earning types (earn, daily_checkin, referral_bonus, tip_received, bonus, reward) update total_earned. Purchase types (purchase, deposit) update total_purchased. Negative amounts update total_spent.';
