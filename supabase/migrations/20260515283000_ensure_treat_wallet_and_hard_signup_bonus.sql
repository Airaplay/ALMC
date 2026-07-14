/*
  Treat wallet reliability + atomic sign-up bonus grant

  Problems addressed:
    1) New users don't always have a treat_wallets row until a client path
       (e.g. Treat screen insert) runs; relying on minimal INSERT elsewhere
       is fragile if column defaults evolve.
    2) claim_signup_bonus() could insert signup_bonus_claims before crediting;
       if add_promo_balance failed afterward, users could appear "already
       claimed" without treats.

  Changes:
    - public.ensure_treat_wallet(uuid): idempotent SECURITY DEFINER INSERT of a
      baseline wallet row aligned with trigger / Google Play creation.
    - public.ensure_my_treat_wallet(): calls ensure_treat_wallet(auth.uid()).
      Granted to authenticated.
    - add_promo_balance: ensure wallet row exists, then UPDATE promo columns.
    - claim_signup_bonus: ensure wallet early; reserve claim row then run
      credit side effects inside BEGIN…EXCEPTION — on failure DELETE the
      reservation and return grant_failed.
*/

CREATE OR REPLACE FUNCTION public.ensure_treat_wallet(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.treat_wallets (
    user_id,
    balance,
    purchased_balance,
    earned_balance,
    total_purchased,
    total_spent,
    total_earned,
    total_withdrawn
  )
  VALUES (
    p_user_id,
    0, 0, 0,
    0, 0, 0, 0
  )
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.ensure_treat_wallet(uuid) IS
  'Idempotent INSERT of baseline treat_wallets row (zeros). Does not overwrite existing balances.';

REVOKE EXECUTE ON FUNCTION public.ensure_treat_wallet(uuid) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.ensure_my_treat_wallet()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  PERFORM public.ensure_treat_wallet(v_uid);
END;
$$;

COMMENT ON FUNCTION public.ensure_my_treat_wallet() IS
  'Ensures auth.uid() has a baseline treat row. Granted to authenticated.';

GRANT EXECUTE ON FUNCTION public.ensure_my_treat_wallet() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_my_treat_wallet() FROM PUBLIC, anon;


CREATE OR REPLACE FUNCTION public.add_promo_balance(
  p_user_id uuid,
  p_amount integer,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  PERFORM public.ensure_treat_wallet(p_user_id);

  IF p_amount = 0 THEN
    SELECT promo_balance INTO v_new_balance FROM public.treat_wallets WHERE user_id = p_user_id;
    RETURN jsonb_build_object(
      'success', true,
      'new_promo_balance', COALESCE(v_new_balance, 0),
      'amount_added', 0
    );
  END IF;

  UPDATE public.treat_wallets
  SET
    promo_balance = promo_balance + p_amount,
    promo_lifetime_earned = promo_lifetime_earned + p_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING promo_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wallet_update_failed');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'new_promo_balance', v_new_balance,
    'amount_added', p_amount
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.claim_signup_bonus()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_settings public.signup_bonus_settings%ROWTYPE;
  v_user_created_at timestamptz;
  v_email_confirmed_at timestamptz;
  v_treat_rate numeric;
  v_inserted_count integer;
  v_usd_cost numeric;
  v_campaign_signature text;
  v_entry_id uuid;
  v_expense_acct uuid;
  v_liab_acct uuid;
  v_promo_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_authenticated');
  END IF;

  PERFORM public.ensure_treat_wallet(v_user_id);

  SELECT * INTO v_settings
  FROM public.signup_bonus_settings
  WHERE singleton_key = true
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_configured');
  END IF;

  IF NOT v_settings.is_enabled THEN
    RETURN jsonb_build_object('ok', false, 'status', 'disabled');
  END IF;

  IF v_settings.end_at IS NOT NULL AND now() > v_settings.end_at THEN
    RETURN jsonb_build_object('ok', false, 'status', 'ended');
  END IF;

  IF v_settings.max_total_users IS NOT NULL
     AND v_settings.total_users_awarded >= v_settings.max_total_users THEN
    RETURN jsonb_build_object('ok', false, 'status', 'cap_reached');
  END IF;

  IF v_settings.bonus_amount_treats <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 'zero_amount');
  END IF;

  SELECT created_at, email_confirmed_at
  INTO v_user_created_at, v_email_confirmed_at
  FROM auth.users
  WHERE id = v_user_id
  LIMIT 1;

  IF v_user_created_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'user_not_found');
  END IF;

  IF v_user_created_at < v_settings.min_signup_date THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_eligible_old_account');
  END IF;

  IF v_settings.require_email_verified
     AND v_email_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'email_unverified');
  END IF;

  SELECT COALESCE(treat_to_usd_rate, 0)
  INTO v_treat_rate
  FROM public.treat_withdrawal_settings
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  v_treat_rate := COALESCE(v_treat_rate, 0);
  v_usd_cost := ROUND(v_settings.bonus_amount_treats::numeric * v_treat_rate, 6);

  v_campaign_signature :=
    v_settings.bonus_amount_treats::text || '|' ||
    to_char(v_settings.min_signup_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  INSERT INTO public.signup_bonus_claims (
    user_id,
    treats_awarded,
    usd_cost_at_award,
    treat_to_usd_rate_at_award,
    campaign_signature
  )
  VALUES (
    v_user_id,
    v_settings.bonus_amount_treats,
    v_usd_cost,
    v_treat_rate,
    v_campaign_signature
  )
  ON CONFLICT (user_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  IF v_inserted_count = 0 THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_claimed');
  END IF;

  BEGIN
    PERFORM public.ensure_treat_wallet(v_user_id);

    v_promo_result := public.add_promo_balance(
      v_user_id,
      v_settings.bonus_amount_treats,
      'Sign-up bonus'
    );
    IF COALESCE((v_promo_result->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'add_promo_balance_failed';
    END IF;

    INSERT INTO public.treat_transactions (
      user_id,
      transaction_type,
      amount,
      description,
      status,
      metadata
    )
    VALUES (
      v_user_id,
      'signup_bonus',
      v_settings.bonus_amount_treats,
      'Treat sign-up bonus credited (non-withdrawable promo)',
      'completed',
      jsonb_build_object(
        'signup_bonus', true,
        'bonus_treats', v_settings.bonus_amount_treats,
        'usd_cost_at_award', v_usd_cost,
        'treat_to_usd_rate_at_award', v_treat_rate,
        'campaign_signature', v_campaign_signature
      )
    );

    IF v_usd_cost > 0 THEN
      BEGIN
        SELECT id INTO v_expense_acct
        FROM public.accounting_accounts WHERE code = '5100' AND is_active = true;

        SELECT id INTO v_liab_acct
        FROM public.accounting_accounts WHERE code = '2400' AND is_active = true;

        IF v_expense_acct IS NOT NULL AND v_liab_acct IS NOT NULL THEN
          INSERT INTO public.accounting_journal_entries
            (entry_date, source_type, source_id, memo, posted_by)
          VALUES (
            CURRENT_DATE,
            'signup_bonus_claim',
            v_user_id::text,
            'Treat sign-up bonus credited to new user (non-withdrawable promo).',
            v_user_id
          )
          RETURNING id INTO v_entry_id;

          INSERT INTO public.accounting_journal_lines
            (entry_id, account_id, debit_usd, credit_usd, user_id)
          VALUES (v_entry_id, v_expense_acct, v_usd_cost, 0, v_user_id);

          INSERT INTO public.accounting_journal_lines
            (entry_id, account_id, debit_usd, credit_usd, user_id)
          VALUES (v_entry_id, v_liab_acct, 0, v_usd_cost, v_user_id);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    UPDATE public.signup_bonus_settings
    SET
      total_users_awarded = total_users_awarded + 1,
      total_treats_awarded = total_treats_awarded + v_settings.bonus_amount_treats
    WHERE singleton_key = true;

    BEGIN
      INSERT INTO public.notifications (
        user_id,
        type,
        title,
        message,
        metadata,
        is_read
      )
      VALUES (
        v_user_id,
        'system',
        'Welcome bonus credited!',
        format(
          'You received %s free Treats as a sign-up bonus. Enjoy!',
          v_settings.bonus_amount_treats
        ),
        jsonb_build_object(
          'signup_bonus', true,
          'bonus_treats', v_settings.bonus_amount_treats
        ),
        false
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    RETURN jsonb_build_object(
      'ok', true,
      'status', 'granted',
      'bonus_treats', v_settings.bonus_amount_treats,
      'usd_cost_at_award', v_usd_cost,
      'treat_to_usd_rate_at_award', v_treat_rate
    );

  EXCEPTION WHEN OTHERS THEN
    DELETE FROM public.signup_bonus_claims WHERE user_id = v_user_id;
    RETURN jsonb_build_object('ok', false, 'status', 'grant_failed');
  END;
END;
$$;

COMMENT ON FUNCTION public.claim_signup_bonus() IS
  'Idempotent signup bonus RPC. Reserves signup_bonus_claim row then grants; on failure deletes reservation so user may retry.';

