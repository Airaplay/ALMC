/*
  # Fix Treat Tip Wallet Balance Updates for New Columns

  ## Problem
  The `trigger_update_treat_wallet()` function updates only the `balance` column,
  but the database now has a constraint requiring:
  `balance = earned_balance + purchased_balance`
  
  When tips are sent/received, the trigger violates this constraint because
  it doesn't update `earned_balance` and `purchased_balance`.

  ## Solution
  Update the `trigger_update_treat_wallet()` function to:
  1. Update `earned_balance` for tip_received transactions
  2. Deduct from `earned_balance` or `purchased_balance` for tip_sent (prioritize purchased first)
  3. Maintain the constraint: balance = earned_balance + purchased_balance
  4. Keep all existing functionality for total_spent and total_earned tracking

  ## Changes
  - Rewrite `trigger_update_treat_wallet()` to handle earned_balance and purchased_balance
  - For spending (tips sent), prioritize deducting from purchased_balance first, then earned_balance
*/

CREATE OR REPLACE FUNCTION public.trigger_update_treat_wallet()
RETURNS TRIGGER AS $$
DECLARE
  v_wallet_record RECORD;
  v_amount_to_deduct numeric;
  v_deduct_from_purchased numeric;
  v_deduct_from_earned numeric;
BEGIN
  -- Get current wallet state
  SELECT 
    balance, 
    earned_balance, 
    purchased_balance,
    total_spent,
    total_earned
  INTO v_wallet_record
  FROM public.treat_wallets
  WHERE user_id = NEW.user_id
  FOR UPDATE;

  -- Verify wallet exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found for user_id: %', NEW.user_id;
  END IF;

  -- Handle different transaction types
  IF NEW.transaction_type IN ('tip_received', 'ad_revenue', 'stream_revenue', 'checkin_reward', 'referral_bonus', 'daily_checkin', 'bonus', 'reward', 'earn') THEN
    -- EARNING: Add to earned_balance
    UPDATE public.treat_wallets
    SET 
      balance = v_wallet_record.balance + NEW.amount,
      earned_balance = v_wallet_record.earned_balance + NEW.amount,
      total_earned = v_wallet_record.total_earned + NEW.amount,
      updated_at = now()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('tip_sent', 'promotion_payment', 'spend', 'purchase_treat') THEN
    -- SPENDING: Deduct from purchased_balance first, then earned_balance
    v_amount_to_deduct := NEW.amount;
    
    -- Calculate how much to deduct from each balance
    IF v_wallet_record.purchased_balance >= v_amount_to_deduct THEN
      -- Can fully deduct from purchased balance
      v_deduct_from_purchased := v_amount_to_deduct;
      v_deduct_from_earned := 0;
    ELSIF v_wallet_record.purchased_balance > 0 THEN
      -- Partially deduct from purchased, rest from earned
      v_deduct_from_purchased := v_wallet_record.purchased_balance;
      v_deduct_from_earned := v_amount_to_deduct - v_wallet_record.purchased_balance;
    ELSE
      -- Fully deduct from earned balance
      v_deduct_from_purchased := 0;
      v_deduct_from_earned := v_amount_to_deduct;
    END IF;

    -- Validate sufficient balance
    IF (v_wallet_record.earned_balance + v_wallet_record.purchased_balance) < v_amount_to_deduct THEN
      RAISE EXCEPTION 'Insufficient balance. User has % treats but tried to spend %', 
        (v_wallet_record.earned_balance + v_wallet_record.purchased_balance), v_amount_to_deduct;
    END IF;

    -- Update wallet
    UPDATE public.treat_wallets
    SET 
      balance = v_wallet_record.balance - v_amount_to_deduct,
      earned_balance = v_wallet_record.earned_balance - v_deduct_from_earned,
      purchased_balance = v_wallet_record.purchased_balance - v_deduct_from_purchased,
      total_spent = v_wallet_record.total_spent + v_amount_to_deduct,
      updated_at = now()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('purchase', 'deposit') THEN
    -- PURCHASING: Add to purchased_balance
    UPDATE public.treat_wallets
    SET 
      balance = v_wallet_record.balance + NEW.amount,
      purchased_balance = v_wallet_record.purchased_balance + NEW.amount,
      total_purchased = total_purchased + NEW.amount,
      updated_at = now()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('withdrawal', 'withdraw') THEN
    -- WITHDRAWAL: Already handled by process_treat_withdrawal function
    -- Just update total_withdrawn if needed
    UPDATE public.treat_wallets
    SET 
      total_withdrawn = total_withdrawn + NEW.amount,
      updated_at = now()
    WHERE user_id = NEW.user_id;

  ELSE
    -- Unknown transaction type - just update balance (legacy support)
    UPDATE public.treat_wallets
    SET 
      balance = NEW.balance_after,
      updated_at = now()
    WHERE user_id = NEW.user_id;
  END IF;

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
'Updates treat_wallets balance, earned_balance, purchased_balance and totals when a treat_transaction is inserted. Maintains the constraint: balance = earned_balance + purchased_balance. For spending, prioritizes deducting from purchased_balance first.';
