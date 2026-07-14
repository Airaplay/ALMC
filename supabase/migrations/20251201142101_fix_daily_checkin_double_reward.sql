/*
  # Fix Daily Check-in Double Reward Issue

  ## Problem
  Users are receiving double rewards when claiming Daily Check-in. The issue occurs because:
  1. `add_treat_balance` function updates wallet balance directly (lines 93-125)
  2. `add_treat_balance` then inserts a transaction into `treat_transactions` (lines 128-146)
  3. Trigger `trigger_update_treat_wallet()` fires on transaction insert and updates wallet balance again (line 50-58 in migration 20251124111756)
  
  This results in: `balance = balance + amount + amount` (double reward)

  ## Solution
  Modify the `add_treat_balance` function to NOT update the wallet balance directly.
  Instead, let the trigger handle all wallet balance updates. The function should only:
  1. Calculate `balance_before` and `balance_after` for transaction logging
  2. Insert the transaction record
  3. Let the trigger update the wallet balance

  ## Changes
  - Remove all wallet balance UPDATE statements from `add_treat_balance` function
  - Keep transaction insertion logic
  - Keep balance calculation for transaction logging
  - The trigger `trigger_update_treat_wallet()` will handle all wallet updates
*/

-- Drop all existing versions of the function
DROP FUNCTION IF EXISTS add_treat_balance(uuid, integer);
DROP FUNCTION IF EXISTS add_treat_balance(uuid, integer, text);
DROP FUNCTION IF EXISTS add_treat_balance(uuid, integer, text, text);
DROP FUNCTION IF EXISTS add_treat_balance(uuid, integer, text, text, uuid);

-- Create the fixed function that only inserts transactions
-- The trigger will handle wallet balance updates
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
  -- Validate amount
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'Amount cannot be zero';
  END IF;

  -- Ensure wallet exists (for balance calculation)
  INSERT INTO treat_wallets (
    user_id, balance, total_purchased, 
    total_spent, total_earned, total_withdrawn,
    earned_balance, purchased_balance
  )
  VALUES (p_user_id, 0, 0, 0, 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Get the current balance before update (for transaction logging only)
  SELECT balance INTO v_balance_before
  FROM treat_wallets
  WHERE user_id = p_user_id;
  
  -- Calculate the new balance (for transaction logging only)
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
  
  -- Insert transaction record only
  -- The trigger trigger_update_treat_wallet() will handle wallet balance updates
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
  
  -- Note: Wallet balance update is handled by trigger_update_treat_wallet() trigger
  -- This prevents double updates and ensures consistency
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION add_treat_balance(uuid, integer, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION add_treat_balance(uuid, integer, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION add_treat_balance(uuid, integer, text, text, uuid) TO anon;

-- Update function comment
COMMENT ON FUNCTION add_treat_balance IS 
'Adds or deducts treats from user wallet by inserting a transaction. The trigger_update_treat_wallet() trigger handles all wallet balance updates to prevent double updates. Earning types (earn, daily_checkin, referral_bonus, tip_received, bonus, reward) update total_earned. Purchase types (purchase, deposit) update total_purchased. Negative amounts update total_spent.';

-- Ensure trigger exists on treat_transactions table
-- Drop trigger if it exists (to avoid conflicts)
DROP TRIGGER IF EXISTS trigger_update_treat_wallet ON public.treat_transactions;

-- Create trigger on treat_transactions table
-- This trigger will fire AFTER INSERT and update wallet balances
CREATE TRIGGER trigger_update_treat_wallet
    AFTER INSERT ON public.treat_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_update_treat_wallet();

-- Add helpful comment to the trigger
COMMENT ON TRIGGER trigger_update_treat_wallet ON public.treat_transactions IS 
'Automatically updates treat_wallets balance, earned_balance, purchased_balance and totals when a treat_transaction is inserted. This prevents double updates when add_treat_balance function is called.';

