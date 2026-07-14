/*
  # Fix Wallet Recalculation - Handle Positive Spending Amounts

  ## Problem
  The recalculation function only counted spending transactions with negative amounts,
  but in the database, many spending transactions have POSITIVE amounts:
  
  - tip_sent: 33 transactions with positive amounts (should reduce balance)
  - spend: 4 transactions with positive amounts
  - promotion_payment: transactions stored as positive
  
  Result: total_spent shows 0 even though users spent treats

  ## Root Cause
  Historical data inconsistency:
  1. Old code stored spending as positive amounts in transactions table
  2. New add_treat_balance expects negative amounts for spending
  3. Recalculation only looked for negative amounts
  
  ## Solution
  Update recalculation to handle BOTH:
  - Negative amounts (new correct format)
  - Positive amounts with spending transaction types (old format)
*/

CREATE OR REPLACE FUNCTION recalculate_treat_wallet_balances(
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet_record RECORD;
  v_calculated_earned numeric;
  v_calculated_purchased numeric;
  v_calculated_spent numeric;
  v_calculated_withdrawn numeric;
  v_calculated_balance numeric;
  v_fixed_count integer := 0;
  v_error_count integer := 0;
BEGIN
  -- Loop through wallets (either specific user or all users)
  FOR v_wallet_record IN
    SELECT user_id
    FROM treat_wallets
    WHERE (p_user_id IS NULL OR user_id = p_user_id)
  LOOP
    BEGIN
      -- Calculate total earned from earning transaction types
      SELECT COALESCE(SUM(ABS(amount)), 0)
      INTO v_calculated_earned
      FROM treat_transactions
      WHERE user_id = v_wallet_record.user_id
        AND status = 'completed'
        AND transaction_type IN (
          'earn', 'daily_checkin', 'referral_bonus',
          'tip_received', 'bonus', 'reward', 'promotion_refund'
        );

      -- Calculate total purchased
      SELECT COALESCE(SUM(ABS(amount)), 0)
      INTO v_calculated_purchased
      FROM treat_transactions
      WHERE user_id = v_wallet_record.user_id
        AND status = 'completed'
        AND transaction_type IN ('purchase', 'deposit');

      -- Calculate total spent
      -- Handle BOTH negative amounts (correct) AND positive amounts with spending types (legacy)
      SELECT COALESCE(SUM(ABS(amount)), 0)
      INTO v_calculated_spent
      FROM treat_transactions
      WHERE user_id = v_wallet_record.user_id
        AND status = 'completed'
        AND (
          -- New format: negative amounts with any type
          (amount < 0 AND transaction_type NOT IN ('withdrawal', 'withdraw'))
          OR
          -- Old format: positive amounts with spending transaction types
          (amount > 0 AND transaction_type IN (
            'spend', 'tip_sent', 'promotion_payment', 'purchase_treat'
          ))
        );

      -- Calculate total withdrawn
      -- Handle both 'withdrawal' and 'withdraw' transaction types
      SELECT COALESCE(SUM(ABS(amount)), 0)
      INTO v_calculated_withdrawn
      FROM treat_transactions
      WHERE user_id = v_wallet_record.user_id
        AND status = 'completed'
        AND transaction_type IN ('withdrawal', 'withdraw');

      -- Calculate final balance
      v_calculated_balance := v_calculated_earned + v_calculated_purchased - v_calculated_spent - v_calculated_withdrawn;

      -- Ensure balance is not negative
      IF v_calculated_balance < 0 THEN
        RAISE WARNING 'User % has negative calculated balance: %. Setting to 0.', v_wallet_record.user_id, v_calculated_balance;
        v_calculated_balance := 0;
      END IF;

      -- Update the wallet with recalculated values
      UPDATE treat_wallets
      SET
        balance = v_calculated_balance,
        total_earned = v_calculated_earned,
        total_purchased = v_calculated_purchased,
        total_spent = v_calculated_spent,
        total_withdrawn = v_calculated_withdrawn,
        updated_at = now()
      WHERE user_id = v_wallet_record.user_id;

      v_fixed_count := v_fixed_count + 1;

    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      RAISE WARNING 'Error recalculating wallet for user %: %', v_wallet_record.user_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'wallets_fixed', v_fixed_count,
    'errors', v_error_count,
    'message', format('Successfully recalculated %s wallet(s)', v_fixed_count)
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Recalculation failed: %s', SQLERRM)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION recalculate_treat_wallet_balances(uuid) TO service_role;

COMMENT ON FUNCTION recalculate_treat_wallet_balances IS 
'Admin function to recalculate treat wallet balances from transaction history. Handles both positive and negative amounts for spending transactions. Fixes corrupted earned/purchased/spent/withdrawn tracking.';

-- Run the fixed recalculation for all wallets
SELECT recalculate_treat_wallet_balances(NULL);
