/*
  # Fix Promotion Spent Transaction Type in Wallet Trigger

  1. Problem
    - The CHECK constraint allows 'promotion_spent'
    - But the wallet trigger checks for 'promotion_payment'
    - This mismatch causes promotion purchases to fail with constraint violation

  2. Solution
    - Update the wallet trigger to check for 'promotion_spent' instead of 'promotion_payment'
    - Ensure consistency between constraint and trigger logic
*/

-- Drop the existing trigger
DROP TRIGGER IF EXISTS on_treat_transaction_insert ON public.treat_transactions;

-- Recreate the trigger function with correct transaction type
CREATE OR REPLACE FUNCTION public.update_treat_wallet_on_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_record RECORD;
  v_amount_to_deduct DECIMAL(10,2);
  v_deduct_from_purchased DECIMAL(10,2);
  v_deduct_from_earned DECIMAL(10,2);
BEGIN
  -- Get current wallet state
  SELECT * INTO v_wallet_record 
  FROM public.treat_wallets 
  WHERE user_id = NEW.user_id 
  FOR UPDATE;

  -- If wallet doesn't exist, create it
  IF NOT FOUND THEN
    INSERT INTO public.treat_wallets (
      user_id, 
      balance, 
      purchased_balance, 
      earned_balance, 
      total_earned, 
      total_spent
    ) VALUES (
      NEW.user_id, 
      0, 
      0, 
      0, 
      0, 
      0
    );
    
    SELECT * INTO v_wallet_record 
    FROM public.treat_wallets 
    WHERE user_id = NEW.user_id 
    FOR UPDATE;
  END IF;

  -- Handle different transaction types
  -- Standardized: Use 'daily_checkin' (removed 'checkin_reward')
  IF NEW.transaction_type IN ('tip_received', 'ad_revenue', 'stream_revenue', 'daily_checkin', 'referral_bonus', 'bonus', 'reward', 'earn') THEN
    -- EARNING: Add to earned_balance
    UPDATE public.treat_wallets
    SET 
      balance = NEW.balance_after,
      earned_balance = earned_balance + NEW.amount,
      total_earned = total_earned + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('tip_sent', 'promotion_spent', 'spend', 'purchase_treat') THEN
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

    UPDATE public.treat_wallets
    SET 
      balance = NEW.balance_after,
      purchased_balance = purchased_balance - v_deduct_from_purchased,
      earned_balance = earned_balance - v_deduct_from_earned,
      total_spent = total_spent + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('withdrawal') THEN
    -- WITHDRAWAL: Only deduct from earned_balance
    UPDATE public.treat_wallets
    SET 
      balance = NEW.balance_after,
      earned_balance = earned_balance - NEW.amount,
      total_spent = total_spent + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type = 'purchase' THEN
    -- PURCHASE: Add to purchased_balance
    UPDATE public.treat_wallets
    SET 
      balance = NEW.balance_after,
      purchased_balance = purchased_balance + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type = 'promotion_refund' THEN
    -- REFUND: Add back to earned_balance (if earned) or purchased_balance (if purchased)
    -- For simplicity, add to earned_balance by default
    UPDATE public.treat_wallets
    SET 
      balance = NEW.balance_after,
      earned_balance = earned_balance + NEW.amount,
      total_spent = GREATEST(0, total_spent - NEW.amount),
      updated_at = NOW()
    WHERE user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER on_treat_transaction_insert
AFTER INSERT ON public.treat_transactions
FOR EACH ROW
EXECUTE FUNCTION public.update_treat_wallet_on_transaction();
