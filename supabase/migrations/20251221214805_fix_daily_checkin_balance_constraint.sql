/*
  # Fix Daily Check-in Balance Constraint Violation

  ## Problem
  The trigger function `trigger_update_treat_wallet()` sets `balance = NEW.balance_after` directly
  while also updating `earned_balance` and `purchased_balance` separately. This causes the
  constraint `balance = earned_balance + purchased_balance` to fail.

  ## Solution
  Update the trigger to calculate balance from earned_balance + purchased_balance instead of
  using NEW.balance_after. This ensures the constraint is always satisfied.

  ## Changes
  - Remove direct balance assignment from NEW.balance_after
  - Calculate balance as earned_balance + purchased_balance
  - Ensure all transaction types properly update the sub-balances
*/

CREATE OR REPLACE FUNCTION public.trigger_update_treat_wallet()
RETURNS TRIGGER AS $$
DECLARE
  v_new_earned_balance numeric;
  v_new_purchased_balance numeric;
  v_new_balance numeric;
BEGIN
  -- Get current wallet state
  SELECT earned_balance, purchased_balance
  INTO v_new_earned_balance, v_new_purchased_balance
  FROM public.treat_wallets
  WHERE user_id = NEW.user_id;
  
  -- If wallet doesn't exist, initialize values
  IF NOT FOUND THEN
    v_new_earned_balance := 0;
    v_new_purchased_balance := 0;
  END IF;
  
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
  
  -- Calculate the new total balance (this ensures the constraint is satisfied)
  v_new_balance := v_new_earned_balance + v_new_purchased_balance;
  
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
    RAISE EXCEPTION 'Failed to update wallet for user_id: %. Wallet may not exist.', NEW.user_id;
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.trigger_update_treat_wallet() IS 
'Updates treat_wallets balance and totals when a treat_transaction is inserted. Correctly handles all transaction types including daily_checkin. Calculates balance as earned_balance + purchased_balance to satisfy the constraint.';
