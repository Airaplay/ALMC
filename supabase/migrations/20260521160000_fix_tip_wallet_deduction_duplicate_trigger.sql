/*
  # Fix Treat tips not deducting wallet balance

  Root cause: legacy trigger `on_treat_transaction_insert` still called
  `update_treat_wallet_on_transaction()`, which sets treat_wallets.balance =
  NEW.balance_after. For tip_sent rows, balance_after is *spendable* (balance +
  promo_balance), not the main balance column. That overwrote or fought the
  correct `trigger_update_treat_wallet()` promo-first deduction.

  Fix:
  1) Drop all legacy wallet triggers on treat_transactions
  2) Attach a single trigger_update_treat_wallet (promo-aware)
  3) Re-apply process_treat_tip_transactions (negative tip_sent debits)
*/

-- ---------------------------------------------------------------------------
-- 1) Remove legacy / duplicate wallet triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_treat_transaction_insert ON public.treat_transactions;
DROP TRIGGER IF EXISTS update_treat_wallet_on_transaction ON public.treat_transactions;
DROP TRIGGER IF EXISTS trigger_update_treat_wallet ON public.treat_transactions;

-- ---------------------------------------------------------------------------
-- 2) Canonical wallet updater (promo first, then purchased → earned)
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
  v_balance_main numeric;
  v_promo_balance numeric;
  v_from_promo numeric;
  v_need numeric;
BEGIN
  SELECT EXISTS(SELECT 1 FROM treat_wallets WHERE user_id = NEW.user_id) INTO v_wallet_exists;
  IF NOT v_wallet_exists THEN
    INSERT INTO treat_wallets (
      user_id, balance, purchased_balance, earned_balance,
      total_purchased, total_spent, total_earned, total_withdrawn,
      promo_balance, promo_lifetime_earned, promo_lifetime_spent
    ) VALUES (NEW.user_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
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
    SET balance = balance + ABS(NEW.amount),
        earned_balance = earned_balance + ABS(NEW.amount),
        total_earned = total_earned + ABS(NEW.amount),
        updated_at = NOW()
    WHERE user_id = NEW.user_id;

  ELSIF NEW.transaction_type IN ('spend', 'promotion_spent', 'tip_sent') THEN
    v_amount_abs := ABS(NEW.amount);

    SELECT balance, COALESCE(promo_balance, 0), purchased_balance
    INTO v_balance_main, v_promo_balance, v_current_purchased
    FROM public.treat_wallets
    WHERE user_id = NEW.user_id
    FOR UPDATE;

    IF (v_balance_main + v_promo_balance) < v_amount_abs THEN
      RAISE EXCEPTION 'Insufficient balance for user %', NEW.user_id;
    END IF;

    v_from_promo := LEAST(v_promo_balance, v_amount_abs);
    v_need := v_amount_abs - v_from_promo;

    IF v_current_purchased >= v_need THEN
      v_deduct_from_purchased := v_need;
      v_deduct_from_earned := 0;
    ELSIF v_current_purchased > 0 THEN
      v_deduct_from_purchased := v_current_purchased;
      v_deduct_from_earned := v_need - v_current_purchased;
    ELSE
      v_deduct_from_purchased := 0;
      v_deduct_from_earned := v_need;
    END IF;

    UPDATE public.treat_wallets
    SET
      balance = balance - v_need,
      purchased_balance = purchased_balance - v_deduct_from_purchased,
      earned_balance = earned_balance - v_deduct_from_earned,
      promo_balance = promo_balance - v_from_promo,
      promo_lifetime_spent = COALESCE(promo_lifetime_spent, 0) + v_from_promo,
      total_spent = total_spent + v_amount_abs,
      updated_at = NOW()
    WHERE user_id = NEW.user_id
      AND balance >= v_need
      AND promo_balance >= v_from_promo
      AND earned_balance >= v_deduct_from_earned;

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

CREATE TRIGGER trigger_update_treat_wallet
  AFTER INSERT ON public.treat_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_update_treat_wallet();

COMMENT ON TRIGGER trigger_update_treat_wallet ON public.treat_transactions IS
  'Single wallet updater. Spending deducts promo_balance first. Do not add on_treat_transaction_insert.';

-- ---------------------------------------------------------------------------
-- 3) Tip processor (negative tip_sent → wallet trigger debits sender)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_treat_tip_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    sender_main_balance numeric;
    sender_promo_balance numeric;
    sender_spendable numeric;
    recipient_main_balance numeric;
    recipient_promo_balance numeric;
    recipient_spendable numeric;
    sender_display_name text;
    recipient_display_name text;
    v_tip_amount numeric;
BEGIN
    v_tip_amount := ABS(NEW.amount);

    SELECT display_name INTO sender_display_name
    FROM public.users WHERE id = NEW.sender_id;
    SELECT display_name INTO recipient_display_name
    FROM public.users WHERE id = NEW.recipient_id;

    IF sender_display_name IS NULL THEN
        SELECT email INTO sender_display_name FROM public.users WHERE id = NEW.sender_id;
    END IF;
    IF recipient_display_name IS NULL THEN
        SELECT email INTO recipient_display_name FROM public.users WHERE id = NEW.recipient_id;
    END IF;

    INSERT INTO public.treat_wallets (
        user_id, balance, total_purchased, total_spent, total_earned, total_withdrawn,
        earned_balance, purchased_balance, promo_balance, promo_lifetime_earned, promo_lifetime_spent
    )
    VALUES (NEW.sender_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT balance, COALESCE(promo_balance, 0)
    INTO sender_main_balance, sender_promo_balance
    FROM public.treat_wallets WHERE user_id = NEW.sender_id;

    sender_spendable := COALESCE(sender_main_balance, 0) + COALESCE(sender_promo_balance, 0);

    INSERT INTO public.treat_wallets (
        user_id, balance, total_purchased, total_spent, total_earned, total_withdrawn,
        earned_balance, purchased_balance, promo_balance, promo_lifetime_earned, promo_lifetime_spent
    )
    VALUES (NEW.recipient_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT balance, COALESCE(promo_balance, 0)
    INTO recipient_main_balance, recipient_promo_balance
    FROM public.treat_wallets WHERE user_id = NEW.recipient_id;

    recipient_spendable := COALESCE(recipient_main_balance, 0) + COALESCE(recipient_promo_balance, 0);

    IF sender_spendable < v_tip_amount THEN
        RAISE EXCEPTION 'Insufficient balance. User has % treats available (including bonus) but tried to send %',
            sender_spendable, v_tip_amount;
    END IF;

    INSERT INTO public.treat_transactions (
        user_id, transaction_type, amount, balance_before, balance_after,
        description, metadata, status, created_at
    ) VALUES (
        NEW.sender_id,
        'tip_sent',
        -v_tip_amount,
        sender_spendable,
        sender_spendable - v_tip_amount,
        COALESCE('Sent tip to ' || recipient_display_name, 'Sent tip to user'),
        jsonb_build_object(
            'tip_id', NEW.id,
            'recipient_id', NEW.recipient_id,
            'recipient_name', recipient_display_name,
            'message', NEW.message,
            'content_id', NEW.content_id,
            'content_type', NEW.content_type,
            'tip_created_at', NEW.created_at,
            'spendable_before', sender_spendable,
            'spendable_after', sender_spendable - v_tip_amount
        ),
        COALESCE(NEW.status, 'completed'),
        NEW.created_at
    );

    INSERT INTO public.treat_transactions (
        user_id, transaction_type, amount, balance_before, balance_after,
        description, metadata, status, created_at
    ) VALUES (
        NEW.recipient_id,
        'tip_received',
        v_tip_amount,
        recipient_spendable,
        recipient_spendable + v_tip_amount,
        COALESCE('Received tip from ' || sender_display_name, 'Received tip from user'),
        jsonb_build_object(
            'tip_id', NEW.id,
            'sender_id', NEW.sender_id,
            'sender_name', sender_display_name,
            'message', NEW.message,
            'content_id', NEW.content_id,
            'content_type', NEW.content_type,
            'tip_created_at', NEW.created_at
        ),
        COALESCE(NEW.status, 'completed'),
        NEW.created_at
    );

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error processing treat tip transaction: %', SQLERRM;
END;
$$;

DROP TRIGGER IF EXISTS trg_process_treat_tip_transactions ON public.treat_tips;
CREATE TRIGGER trg_process_treat_tip_transactions
    AFTER INSERT ON public.treat_tips
    FOR EACH ROW
    EXECUTE FUNCTION public.process_treat_tip_transactions();

-- ---------------------------------------------------------------------------
-- 4) Repair wallets corrupted by balance = spendable_after overwrite
-- ---------------------------------------------------------------------------
UPDATE public.treat_wallets
SET
  balance = GREATEST(0, COALESCE(earned_balance, 0) + COALESCE(purchased_balance, 0)),
  updated_at = NOW()
WHERE balance IS DISTINCT FROM (COALESCE(earned_balance, 0) + COALESCE(purchased_balance, 0));
