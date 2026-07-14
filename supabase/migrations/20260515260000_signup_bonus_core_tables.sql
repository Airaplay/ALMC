/*
  # Sign-up Treat Bonus — Core Tables

  Adds an admin-controlled sign-up bonus that credits new users with a
  configurable amount of NON-WITHDRAWABLE Treats (promotional credits).

  Scope (additive, no destructive edits to existing flows):
    1) Extend treat_transactions.transaction_type CHECK with 'signup_bonus'.
       This new type is NOT matched by trigger_update_treat_wallet(), so it
       cannot accidentally touch balance / earned_balance / purchased_balance.
       Wallet credit is performed by add_promo_balance() (separate column).
    2) signup_bonus_settings  — singleton row (same pattern as
       treat_withdrawal_settings) so the admin can toggle / cap / schedule.
    3) signup_bonus_claims    — one row per user (PK on user_id) so the RPC
       is idempotent and the bonus can never be paid twice.

  Notes:
    - Default row is created DISABLED. Admin must explicitly turn it on.
    - Min/eligibility values are conservative and safe.
    - No existing logic is altered. Existing constraints, withdrawal, payout
      and promo flows continue to behave exactly as before.
*/

-- ============================================================================
-- 1) Extend treat_transactions.transaction_type CHECK (additive)
-- ============================================================================

DO $$
DECLARE
  v_constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'treat_transactions_transaction_type_check'
      AND conrelid = 'public.treat_transactions'::regclass
  ) INTO v_constraint_exists;

  IF v_constraint_exists THEN
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
      'signup_bonus'
    ));
END $$;

COMMENT ON CONSTRAINT treat_transactions_transaction_type_check
  ON public.treat_transactions IS
  'Allowed treat transaction types. Extended with signup_bonus (non-withdrawable promo credit, posted via add_promo_balance) without removing any prior allowed value.';


-- ============================================================================
-- 2) signup_bonus_settings (singleton, admin-controlled)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.signup_bonus_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Master switches
  is_enabled boolean NOT NULL DEFAULT false,
  bonus_amount_treats integer NOT NULL DEFAULT 50 CHECK (bonus_amount_treats >= 0),

  -- Eligibility rules
  min_signup_date timestamptz NOT NULL DEFAULT now(),     -- only users created on/after this time
  end_at timestamptz,                                     -- optional auto-stop (NULL = no end)
  max_total_users integer CHECK (max_total_users IS NULL OR max_total_users >= 0),
  require_email_verified boolean NOT NULL DEFAULT false,

  -- Running totals (incremented by the claim RPC)
  total_users_awarded integer NOT NULL DEFAULT 0 CHECK (total_users_awarded >= 0),
  total_treats_awarded bigint NOT NULL DEFAULT 0 CHECK (total_treats_awarded >= 0),

  -- Singleton enforcement (matches treat_withdrawal_settings pattern)
  singleton_key boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT signup_bonus_settings_singleton_unique UNIQUE (singleton_key)
);

COMMENT ON TABLE public.signup_bonus_settings IS
  'Singleton config for the Treat sign-up bonus. Admin-controlled. New users get bonus_amount_treats added to their non-withdrawable promo_balance when claim_signup_bonus() succeeds.';

-- Seed the singleton row (idempotent). Disabled by default — admin must opt in.
INSERT INTO public.signup_bonus_settings (is_enabled, bonus_amount_treats, min_signup_date)
VALUES (false, 50, now())
ON CONFLICT (singleton_key) DO NOTHING;

ALTER TABLE public.signup_bonus_settings ENABLE ROW LEVEL SECURITY;

-- Readable by any authenticated user (so the client can show "you got a bonus" UI).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='signup_bonus_settings'
      AND policyname='Authenticated read signup bonus settings'
  ) THEN
    CREATE POLICY "Authenticated read signup bonus settings"
    ON public.signup_bonus_settings
    FOR SELECT
    TO authenticated
    USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='signup_bonus_settings'
      AND policyname='Admins manage signup bonus settings'
  ) THEN
    CREATE POLICY "Admins manage signup bonus settings"
    ON public.signup_bonus_settings
    FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;


-- ============================================================================
-- 3) signup_bonus_claims (one row per user — strict idempotency)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.signup_bonus_claims (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  treats_awarded integer NOT NULL CHECK (treats_awarded >= 0),
  usd_cost_at_award numeric(12, 6) NOT NULL DEFAULT 0 CHECK (usd_cost_at_award >= 0),
  treat_to_usd_rate_at_award numeric(18, 8) NOT NULL DEFAULT 0 CHECK (treat_to_usd_rate_at_award >= 0),
  campaign_signature text NOT NULL,
  notes text,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_bonus_claims_claimed_at
  ON public.signup_bonus_claims (claimed_at DESC);

CREATE INDEX IF NOT EXISTS idx_signup_bonus_claims_campaign
  ON public.signup_bonus_claims (campaign_signature);

COMMENT ON TABLE public.signup_bonus_claims IS
  'Idempotent ledger of users who have already received the Treat sign-up bonus. PK on user_id guarantees a user can never receive it twice. usd_cost_at_award is captured at grant time using the live treat_to_usd_rate from treat_withdrawal_settings.';

ALTER TABLE public.signup_bonus_claims ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- A user can view their own claim record (so the client can show "you've already claimed").
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='signup_bonus_claims'
      AND policyname='Users view own signup bonus claim'
  ) THEN
    CREATE POLICY "Users view own signup bonus claim"
    ON public.signup_bonus_claims
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
  END IF;

  -- Admins can view all claims (for the admin dashboard).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='signup_bonus_claims'
      AND policyname='Admins view all signup bonus claims'
  ) THEN
    CREATE POLICY "Admins view all signup bonus claims"
    ON public.signup_bonus_claims
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;

  -- No direct INSERT/UPDATE/DELETE from authenticated. All writes go through
  -- claim_signup_bonus() which is SECURITY DEFINER. This prevents users from
  -- self-granting the bonus.
END $$;


-- ============================================================================
-- 4) updated_at trigger for signup_bonus_settings
-- ============================================================================

CREATE OR REPLACE FUNCTION public.signup_bonus_settings_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signup_bonus_settings_updated_at
  ON public.signup_bonus_settings;

CREATE TRIGGER trg_signup_bonus_settings_updated_at
  BEFORE UPDATE ON public.signup_bonus_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.signup_bonus_settings_set_updated_at();


DO $$
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Sign-up bonus core tables created (disabled by default).';
  RAISE NOTICE '  - signup_bonus_settings (singleton)';
  RAISE NOTICE '  - signup_bonus_claims (PK on user_id, idempotent)';
  RAISE NOTICE '  - treat_transactions.transaction_type CHECK extended';
  RAISE NOTICE '================================================================';
END $$;
