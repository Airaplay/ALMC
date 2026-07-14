/*
  # Fix treat wallet constraint violation on purchases

  1. Problem
    - When processing payments, the trigger sometimes violates the constraint
    - The constraint requires: balance = earned_balance + purchased_balance
    - The trigger may not properly handle newly created wallets

  2. Solution
    - Ensure wallet exists before trigger runs
    - Add defensive checks in trigger
    - Verify calculations satisfy the constraint

  3. Changes
    - Drop and recreate the trigger function with proper constraint handling
*/

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS trigger_update_treat_wallet ON treat_transactions;
DROP FUNCTION IF EXISTS trigger_update_treat_wallet();

-- Recreate the function with proper constraint handling
CREATE OR REPLACE FUNCTION trigger_update_treat_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_current_earned_balance numeric;
  v_current_purchased_balance numeric;
  v_new_earned_balance numeric;
  v_new_purchased_balance numeric;
  v_new_balance numeric;
BEGIN
  -- Ensure wallet exists for this user
  INSERT INTO public.treat_wallets (
    user_id, balance, earned_balance, purchased_balance,
    total_purchased, total_spent, total_earned, total_withdrawn
  )
  VALUES (NEW.user_id, 0, 0, 0, 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Get current wallet state
  SELECT earned_balance, purchased_balance
  INTO v_current_earned_balance, v_current_purchased_balance
  FROM public.treat_wallets
  WHERE user_id = NEW.user_id;

  -- If wallet doesn't exist (shouldn't happen after INSERT above), initialize
  IF NOT FOUND THEN
    v_current_earned_balance := 0;
    v_current_purchased_balance := 0;
  END IF;

  -- Start with current values
  v_new_earned_balance := v_current_earned_balance;
  v_new_purchased_balance := v_current_purchased_balance;

  -- Update earned_balance for earning transactions
  IF NEW.amount > 0 AND NEW.transaction_type IN ('daily_checkin', 'earn', 'referral_bonus', 'tip_received', 'ad_revenue', 'stream_revenue', 'bonus', 'reward') THEN
    v_new_earned_balance := v_new_earned_balance + NEW.amount;
  END IF;

  -- Update purchased_balance for purchase transactions
  IF NEW.amount > 0 AND NEW.transaction_type IN ('purchase', 'deposit') THEN
    v_new_purchased_balance := v_new_purchased_balance + NEW.amount;
  END IF;

  -- Deduct from balances for spending transactions (prioritize purchased_balance first)
  IF NEW.amount < 0 AND NEW.transaction_type IN ('tip_sent', 'promotion_spent', 'spend') THEN
    DECLARE
      v_amount_to_deduct numeric := ABS(NEW.amount);
    BEGIN
      IF v_new_purchased_balance >= v_amount_to_deduct THEN
        -- Deduct fully from purchased balance
        v_new_purchased_balance := v_new_purchased_balance - v_amount_to_deduct;
      ELSIF v_new_purchased_balance > 0 THEN
        -- Deduct partially from purchased, rest from earned
        v_amount_to_deduct := v_amount_to_deduct - v_new_purchased_balance;
        v_new_purchased_balance := 0;
        v_new_earned_balance := v_new_earned_balance - v_amount_to_deduct;
      ELSE
        -- Deduct fully from earned balance
        v_new_earned_balance := v_new_earned_balance - v_amount_to_deduct;
      END IF;
    END;
  END IF;

  -- Calculate the new total balance (MUST equal earned + purchased for constraint)
  v_new_balance := v_new_earned_balance + v_new_purchased_balance;

  -- Verify the constraint will be satisfied
  IF v_new_balance < 0 OR v_new_earned_balance < 0 OR v_new_purchased_balance < 0 THEN
    RAISE EXCEPTION 'Invalid balance calculation: balance=%, earned=%, purchased=%', 
      v_new_balance, v_new_earned_balance, v_new_purchased_balance;
  END IF;

  -- Update the wallet with calculated values
  UPDATE public.treat_wallets
  SET 
    balance = v_new_balance,
    earned_balance = v_new_earned_balance,
    purchased_balance = v_new_purchased_balance,
    total_earned = CASE 
      WHEN NEW.transaction_type IN ('daily_checkin', 'earn', 'referral_bonus', 'tip_received', 'ad_revenue', 'stream_revenue', 'bonus', 'reward')
      THEN total_earned + NEW.amount 
      ELSE total_earned 
    END,
    total_spent = CASE 
      WHEN NEW.transaction_type IN ('tip_sent', 'promotion_spent', 'withdrawal', 'withdraw', 'spend') 
      THEN total_spent + ABS(NEW.amount)
      ELSE total_spent 
    END,
    total_purchased = CASE
      WHEN NEW.transaction_type IN ('purchase', 'deposit')
      THEN total_purchased + NEW.amount
      ELSE total_purchased
    END,
    total_withdrawn = CASE
      WHEN NEW.transaction_type IN ('withdrawal', 'withdraw')
      THEN total_withdrawn + ABS(NEW.amount)
      ELSE total_withdrawn
    END,
    updated_at = now()
  WHERE user_id = NEW.user_id;

  -- Verify the update succeeded
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update wallet for user_id: %', NEW.user_id;
  END IF;

  -- Notify about balance change for real-time updates
  PERFORM pg_notify(
    'treat_balance_changed',
    json_build_object(
      'user_id', NEW.user_id,
      'transaction_id', NEW.id,
      'transaction_type', NEW.transaction_type,
      'amount', NEW.amount,
      'new_balance', v_new_balance
    )::text
  );

  RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER trigger_update_treat_wallet
  AFTER INSERT ON treat_transactions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_treat_wallet();
