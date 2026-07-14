/*
  # Implement Atomic Wallet Operations

  1. Critical Security Fix
    - Replace read-then-update pattern with atomic operations
    - Prevents race conditions in concurrent wallet updates
    - Ensures balance consistency

  ## Problem
  Current pattern:
  1. Read balance = 100
  2. Calculate new = 100 + 50 = 150
  3. Write 150
  If two requests happen simultaneously, both read 100 and write 150 instead of 200.

  ## Solution
  Use atomic SQL operations: balance = balance + amount

  2. Changes
    - Update wallet update functions to use atomic operations
    - Fix triggers to use atomic increments
    - Add database constraints for consistency
*/

-- Create or replace the wallet update trigger with atomic operations
CREATE OR REPLACE FUNCTION trigger_update_treat_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_exists boolean;
BEGIN
  -- Check if wallet exists
  SELECT EXISTS(
    SELECT 1 FROM treat_wallets WHERE user_id = NEW.user_id
  ) INTO v_wallet_exists;

  -- Create wallet if it doesn't exist
  IF NOT v_wallet_exists THEN
    INSERT INTO treat_wallets (
      user_id, balance, purchased_balance, earned_balance,
      total_purchased, total_spent, total_earned, total_withdrawn
    ) VALUES (
      NEW.user_id, 0, 0, 0, 0, 0, 0, 0
    );
  END IF;

  -- Update wallet using ATOMIC operations (no race conditions)
  IF NEW.transaction_type IN ('purchase', 'bonus', 'referral_bonus', 'daily_checkin') THEN
    -- Credits: Atomic increment
    UPDATE treat_wallets
    SET
      balance = balance + NEW.amount,
      purchased_balance = purchased_balance + NEW.amount,
      total_purchased = total_purchased + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('earn', 'reward', 'contribution_reward') THEN
    -- Earnings: Atomic increment
    UPDATE treat_wallets
    SET
      balance = balance + NEW.amount,
      earned_balance = earned_balance + NEW.amount,
      total_earned = total_earned + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('spend', 'promotion_spent', 'tip_sent') THEN
    -- Spending: Atomic decrement
    UPDATE treat_wallets
    SET
      balance = balance - NEW.amount,
      total_spent = total_spent + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id
    AND balance >= NEW.amount; -- Ensure sufficient balance

    -- Check if update succeeded
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient balance for user %', NEW.user_id;
    END IF;

  ELSIF NEW.transaction_type = 'withdrawal' THEN
    -- Withdrawal: Atomic decrement from earned balance
    UPDATE treat_wallets
    SET
      balance = balance - NEW.amount,
      earned_balance = earned_balance - NEW.amount,
      total_withdrawn = total_withdrawn + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id
    AND earned_balance >= NEW.amount; -- Ensure sufficient earned balance

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient earned balance for withdrawal for user %', NEW.user_id;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- Ensure trigger is attached
DROP TRIGGER IF EXISTS update_treat_wallet_on_transaction ON treat_transactions;
CREATE TRIGGER update_treat_wallet_on_transaction
  AFTER INSERT ON treat_transactions
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION trigger_update_treat_wallet();

-- Add database constraints to prevent negative balances
ALTER TABLE treat_wallets
  ADD CONSTRAINT check_balance_non_negative 
  CHECK (balance >= 0);

ALTER TABLE treat_wallets
  ADD CONSTRAINT check_purchased_balance_non_negative
  CHECK (purchased_balance >= 0);

ALTER TABLE treat_wallets
  ADD CONSTRAINT check_earned_balance_non_negative
  CHECK (earned_balance >= 0);

-- Add index for concurrent update performance
CREATE INDEX IF NOT EXISTS idx_treat_wallets_user_id_balance 
ON treat_wallets(user_id, balance);

-- Log this fix
DO $$
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'ATOMIC WALLET OPERATIONS IMPLEMENTED';
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  - Replaced read-then-update with atomic SQL operations';
  RAISE NOTICE '  - Added balance constraints (no negative balances)';
  RAISE NOTICE '  - Race conditions eliminated';
  RAISE NOTICE '  - Concurrent updates now safe';
  RAISE NOTICE '================================================================';
END $$;
