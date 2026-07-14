/*
  # Add Automatic Treat Deduction When Promotions Are Created

  1. Problem
    - When users create promotions, treats are NOT deducted from their wallet
    - Frontend creates the promotion record but doesn't handle wallet deduction
    - Users can boost content without spending treats

  2. Solution
    - Create a trigger on the `promotions` table
    - When a promotion is inserted with status 'pending_approval' or 'active'
    - Automatically deduct treats by creating a transaction with type 'promotion_spent'
    - The existing wallet trigger will then update the wallet balance

  3. Changes
    - New function: `deduct_treats_on_promotion_insert()`
    - New trigger: `trigger_deduct_treats_on_promotion` on promotions table
    - Creates treat_transaction with negative amount
    - Transaction type: 'promotion_spent'
    - Includes promotion_id in metadata for tracking
*/

-- Create function to deduct treats when promotion is created
CREATE OR REPLACE FUNCTION public.deduct_treats_on_promotion_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_balance numeric;
  v_treats_cost numeric;
BEGIN
  -- Only deduct treats for new promotions that are pending_approval or active
  -- Don't deduct for cancelled, rejected, or completed promotions
  IF NEW.status NOT IN ('pending_approval', 'active', 'pending') THEN
    RETURN NEW;
  END IF;

  -- Get the treats cost
  v_treats_cost := NEW.treats_cost;

  -- Validate treats cost
  IF v_treats_cost IS NULL OR v_treats_cost <= 0 THEN
    RAISE EXCEPTION 'Invalid treats cost: %', v_treats_cost;
  END IF;

  -- Check if wallet exists and has sufficient balance
  SELECT balance INTO v_wallet_balance
  FROM public.treat_wallets
  WHERE user_id = NEW.user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found for user_id: %', NEW.user_id;
  END IF;

  IF v_wallet_balance < v_treats_cost THEN
    RAISE EXCEPTION 'Insufficient balance. Required: %, Available: %', v_treats_cost, v_wallet_balance;
  END IF;

  -- Create transaction record with negative amount for spending
  -- The wallet trigger will handle the actual balance deduction
  INSERT INTO public.treat_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    balance_before,
    balance_after,
    status,
    metadata
  ) VALUES (
    NEW.user_id,
    -v_treats_cost,  -- Negative amount for spending
    'promotion_spent',
    'Promotion boost for ' || NEW.target_title,
    v_wallet_balance,
    v_wallet_balance - v_treats_cost,
    'completed',
    jsonb_build_object(
      'promotion_id', NEW.id,
      'promotion_type', NEW.promotion_type,
      'target_id', NEW.target_id,
      'duration_hours', NEW.duration_hours
    )
  );

  RETURN NEW;
END;
$$;

-- Create trigger on promotions table
DROP TRIGGER IF EXISTS trigger_deduct_treats_on_promotion ON public.promotions;

CREATE TRIGGER trigger_deduct_treats_on_promotion
AFTER INSERT ON public.promotions
FOR EACH ROW
EXECUTE FUNCTION public.deduct_treats_on_promotion_insert();

-- Add comment
COMMENT ON FUNCTION public.deduct_treats_on_promotion_insert() IS 
'Automatically deducts treats from wallet when a promotion is created. Creates a treat_transaction with type promotion_spent. The wallet trigger then updates the balance accordingly.';

COMMENT ON TRIGGER trigger_deduct_treats_on_promotion ON public.promotions IS
'Deducts treats from wallet when promotion is created with pending_approval, pending, or active status';
