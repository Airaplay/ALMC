/*
  # Fix Treat Wallet Trigger to Handle Negative Amounts Correctly

  1. Problem
    - When promotion_spent transactions are created with negative amounts (e.g., -100)
    - The trigger treats the negative amount as if it's positive
    - This causes incorrect balance calculations and violates the constraint:
      balance = earned_balance + purchased_balance
    
    Example:
    - User has balance=100, purchased_balance=100, earned_balance=0
    - Spends 100 treats: add_treat_balance(user_id, -100, 'promotion_spent')
    - NEW.amount = -100
    - Trigger does: purchased_balance = purchased_balance - (-100) = 100 + 100 = 200
    - But balance = NEW.balance_after = 0
    - Constraint violation: 0 ≠ 200 + 0

  2. Solution
    - Use ABS() to get the absolute value of the amount for spending calculations
    - This ensures we always deduct the correct positive amount
*/

-- Drop the existing trigger
DROP TRIGGER IF EXISTS on_treat_transaction_insert ON public.treat_transactions;

-- Recreate the trigger function with correct amount handling
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
  IF NEW.transaction_type IN ('tip_received', 'ad_revenue', 'stream_revenue', 'daily_checkin', 'referral_bonus', 'bonus', 'reward', 'earn') THEN
    -- EARNING: Add to earned_balance
    -- NEW.amount should be positive for these transactions
    UPDATE public.treat_wallets
    SET 
      balance = NEW.balance_after,
      earned_balance = earned_balance + NEW.amount,
      total_earned = total_earned + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('tip_sent', 'promotion_spent', 'spend', 'purchase_treat') THEN
    -- SPENDING: Deduct from purchased_balance first, then earned_balance
    -- NEW.amount is NEGATIVE for spending transactions, so use ABS()
    v_amount_to_deduct := ABS(NEW.amount);
    
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
      total_spent = total_spent + v_amount_to_deduct,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('withdrawal') THEN
    -- WITHDRAWAL: Only deduct from earned_balance
    -- NEW.amount is NEGATIVE for withdrawals, so use ABS()
    v_amount_to_deduct := ABS(NEW.amount);
    
    UPDATE public.treat_wallets
    SET 
      balance = NEW.balance_after,
      earned_balance = earned_balance - v_amount_to_deduct,
      total_spent = total_spent + v_amount_to_deduct,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type = 'purchase' THEN
    -- PURCHASE: Add to purchased_balance
    -- NEW.amount should be positive for purchases
    UPDATE public.treat_wallets
    SET 
      balance = NEW.balance_after,
      purchased_balance = purchased_balance + NEW.amount,
      updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type = 'promotion_refund' THEN
    -- REFUND: Add back to purchased_balance (since it was spent from purchased first)
    -- NEW.amount should be positive for refunds
    UPDATE public.treat_wallets
    SET 
      balance = NEW.balance_after,
      purchased_balance = purchased_balance + NEW.amount,
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

-- Add comment
COMMENT ON FUNCTION public.update_treat_wallet_on_transaction() IS 
'Updates treat_wallets when transactions are inserted. Uses ABS() for spending amounts since they are negative in transactions. Maintains constraint: balance = earned_balance + purchased_balance. Deducts from purchased_balance first, then earned_balance.';
