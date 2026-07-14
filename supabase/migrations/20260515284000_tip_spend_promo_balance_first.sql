/*
  # Spend promo_balance first on tips / spend / promotion_spent

  Sign-up bonus (and other promo credits) land in treat_wallets.promo_balance via
  add_promo_balance(), while the main balance column stays earned_balance +
  purchased_balance. process_treat_tip_transactions() and trigger_update_treat_wallet()
  previously only considered balance, so users with promo-only funds saw 0 Treats
  in the UI and could not pass tip validation even when promo_balance was positive.

  Changes:
  1) trigger_update_treat_wallet — for spend, promotion_spent, tip_sent: deduct
     from promo_balance first, then apply existing FIFO on purchased/earned for the remainder.
  2) process_treat_tip_transactions — require (balance + promo_balance) >= tip amount
     for the sender; keep spendable snapshots on the sender tip_sent row when
     balance_before / balance_after columns exist.
*/

-- ---------------------------------------------------------------------------
-- 1) Wallet trigger: promo first, then purchased → earned for the remainder
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

COMMENT ON FUNCTION public.trigger_update_treat_wallet() IS
  'Updates treat_wallets on treat_transactions insert. Spending (tip_sent, spend, promotion_spent) deducts promo_balance first, then purchased_balance then earned_balance for the remainder; maintains balance = earned + purchased.';

-- ---------------------------------------------------------------------------
-- 2) Tip processor: sender must have balance + promo_balance >= amount
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
    recipient_current_balance numeric;
    sender_display_name text;
    recipient_display_name text;
BEGIN
    SELECT display_name INTO sender_display_name
    FROM public.users
    WHERE id = NEW.sender_id;

    SELECT display_name INTO recipient_display_name
    FROM public.users
    WHERE id = NEW.recipient_id;

    IF sender_display_name IS NULL THEN
        SELECT email INTO sender_display_name
        FROM public.users
        WHERE id = NEW.sender_id;
    END IF;

    IF recipient_display_name IS NULL THEN
        SELECT email INTO recipient_display_name
        FROM public.users
        WHERE id = NEW.recipient_id;
    END IF;

    INSERT INTO public.treat_wallets (
        user_id,
        balance,
        total_purchased,
        total_spent,
        total_earned,
        total_withdrawn,
        earned_balance,
        purchased_balance
    )
    VALUES (NEW.sender_id, 0, 0, 0, 0, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT balance, COALESCE(promo_balance, 0)
    INTO sender_main_balance, sender_promo_balance
    FROM public.treat_wallets
    WHERE user_id = NEW.sender_id;

    sender_spendable := COALESCE(sender_main_balance, 0) + COALESCE(sender_promo_balance, 0);

    INSERT INTO public.treat_wallets (
        user_id,
        balance,
        total_purchased,
        total_spent,
        total_earned,
        total_withdrawn,
        earned_balance,
        purchased_balance
    )
    VALUES (NEW.recipient_id, 0, 0, 0, 0, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT balance INTO recipient_current_balance
    FROM public.treat_wallets
    WHERE user_id = NEW.recipient_id;

    IF sender_spendable < NEW.amount THEN
        RAISE EXCEPTION 'Insufficient balance. User has % treats available (including bonus) but tried to send %',
            sender_spendable, NEW.amount;
    END IF;

    INSERT INTO public.treat_transactions (
        user_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        description,
        metadata,
        status,
        created_at
    ) VALUES (
        NEW.sender_id,
        'tip_sent',
        NEW.amount,
        sender_spendable,
        sender_spendable - NEW.amount,
        COALESCE(
            'Sent tip to ' || recipient_display_name,
            'Sent tip to user'
        ),
        jsonb_build_object(
            'tip_id', NEW.id,
            'recipient_id', NEW.recipient_id,
            'recipient_name', recipient_display_name,
            'message', NEW.message,
            'content_id', NEW.content_id,
            'content_type', NEW.content_type,
            'tip_created_at', NEW.created_at,
            'spendable_before', sender_spendable,
            'spendable_after', sender_spendable - NEW.amount
        ),
        NEW.status,
        NEW.created_at
    );

    INSERT INTO public.treat_transactions (
        user_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        description,
        metadata,
        status,
        created_at
    ) VALUES (
        NEW.recipient_id,
        'tip_received',
        NEW.amount,
        recipient_current_balance,
        recipient_current_balance + NEW.amount,
        COALESCE(
            'Received tip from ' || sender_display_name,
            'Received tip from user'
        ),
        jsonb_build_object(
            'tip_id', NEW.id,
            'sender_id', NEW.sender_id,
            'sender_name', sender_display_name,
            'message', NEW.message,
            'content_id', NEW.content_id,
            'content_type', NEW.content_type,
            'tip_created_at', NEW.created_at
        ),
        NEW.status,
        NEW.created_at
    );

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error processing treat tip transaction: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.process_treat_tip_transactions() IS
  'Creates tip_sent / tip_received treat_transactions rows. Validates sender (balance + promo_balance) >= tip amount so sign-up promo treats are spendable.';
