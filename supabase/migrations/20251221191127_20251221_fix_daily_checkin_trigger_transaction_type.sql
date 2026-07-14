/*
  # Fix Daily Checkin Trigger Transaction Type Mismatch

  ## Problem
  The trigger function `trigger_update_treat_wallet()` checks for transaction_type = 'checkin_reward'
  but the `add_treat_balance()` function uses 'daily_checkin' for check-in rewards.
  
  This mismatch causes:
  - `total_earned` is never updated for daily check-ins
  - The constraint `balance = (earned_balance + purchased_balance)` fails
  - Error: "new row for relation treat_wallets violates check constraint treat_wallets_balance_check"

  ## Solution
  Update the trigger to handle the correct transaction types for earning:
  - 'daily_checkin' (used by check-in function)
  - 'earn' (general earning)
  - 'referral_bonus' (referral rewards)
  - 'tip_received' (tips from others)
  - 'ad_revenue' (ad revenue)
  - 'stream_revenue' (stream earnings)

  Also fix the earned_balance and purchased_balance columns:
  - These should be updated when transactions occur
  - earned_balance increases when earning transactions occur
  - purchased_balance increases when purchase transactions occur
*/

CREATE OR REPLACE FUNCTION public.trigger_update_treat_wallet()
RETURNS TRIGGER AS $$
BEGIN
  -- Determine if this is an earning or spending transaction
  -- Earning types: update earned_balance
  -- Purchase types: update purchased_balance
  -- Spending types: deduct from appropriate balance
  
  UPDATE public.treat_wallets
  SET 
    balance = NEW.balance_after,
    earned_balance = CASE 
      WHEN NEW.amount > 0 AND NEW.transaction_type IN ('daily_checkin', 'earn', 'referral_bonus', 'tip_received', 'ad_revenue', 'stream_revenue', 'bonus', 'reward')
      THEN earned_balance + NEW.amount
      ELSE earned_balance
    END,
    purchased_balance = CASE 
      WHEN NEW.amount > 0 AND NEW.transaction_type IN ('purchase', 'deposit')
      THEN purchased_balance + NEW.amount
      ELSE purchased_balance
    END,
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
      'new_balance', NEW.balance_after
    )::text
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.trigger_update_treat_wallet() IS 
'Updates treat_wallets balance and totals when a treat_transaction is inserted. Correctly handles all transaction types including daily_checkin for check-in rewards. Updates earned_balance, purchased_balance, and total fields appropriately.';
