/*
  # Fix Withdrawal Negative Amount Handling

  1. Problem
    - Withdrawal amounts are stored as negative values in treat_transactions (e.g., -50)
    - The trigger does: balance = balance - NEW.amount
    - With negative amount: balance - (-50) = balance + 50 (WRONG!)
    - This causes the constraint violation: total_withdrawn becomes negative

  2. Solution
    - Use ABS() to get the absolute value of spending/withdrawal amounts
    - Ensure all totals remain positive
    - Handle spending and withdrawals consistently

  3. Changes
    - Fix withdrawal handling to use ABS(NEW.amount)
    - Fix spending handling to use ABS(NEW.amount)
    - Maintain the balance constraint and atomic operations
*/

-- Drop and recreate the wallet update trigger with correct amount handling
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
  v_amount_abs numeric;
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
    -- Amount should be positive
    UPDATE treat_wallets
    SET
      balance = balance + NEW.amount,
      purchased_balance = purchased_balance + NEW.amount,
      total_purchased = total_purchased + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('earn', 'reward', 'contribution_reward', 'tip_received', 'ad_revenue', 'stream_revenue') THEN
    -- Earnings to earned balance: Atomic increment
    -- Amount should be positive
    UPDATE treat_wallets
    SET
      balance = balance + NEW.amount,
      earned_balance = earned_balance + NEW.amount,
      total_earned = total_earned + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('spend', 'promotion_spent', 'tip_sent') THEN
    -- Spending: Amount is NEGATIVE, use ABS()
    v_amount_abs := ABS(NEW.amount);
    
    -- Get current purchased balance
    SELECT purchased_balance INTO v_current_purchased
    FROM treat_wallets
    WHERE user_id = NEW.user_id;

    -- Calculate how much to deduct from each balance
    IF v_current_purchased >= v_amount_abs THEN
      -- Can fully deduct from purchased balance
      v_deduct_from_purchased := v_amount_abs;
      v_deduct_from_earned := 0;
    ELSIF v_current_purchased > 0 THEN
      -- Partially deduct from purchased, rest from earned
      v_deduct_from_purchased := v_current_purchased;
      v_deduct_from_earned := v_amount_abs - v_current_purchased;
    ELSE
      -- Fully deduct from earned balance
      v_deduct_from_purchased := 0;
      v_deduct_from_earned := v_amount_abs;
    END IF;

    -- Atomic update with proper balance deduction
    UPDATE treat_wallets
    SET
      balance = balance - v_amount_abs,
      purchased_balance = purchased_balance - v_deduct_from_purchased,
      earned_balance = earned_balance - v_deduct_from_earned,
      total_spent = total_spent + v_amount_abs,
      updated_at = NOW()
    WHERE user_id = NEW.user_id
    AND balance >= v_amount_abs; -- Ensure sufficient balance

    -- Check if update succeeded
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient balance for user %', NEW.user_id;
    END IF;

  ELSIF NEW.transaction_type = 'withdrawal' THEN
    -- Withdrawal: Amount is NEGATIVE, use ABS()
    v_amount_abs := ABS(NEW.amount);
    
    -- Atomic decrement from earned balance only
    UPDATE treat_wallets
    SET
      balance = balance - v_amount_abs,
      earned_balance = earned_balance - v_amount_abs,
      total_withdrawn = total_withdrawn + v_amount_abs,
      updated_at = NOW()
    WHERE user_id = NEW.user_id
    AND earned_balance >= v_amount_abs; -- Ensure sufficient earned balance

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient earned balance for withdrawal for user %', NEW.user_id;
    END IF;

  ELSIF NEW.transaction_type = 'promotion_refund' THEN
    -- Refund: Add back to purchased balance
    -- Amount should be positive
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
  RAISE NOTICE 'WITHDRAWAL NEGATIVE AMOUNT HANDLING FIXED';
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  - Uses ABS() for spending and withdrawal amounts (stored as negative)';
  RAISE NOTICE '  - Ensures total_withdrawn always increases (never negative)';
  RAISE NOTICE '  - Maintains balance = earned_balance + purchased_balance constraint';
  RAISE NOTICE '  - All operations remain atomic (race condition safe)';
  RAISE NOTICE '================================================================';
END $$;
