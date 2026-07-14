/*
  # Fix Treat Wallet Balance Updates

  ## Problem
  The `trigger_update_treat_wallet()` function only sends notifications but does not
  actually update the wallet balances. When tips are sent:
  1. A record is created in `treat_tips` table
  2. The trigger creates transaction records in `treat_transactions` with calculated balances
  3. BUT the `treat_wallets` table is never updated with the new balances
  
  ## Solution
  Update the `trigger_update_treat_wallet()` function to:
  1. Actually update the `treat_wallets.balance` from the transaction's `balance_after`
  2. Update the appropriate total fields (total_spent or total_earned)
  3. Still send notifications for real-time updates

  ## Changes
  - Completely rewrite `trigger_update_treat_wallet()` function to perform actual wallet updates
*/

CREATE OR REPLACE FUNCTION public.trigger_update_treat_wallet()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the wallet balance based on the transaction
  UPDATE public.treat_wallets
  SET 
    balance = NEW.balance_after,
    total_spent = CASE 
      WHEN NEW.transaction_type IN ('tip_sent', 'promotion_spent', 'withdrawal') 
      THEN total_spent + NEW.amount 
      ELSE total_spent 
    END,
    total_earned = CASE 
      WHEN NEW.transaction_type IN ('tip_received', 'ad_revenue', 'stream_revenue', 'checkin_reward') 
      THEN total_earned + NEW.amount 
      ELSE total_earned 
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
'Updates treat_wallets balance and totals when a treat_transaction is inserted. This trigger actually performs the wallet balance update based on the transaction balance_after value.';
