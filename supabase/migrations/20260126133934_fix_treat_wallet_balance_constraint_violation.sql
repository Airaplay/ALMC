/*
  # Fix Treat Wallet Balance Constraint Violation

  1. Problem
    - The atomic wallet operations trigger doesn't update earned_balance/purchased_balance during spending
    - This violates the constraint: balance = earned_balance + purchased_balance
    - Example: balance=100, purchased_balance=100, earned_balance=0
      - Spend 50: balance becomes 50 (correct)
      - But purchased_balance stays 100 and earned_balance stays 0 (wrong!)
      - Constraint fails: 50 ≠ 100 + 0

  2. Solution
    - Update the trigger to properly deduct from purchased_balance first, then earned_balance
    - Maintain the atomic operations pattern for race condition safety
    - Ensure the constraint is always satisfied

  3. Changes
    - Fix trigger_update_treat_wallet() to handle spending correctly
    - Deduct from purchased_balance first (FIFO), then earned_balance
    - Keep all operations atomic
*/

-- Drop and recreate the wallet update trigger with correct balance handling
CREATE OR REPLACE FUNCTION trigger_update_treat_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_exists boolean;
  v_current_purchased numeric;
  v_deduct_from_purchased numeric;
  v_deduct_from_earned numeric;
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
    -- Credits to purchased balance: Atomic increment
    UPDATE treat_wallets
    SET
      balance = balance + NEW.amount,
      purchased_balance = purchased_balance + NEW.amount,
      total_purchased = total_purchased + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('earn', 'reward', 'contribution_reward', 'tip_received', 'ad_revenue', 'stream_revenue') THEN
    -- Earnings to earned balance: Atomic increment
    UPDATE treat_wallets
    SET
      balance = balance + NEW.amount,
      earned_balance = earned_balance + NEW.amount,
      total_earned = total_earned + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('spend', 'promotion_spent', 'tip_sent') THEN
    -- Spending: Deduct from purchased first (FIFO), then earned
    -- Get current purchased balance
    SELECT purchased_balance INTO v_current_purchased
    FROM treat_wallets
    WHERE user_id = NEW.user_id;

    -- Calculate how much to deduct from each balance
    IF v_current_purchased >= NEW.amount THEN
      -- Can fully deduct from purchased balance
      v_deduct_from_purchased := NEW.amount;
      v_deduct_from_earned := 0;
    ELSIF v_current_purchased > 0 THEN
      -- Partially deduct from purchased, rest from earned
      v_deduct_from_purchased := v_current_purchased;
      v_deduct_from_earned := NEW.amount - v_current_purchased;
    ELSE
      -- Fully deduct from earned balance
      v_deduct_from_purchased := 0;
      v_deduct_from_earned := NEW.amount;
    END IF;

    -- Atomic update with proper balance deduction
    UPDATE treat_wallets
    SET
      balance = balance - NEW.amount,
      purchased_balance = purchased_balance - v_deduct_from_purchased,
      earned_balance = earned_balance - v_deduct_from_earned,
      total_spent = total_spent + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id
    AND balance >= NEW.amount; -- Ensure sufficient balance

    -- Check if update succeeded
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient balance for user %', NEW.user_id;
    END IF;

  ELSIF NEW.transaction_type = 'withdrawal' THEN
    -- Withdrawal: Atomic decrement from earned balance only
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

  ELSIF NEW.transaction_type = 'promotion_refund' THEN
    -- Refund: Add back to purchased balance
    UPDATE treat_wallets
    SET
      balance = balance + NEW.amount,
      purchased_balance = purchased_balance + NEW.amount,
      total_spent = GREATEST(0, total_spent - NEW.amount),
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

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

-- Log this fix
DO $$
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'TREAT WALLET BALANCE CONSTRAINT FIX APPLIED';
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  - Fixed spending to properly update purchased_balance and earned_balance';
  RAISE NOTICE '  - Deducts from purchased_balance first (FIFO), then earned_balance';
  RAISE NOTICE '  - Maintains constraint: balance = earned_balance + purchased_balance';
  RAISE NOTICE '  - All operations remain atomic (race condition safe)';
  RAISE NOTICE '================================================================';
END $$;
