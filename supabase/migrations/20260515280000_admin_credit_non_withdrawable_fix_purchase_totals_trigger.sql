/*
  # Admin treat credits non-withdrawable + correct purchase vs earn in wallet trigger

  ## Issues
  1. `admin_add_treats_to_user` inserted `transaction_type = 'earn'`, which increases
     `earned_balance`. Treat withdrawals (`process_treat_withdrawal`) cap on
     `earned_balance`, so admin grants became withdrawable incorrectly.
  2. `trigger_update_treat_wallet()` treated `daily_checkin` and `referral_bonus`
     like purchases (incrementing `total_purchased`). Those are earned activity,
     not money purchases — this inflated the "Purchased" total.
  3. `recalculate_treat_wallet_balances` is updated to count `admin_credit` toward
     balance without inflating `total_purchased`, and to include common earn types.
*/

-- ---------------------------------------------------------------------------
-- 1) Allow new transaction type: admin_credit
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'treat_transactions_transaction_type_check'
      AND conrelid = 'public.treat_transactions'::regclass
  ) THEN
    ALTER TABLE public.treat_transactions
      DROP CONSTRAINT treat_transactions_transaction_type_check;
  END IF;

  ALTER TABLE public.treat_transactions
    ADD CONSTRAINT treat_transactions_transaction_type_check
    CHECK (transaction_type IN (
      'purchase',
      'spend',
      'earn',
      'withdraw',
      'withdrawal',
      'tip_sent',
      'tip_received',
      'daily_checkin',
      'referral_bonus',
      'promotion_refund',
      'ad_revenue',
      'stream_revenue',
      'promotion_spent',
      'contribution_reward',
      'external_revenue_reward',
      'signup_bonus',
      'admin_credit'
    ));
END $$;

COMMENT ON CONSTRAINT treat_transactions_transaction_type_check
  ON public.treat_transactions IS
  'Includes admin_credit: admin grants spendable treats via purchased_balance without increasing total_purchased or earned_balance (non-withdrawable).';

-- ---------------------------------------------------------------------------
-- 2) Wallet trigger: only real purchases increase total_purchased; admin_credit
--    increases balance + purchased_balance only (like promo top-up, not withdrawable).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_update_treat_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet_exists boolean;
  v_current_purchased numeric;
  v_deduct_from_purchased numeric;
  v_deduct_from_earned numeric;
  v_amount_abs numeric;
BEGIN
  SELECT EXISTS(SELECT 1 FROM treat_wallets WHERE user_id = NEW.user_id) INTO v_wallet_exists;
  IF NOT v_wallet_exists THEN
    INSERT INTO treat_wallets (
      user_id, balance, purchased_balance, earned_balance,
      total_purchased, total_spent, total_earned, total_withdrawn
    ) VALUES (NEW.user_id, 0, 0, 0, 0, 0, 0, 0);
  END IF;

  IF NEW.transaction_type = 'purchase' THEN
    UPDATE treat_wallets
    SET balance = balance + NEW.amount,
        purchased_balance = purchased_balance + NEW.amount,
        total_purchased = total_purchased + NEW.amount,
        updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type = 'admin_credit' THEN
    UPDATE treat_wallets
    SET balance = balance + NEW.amount,
        purchased_balance = purchased_balance + NEW.amount,
        updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN (
    'earn', 'reward', 'contribution_reward', 'tip_received', 'ad_revenue',
    'stream_revenue', 'daily_checkin', 'referral_bonus'
  ) THEN
    UPDATE treat_wallets
    SET balance = balance + NEW.amount,
        earned_balance = earned_balance + NEW.amount,
        total_earned = total_earned + NEW.amount,
        updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('spend', 'promotion_spent', 'tip_sent') THEN
    v_amount_abs := ABS(NEW.amount);
    SELECT purchased_balance INTO v_current_purchased FROM treat_wallets WHERE user_id = NEW.user_id;
    IF v_current_purchased >= v_amount_abs THEN
      v_deduct_from_purchased := v_amount_abs;
      v_deduct_from_earned := 0;
    ELSIF v_current_purchased > 0 THEN
      v_deduct_from_purchased := v_current_purchased;
      v_deduct_from_earned := v_amount_abs - v_current_purchased;
    ELSE
      v_deduct_from_purchased := 0;
      v_deduct_from_earned := v_amount_abs;
    END IF;
    UPDATE treat_wallets
    SET balance = balance - v_amount_abs,
        purchased_balance = purchased_balance - v_deduct_from_purchased,
        earned_balance = earned_balance - v_deduct_from_earned,
        total_spent = total_spent + v_amount_abs,
        updated_at = NOW()
    WHERE user_id = NEW.user_id AND balance >= v_amount_abs;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient balance for user %', NEW.user_id;
    END IF;

  ELSIF NEW.transaction_type = 'withdrawal' THEN
    v_amount_abs := ABS(NEW.amount);
    UPDATE treat_wallets
    SET balance = balance - v_amount_abs,
        earned_balance = earned_balance - v_amount_abs,
        total_withdrawn = total_withdrawn + v_amount_abs,
        updated_at = NOW()
    WHERE user_id = NEW.user_id AND earned_balance >= v_amount_abs;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient earned balance for withdrawal for user %', NEW.user_id;
    END IF;

  ELSIF NEW.transaction_type = 'promotion_refund' THEN
    UPDATE treat_wallets
    SET balance = balance + NEW.amount,
        purchased_balance = purchased_balance + NEW.amount,
        total_spent = GREATEST(0, total_spent - NEW.amount),
        updated_at = NOW()
    WHERE user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Admin RPC: use admin_credit (non-withdrawable) instead of earn
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_add_treats_to_user(
  target_user_id UUID,
  treat_amount NUMERIC,
  admin_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_role TEXT;
  current_admin_id UUID;
  target_user_exists BOOLEAN;
  current_balance NUMERIC;
  new_balance NUMERIC;
BEGIN
  SELECT u.role, u.id INTO current_user_role, current_admin_id
  FROM users u
  WHERE u.id = auth.uid();

  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  IF treat_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Treat amount must be greater than 0'
    );
  END IF;

  IF admin_reason IS NULL OR trim(admin_reason) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reason is required for this action'
    );
  END IF;

  SELECT EXISTS(SELECT 1 FROM users WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Target user not found'
    );
  END IF;

  SELECT COALESCE(balance, 0) INTO current_balance
  FROM treat_wallets
  WHERE user_id = target_user_id;

  new_balance := current_balance + treat_amount;

  INSERT INTO treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    metadata,
    status
  ) VALUES (
    target_user_id,
    'admin_credit',
    treat_amount,
    current_balance,
    new_balance,
    'Admin added treats: ' || admin_reason,
    jsonb_build_object(
      'admin_action', true,
      'admin_id', current_admin_id,
      'reason', admin_reason
    ),
    'completed'
  );

  INSERT INTO admin_activity_logs (
    admin_id,
    action_type,
    details
  ) VALUES (
    current_admin_id,
    'add_treats',
    jsonb_build_object(
      'target_user_id', target_user_id,
      'amount', treat_amount,
      'reason', admin_reason,
      'previous_balance', current_balance,
      'new_balance', new_balance,
      'transaction_type', 'admin_credit'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Treats added successfully',
    'previous_balance', current_balance,
    'new_balance', new_balance
  );
END;
$$;

COMMENT ON FUNCTION public.admin_add_treats_to_user(uuid, numeric, text) IS
  'Adds spendable treats as admin_credit (purchased_balance, not earned_balance). Not withdrawable. Logs admin_activity_logs.';

-- ---------------------------------------------------------------------------
-- 4) Recalculate helper: admin_credit affects balance but not total_purchased
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_treat_wallet_balances(
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
  v_calculated_admin_credit numeric;
  v_calculated_spent numeric;
  v_calculated_withdrawn numeric;
  v_calculated_balance numeric;
  v_fixed_count integer := 0;
  v_error_count integer := 0;
BEGIN
  FOR v_wallet_record IN
    SELECT user_id
    FROM treat_wallets
    WHERE (p_user_id IS NULL OR user_id = p_user_id)
  LOOP
    BEGIN
      SELECT COALESCE(SUM(ABS(amount)), 0)
      INTO v_calculated_earned
      FROM treat_transactions
      WHERE user_id = v_wallet_record.user_id
        AND status = 'completed'
        AND transaction_type IN (
          'earn', 'daily_checkin', 'referral_bonus',
          'tip_received', 'bonus', 'reward', 'promotion_refund',
          'contribution_reward', 'ad_revenue', 'stream_revenue'
        );

      SELECT COALESCE(SUM(ABS(amount)), 0)
      INTO v_calculated_purchased
      FROM treat_transactions
      WHERE user_id = v_wallet_record.user_id
        AND status = 'completed'
        AND transaction_type IN ('purchase', 'deposit');

      SELECT COALESCE(SUM(ABS(amount)), 0)
      INTO v_calculated_admin_credit
      FROM treat_transactions
      WHERE user_id = v_wallet_record.user_id
        AND status = 'completed'
        AND transaction_type = 'admin_credit';

      SELECT COALESCE(SUM(ABS(amount)), 0)
      INTO v_calculated_spent
      FROM treat_transactions
      WHERE user_id = v_wallet_record.user_id
        AND status = 'completed'
        AND (
          (amount < 0 AND transaction_type NOT IN ('withdrawal', 'withdraw'))
          OR
          (amount > 0 AND transaction_type IN (
            'spend', 'tip_sent', 'promotion_payment', 'purchase_treat'
          ))
        );

      SELECT COALESCE(SUM(ABS(amount)), 0)
      INTO v_calculated_withdrawn
      FROM treat_transactions
      WHERE user_id = v_wallet_record.user_id
        AND status = 'completed'
        AND transaction_type IN ('withdrawal', 'withdraw');

      v_calculated_balance := v_calculated_earned + v_calculated_purchased
        + v_calculated_admin_credit - v_calculated_spent - v_calculated_withdrawn;

      IF v_calculated_balance < 0 THEN
        RAISE WARNING 'User % has negative calculated balance: %. Setting to 0.', v_wallet_record.user_id, v_calculated_balance;
        v_calculated_balance := 0;
      END IF;

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

GRANT EXECUTE ON FUNCTION public.recalculate_treat_wallet_balances(uuid) TO service_role;

COMMENT ON FUNCTION public.recalculate_treat_wallet_balances(uuid) IS
  'Recalculates aggregate wallet fields from treat_transactions. Counts admin_credit toward balance but not total_purchased.';
