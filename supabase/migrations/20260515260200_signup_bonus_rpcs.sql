/*
  # Sign-up Treat Bonus — RPCs

  Provides:
    - claim_signup_bonus()                — user-facing, idempotent, awards
                                            non-withdrawable promo treats.
    - admin_get_signup_bonus_stats()      — admin KPI snapshot.
    - admin_get_signup_bonus_recent_claims(limit, offset)
                                          — admin paginated list of recent
                                            grants.

  Safety properties:
    - claim_signup_bonus() is SECURITY DEFINER. It checks the singleton
      settings (is_enabled, end_at, max_total_users), eligibility
      (created_at >= min_signup_date, optional email-verified), and then
      INSERTs into signup_bonus_claims using ON CONFLICT (user_id) DO NOTHING.
      If 0 rows were inserted, the user already claimed and the function
      exits without crediting anything. This means repeat calls are no-ops.
    - Wallet credit uses add_promo_balance() which writes only to
      promo_balance / promo_lifetime_earned. It NEVER touches earned_balance,
      so the bonus is structurally non-withdrawable.
    - A treat_transactions row is logged with transaction_type='signup_bonus'.
      The wallet trigger (trigger_update_treat_wallet) does NOT match this
      type, so the wallet is not double-credited.
    - An accounting journal entry is posted per claim (5100 debit / 2400
      credit) for traceability in the Trial Balance.
*/


-- ============================================================================
-- 1) claim_signup_bonus()
--    Returns jsonb { ok: bool, status: text, ... }
-- ============================================================================

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
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_authenticated');
  END IF;

  -- 1. Load settings (singleton). Lock row to serialise counter updates.
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

  -- 2. Eligibility checks against auth.users.
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

  -- 3. Current treat->USD rate (live, captured at award time).
  SELECT COALESCE(treat_to_usd_rate, 0)
  INTO v_treat_rate
  FROM public.treat_withdrawal_settings
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  v_treat_rate := COALESCE(v_treat_rate, 0);
  v_usd_cost := ROUND(v_settings.bonus_amount_treats::numeric * v_treat_rate, 6);

  -- Lightweight signature so admins can tell which "campaign params" granted a claim.
  -- Not security-sensitive; plain concatenation is sufficient.
  v_campaign_signature :=
    v_settings.bonus_amount_treats::text || '|' ||
    to_char(v_settings.min_signup_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  -- 4. Idempotent insert into the claims ledger.
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
    -- User has already claimed at some point. No-op. Safe to call repeatedly.
    RETURN jsonb_build_object('ok', true, 'status', 'already_claimed');
  END IF;

  -- 5. Credit the user's NON-withdrawable promo_balance.
  --    add_promo_balance() writes directly to promo_balance / promo_lifetime_earned
  --    and never touches earned_balance, so this is structurally non-withdrawable.
  PERFORM public.add_promo_balance(
    v_user_id,
    v_settings.bonus_amount_treats,
    'Sign-up bonus'
  );

  -- 6. Log a treat_transactions row for the Treat Manager Overview / Transactions tab.
  --    transaction_type='signup_bonus' is intentionally NOT matched by
  --    trigger_update_treat_wallet(), so this insert will not adjust the wallet
  --    (no double-credit). The metadata.bonus_treats key is the same key the
  --    existing Overview tab already aggregates as "promotional spending bonuses".
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

  -- 7. Post an accounting journal entry (best-effort, never breaks the grant).
  IF v_usd_cost > 0 THEN
    BEGIN
      SELECT id INTO v_expense_acct
      FROM public.accounting_accounts WHERE code = '5100' AND is_active = true;

      SELECT id INTO v_liab_acct
      FROM public.accounting_accounts WHERE code = '2400' AND is_active = true;

      IF v_expense_acct IS NOT NULL AND v_liab_acct IS NOT NULL THEN
        INSERT INTO public.accounting_journal_entries
          (entry_date, source_type, source_id, memo, posted_by)
        VALUES
          (CURRENT_DATE,
           'signup_bonus_claim',
           v_user_id::text,
           'Treat sign-up bonus credited to new user (non-withdrawable promo).',
           v_user_id)
        RETURNING id INTO v_entry_id;

        -- Debit expense
        INSERT INTO public.accounting_journal_lines
          (entry_id, account_id, debit_usd, credit_usd, user_id)
        VALUES
          (v_entry_id, v_expense_acct, v_usd_cost, 0, v_user_id);

        -- Credit liability (UnredeemedPromoCredits)
        INSERT INTO public.accounting_journal_lines
          (entry_id, account_id, debit_usd, credit_usd, user_id)
        VALUES
          (v_entry_id, v_liab_acct, 0, v_usd_cost, v_user_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Accounting must never block the user grant; the claim row is the
      -- canonical record of cost. Swallow and continue.
      NULL;
    END;
  END IF;

  -- 8. Bump running totals on the singleton settings row.
  UPDATE public.signup_bonus_settings
  SET
    total_users_awarded = total_users_awarded + 1,
    total_treats_awarded = total_treats_awarded + v_settings.bonus_amount_treats
  WHERE singleton_key = true;

  -- 9. Best-effort welcome notification (does not block the grant).
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, metadata, is_read)
    VALUES (
      v_user_id,
      'system',
      'Welcome bonus credited!',
      format('You received %s free Treats as a sign-up bonus. Enjoy!', v_settings.bonus_amount_treats),
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_signup_bonus() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_signup_bonus() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.claim_signup_bonus() IS
  'Idempotent user-facing RPC. Credits the configured Treat sign-up bonus to the caller as NON-withdrawable promo_balance. Safe to call repeatedly: signup_bonus_claims PK on user_id prevents replays. Returns { ok, status, ... }.';


-- ============================================================================
-- 2) admin_get_signup_bonus_stats()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_signup_bonus_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_settings public.signup_bonus_settings%ROWTYPE;
  v_treat_rate numeric;
  v_users_awarded integer;
  v_treats_awarded bigint;
  v_usd_cost numeric;
  v_users_awarded_today integer;
  v_users_awarded_this_month integer;
  v_promo_outstanding bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role IN ('admin', 'account')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  SELECT * INTO v_settings
  FROM public.signup_bonus_settings
  WHERE singleton_key = true
  LIMIT 1;

  SELECT COALESCE(treat_to_usd_rate, 0)
  INTO v_treat_rate
  FROM public.treat_withdrawal_settings
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;
  v_treat_rate := COALESCE(v_treat_rate, 0);

  SELECT
    COUNT(*),
    COALESCE(SUM(treats_awarded), 0),
    COALESCE(SUM(usd_cost_at_award), 0)
  INTO v_users_awarded, v_treats_awarded, v_usd_cost
  FROM public.signup_bonus_claims;

  SELECT COUNT(*) INTO v_users_awarded_today
  FROM public.signup_bonus_claims
  WHERE claimed_at >= date_trunc('day', now());

  SELECT COUNT(*) INTO v_users_awarded_this_month
  FROM public.signup_bonus_claims
  WHERE claimed_at >= date_trunc('month', now());

  -- Outstanding promo treats still held by users who received a sign-up bonus.
  -- (Approximation of remaining liability for the bonus campaign.)
  SELECT COALESCE(SUM(tw.promo_balance), 0)
  INTO v_promo_outstanding
  FROM public.treat_wallets tw
  INNER JOIN public.signup_bonus_claims c ON c.user_id = tw.user_id;

  RETURN jsonb_build_object(
    'settings', jsonb_build_object(
      'is_enabled', COALESCE(v_settings.is_enabled, false),
      'bonus_amount_treats', COALESCE(v_settings.bonus_amount_treats, 0),
      'min_signup_date', v_settings.min_signup_date,
      'end_at', v_settings.end_at,
      'max_total_users', v_settings.max_total_users,
      'require_email_verified', COALESCE(v_settings.require_email_verified, false),
      'total_users_awarded', COALESCE(v_settings.total_users_awarded, 0),
      'total_treats_awarded', COALESCE(v_settings.total_treats_awarded, 0),
      'updated_at', v_settings.updated_at,
      'updated_by', v_settings.updated_by
    ),
    'stats', jsonb_build_object(
      'users_awarded', v_users_awarded,
      'users_awarded_today', v_users_awarded_today,
      'users_awarded_this_month', v_users_awarded_this_month,
      'total_treats_given', v_treats_awarded,
      'total_usd_cost', v_usd_cost,
      'current_treat_to_usd_rate', v_treat_rate,
      'projected_usd_cost_per_new_user', ROUND(COALESCE(v_settings.bonus_amount_treats, 0)::numeric * v_treat_rate, 6),
      'remaining_budget_users', CASE
        WHEN v_settings.max_total_users IS NULL THEN NULL
        ELSE GREATEST(0, v_settings.max_total_users - COALESCE(v_settings.total_users_awarded, 0))
      END,
      'promo_outstanding_treats', v_promo_outstanding,
      'promo_outstanding_usd', ROUND(v_promo_outstanding::numeric * v_treat_rate, 6)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_signup_bonus_stats() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_signup_bonus_stats() FROM PUBLIC, anon;


-- ============================================================================
-- 3) admin_get_signup_bonus_recent_claims(limit, offset)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_signup_bonus_recent_claims(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  email text,
  treats_awarded integer,
  usd_cost_at_award numeric,
  treat_to_usd_rate_at_award numeric,
  claimed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role IN ('admin', 'account')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  RETURN QUERY
  SELECT
    c.user_id,
    u.display_name,
    u.email,
    c.treats_awarded,
    c.usd_cost_at_award,
    c.treat_to_usd_rate_at_award,
    c.claimed_at
  FROM public.signup_bonus_claims c
  LEFT JOIN public.users u ON u.id = c.user_id
  ORDER BY c.claimed_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 200))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_signup_bonus_recent_claims(integer, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_signup_bonus_recent_claims(integer, integer) FROM PUBLIC, anon;


-- ============================================================================
-- 4) admin_update_signup_bonus_settings(...)
--    Convenience upsert RPC so the admin tab doesn't have to think about the
--    singleton_key column. Uses the existing RLS admin policy.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_signup_bonus_settings(
  p_is_enabled boolean,
  p_bonus_amount_treats integer,
  p_min_signup_date timestamptz,
  p_end_at timestamptz,
  p_max_total_users integer,
  p_require_email_verified boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  IF p_bonus_amount_treats IS NULL OR p_bonus_amount_treats < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bonus_amount_treats must be >= 0');
  END IF;

  IF p_max_total_users IS NOT NULL AND p_max_total_users < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max_total_users must be >= 0 or null');
  END IF;

  UPDATE public.signup_bonus_settings
  SET
    is_enabled = COALESCE(p_is_enabled, is_enabled),
    bonus_amount_treats = p_bonus_amount_treats,
    min_signup_date = COALESCE(p_min_signup_date, min_signup_date),
    end_at = p_end_at,
    max_total_users = p_max_total_users,
    require_email_verified = COALESCE(p_require_email_verified, require_email_verified),
    updated_by = auth.uid()
  WHERE singleton_key = true;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_signup_bonus_settings(boolean, integer, timestamptz, timestamptz, integer, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_signup_bonus_settings(boolean, integer, timestamptz, timestamptz, integer, boolean) FROM PUBLIC, anon;
