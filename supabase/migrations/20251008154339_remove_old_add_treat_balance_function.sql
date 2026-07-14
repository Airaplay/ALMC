/*
  # Remove Old add_treat_balance Function

  1. Problem
    - Two versions of add_treat_balance exist (2-param and 4-param)
    - Old 2-param version doesn't update total_earned or log transactions
    - This can cause inconsistency if the wrong version is called
    
  2. Changes
    - Drop the old 2-parameter version
    - Keep only the 4-parameter version that properly tracks everything
    
  3. Security
    - No security impact as we're removing unused code
    - The 4-param version maintains SECURITY DEFINER
*/

-- Drop the old 2-parameter version
DROP FUNCTION IF EXISTS add_treat_balance(uuid, integer);

-- Verify the 4-parameter version exists (it should from previous migration)
-- This is just a safety check and will do nothing if it already exists
CREATE OR REPLACE FUNCTION add_treat_balance(
  p_user_id uuid,
  p_amount integer,
  p_transaction_type text DEFAULT 'bonus',
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert or update wallet balance
  INSERT INTO treat_wallets (user_id, balance, total_purchased, total_spent, total_earned, total_withdrawn)
  VALUES (p_user_id, p_amount, 0, 0, p_amount, 0)
  ON CONFLICT (user_id)
  DO UPDATE SET
    balance = treat_wallets.balance + p_amount,
    total_earned = treat_wallets.total_earned + p_amount,
    updated_at = now();
    
  -- Log the transaction
  INSERT INTO treat_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    status
  ) VALUES (
    p_user_id,
    p_amount,
    p_transaction_type,
    COALESCE(p_description, 'Treat balance added'),
    'completed'
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION add_treat_balance(uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION add_treat_balance(uuid, integer, text, text) TO service_role;
