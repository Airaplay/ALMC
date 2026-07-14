/*
  # Fix add_treat_balance Function - Final Version

  1. Problem
    - Multiple versions of add_treat_balance function exist causing conflicts
    - Promotion rejections fail because the wrong function version is called
    - The 5-parameter version (with reference_id) and 4-parameter version conflict

  2. Solution
    - Drop ALL existing versions of the function
    - Create one single authoritative version with all needed parameters
    - This version includes balance tracking and reference_id support

  3. Security
    - SECURITY DEFINER maintained for proper permissions
    - Grants for authenticated and service_role users
*/

-- Drop all existing versions of add_treat_balance
DROP FUNCTION IF EXISTS add_treat_balance(uuid, integer);
DROP FUNCTION IF EXISTS add_treat_balance(uuid, integer, text, text);
DROP FUNCTION IF EXISTS add_treat_balance(uuid, integer, text, text, uuid);

-- Create the final authoritative version with all features
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
BEGIN
  -- Ensure wallet exists and get current balance
  INSERT INTO treat_wallets (user_id, balance, total_purchased, total_spent, total_earned, total_withdrawn)
  VALUES (p_user_id, 0, 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Get the current balance before update
  SELECT balance INTO v_balance_before
  FROM treat_wallets
  WHERE user_id = p_user_id;
  
  -- Calculate the new balance
  v_balance_after := v_balance_before + p_amount;
  
  -- Build metadata with reference_id if provided
  IF p_reference_id IS NOT NULL THEN
    v_metadata := jsonb_build_object('reference_id', p_reference_id);
  ELSE
    v_metadata := NULL;
  END IF;
  
  -- Update wallet balance
  UPDATE treat_wallets
  SET
    balance = v_balance_after,
    total_earned = total_earned + p_amount,
    updated_at = now()
  WHERE user_id = p_user_id;
    
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
    COALESCE(p_description, 'Treat balance added'),
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
