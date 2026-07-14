/*
  # Treat tips: PIN-gated send RPC + reliable wallet deduction

  1) Security PIN RPCs (idempotent) — first-time setup + verify before spend
  2) send_treat_tip_with_security_pin — only path for authenticated tip sends
  3) tip_sent rows use negative amounts (debit convention) + promo_lifetime_spent
  4) Revoke direct treat_tips INSERT from authenticated (tips must use RPC)
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- users: security PIN columns (if applied only via SQL Editor before)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'security_pin_hash'
  ) THEN
    ALTER TABLE public.users ADD COLUMN security_pin_hash text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'security_pin_failed_attempts'
  ) THEN
    ALTER TABLE public.users
      ADD COLUMN security_pin_failed_attempts integer NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'security_pin_locked_until'
  ) THEN
    ALTER TABLE public.users ADD COLUMN security_pin_locked_until timestamptz;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Internal PIN validation (SECURITY DEFINER — reads security_pin_hash)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_valid_security_pin_format(p_pin text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'Security PIN must be 4–6 digits';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._verify_security_pin_for_user(p_user_id uuid, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hash text;
  v_failed integer;
  v_locked_until timestamptz;
BEGIN
  PERFORM public._assert_valid_security_pin_format(p_pin);

  SELECT security_pin_hash, security_pin_failed_attempts, security_pin_locked_until
  INTO v_hash, v_failed, v_locked_until
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'SECURITY_PIN_NOT_SET';
  END IF;

  IF v_locked_until IS NOT NULL AND v_locked_until > NOW() THEN
    RAISE EXCEPTION 'SECURITY_PIN_LOCKED';
  END IF;

  IF v_hash = crypt(p_pin, v_hash) THEN
    UPDATE public.users
    SET security_pin_failed_attempts = 0,
        security_pin_locked_until = NULL
    WHERE id = p_user_id;
    RETURN;
  END IF;

  v_failed := COALESCE(v_failed, 0) + 1;

  UPDATE public.users
  SET security_pin_failed_attempts = v_failed,
      security_pin_locked_until = CASE
        WHEN v_failed >= 5 THEN NOW() + interval '15 minutes'
        ELSE security_pin_locked_until
      END
  WHERE id = p_user_id;

  RAISE EXCEPTION 'INVALID_SECURITY_PIN';
END;
$$;

-- ---------------------------------------------------------------------------
-- Public PIN RPCs (match src/lib/supabase.ts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_security_pin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hash text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT security_pin_hash INTO v_hash
  FROM public.users
  WHERE id = v_uid;

  RETURN v_hash IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_security_pin(p_pin text, p_confirm text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_pin IS DISTINCT FROM p_confirm THEN
    RETURN jsonb_build_object('success', false, 'error', 'PINs do not match');
  END IF;

  BEGIN
    PERFORM public._assert_valid_security_pin_format(p_pin);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;

  SELECT security_pin_hash INTO v_existing FROM public.users WHERE id = v_uid;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Security PIN already set. Use change PIN instead.');
  END IF;

  UPDATE public.users
  SET security_pin_hash = crypt(p_pin, gen_salt('bf')),
      security_pin_failed_attempts = 0,
      security_pin_locked_until = NULL
  WHERE id = v_uid;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.change_security_pin(
  p_current_pin text,
  p_new_pin text,
  p_confirm text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_new_pin IS DISTINCT FROM p_confirm THEN
    RETURN jsonb_build_object('success', false, 'error', 'New PINs do not match');
  END IF;

  BEGIN
    PERFORM public._verify_security_pin_for_user(v_uid, p_current_pin);
    PERFORM public._assert_valid_security_pin_format(p_new_pin);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;

  UPDATE public.users
  SET security_pin_hash = crypt(p_new_pin, gen_salt('bf')),
      security_pin_failed_attempts = 0,
      security_pin_locked_until = NULL
  WHERE id = v_uid;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_security_pin_for_session(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  BEGIN
    PERFORM public._verify_security_pin_for_user(v_uid, p_pin);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- PIN-gated tip send (authenticated callers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_treat_tip_with_security_pin(
  p_recipient_id uuid,
  p_amount numeric,
  p_message text DEFAULT NULL,
  p_content_id uuid DEFAULT NULL,
  p_content_type text DEFAULT NULL,
  p_security_pin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender_id uuid := auth.uid();
  v_tip_id uuid;
  v_amount numeric;
BEGIN
  IF v_sender_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_recipient_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Recipient is required');
  END IF;

  IF p_recipient_id = v_sender_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot send a tip to yourself');
  END IF;

  v_amount := ABS(COALESCE(p_amount, 0));
  IF v_amount <= 0 OR v_amount > 1000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid tip amount');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_recipient_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Recipient not found');
  END IF;

  IF NOT public.has_security_pin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'SECURITY_PIN_NOT_SET');
  END IF;

  IF p_security_pin IS NULL OR length(trim(p_security_pin)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Security PIN is required');
  END IF;

  BEGIN
    PERFORM public._verify_security_pin_for_user(v_sender_id, trim(p_security_pin));
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;

  INSERT INTO public.treat_tips (
    sender_id,
    recipient_id,
    amount,
    message,
    content_id,
    content_type,
    status
  ) VALUES (
    v_sender_id,
    p_recipient_id,
    v_amount,
    NULLIF(trim(p_message), ''),
    p_content_id,
    NULLIF(trim(p_content_type), ''),
    'completed'
  )
  RETURNING id INTO v_tip_id;

  RETURN jsonb_build_object('success', true, 'id', v_tip_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_security_pin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_security_pin(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_security_pin(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_security_pin_for_session(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_treat_tip_with_security_pin(uuid, numeric, text, uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Wallet trigger: track promo_lifetime_spent on promo spend
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

-- ---------------------------------------------------------------------------
-- Tip processor: tip_sent debits use negative amount (wallet trigger uses ABS)
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
    v_tip_amount numeric;
BEGIN
    v_tip_amount := ABS(NEW.amount);

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
        purchased_balance,
        promo_balance,
        promo_lifetime_earned,
        promo_lifetime_spent
    )
    VALUES (NEW.sender_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
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
        purchased_balance,
        promo_balance,
        promo_lifetime_earned,
        promo_lifetime_spent
    )
    VALUES (NEW.recipient_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT balance INTO recipient_current_balance
    FROM public.treat_wallets
    WHERE user_id = NEW.recipient_id;

    IF sender_spendable < v_tip_amount THEN
        RAISE EXCEPTION 'Insufficient balance. User has % treats available (including bonus) but tried to send %',
            sender_spendable, v_tip_amount;
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
        -v_tip_amount,
        sender_spendable,
        sender_spendable - v_tip_amount,
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
            'spendable_after', sender_spendable - v_tip_amount
        ),
        COALESCE(NEW.status, 'completed'),
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
        v_tip_amount,
        recipient_current_balance,
        recipient_current_balance + v_tip_amount,
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

-- Force tips through PIN-gated RPC (not direct client insert)
DROP POLICY IF EXISTS "Users can insert tips they send" ON public.treat_tips;

COMMENT ON FUNCTION public.send_treat_tip_with_security_pin IS
  'Validates Security PIN, inserts treat_tips (trigger debits wallet via treat_transactions).';
