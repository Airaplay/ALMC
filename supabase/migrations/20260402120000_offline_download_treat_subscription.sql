/*
  Offline downloads: monthly Treat subscription (server-side entitlement).

  - Table stores expiry per user (extend by 30 days on each successful payment).
  - RPCs: status (read) + subscribe (deduct Treats + extend expiry) using treat_transactions type 'spend'.
*/

-- 1) Entitlement table
CREATE TABLE IF NOT EXISTS public.user_offline_download_entitlement (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_offline_download_entitlement_expires
  ON public.user_offline_download_entitlement (expires_at DESC);

ALTER TABLE public.user_offline_download_entitlement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own offline download entitlement" ON public.user_offline_download_entitlement;
CREATE POLICY "Users read own offline download entitlement"
  ON public.user_offline_download_entitlement
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.user_offline_download_entitlement IS
  'Monthly offline-download feature: expires_at is when the subscription lapses.';

-- Monthly cost in Treats (tune here or move to app_config later)
-- 300 Treats ≈ product placeholder; change migration if you adjust pricing.
-- 2) Status RPC (no spend)
CREATE OR REPLACE FUNCTION public.get_offline_download_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_expires timestamptz;
  v_cost constant numeric := 300;
  v_active boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'active', false,
      'expires_at', null,
      'monthly_cost_treats', v_cost,
      'error', 'not_authenticated'
    );
  END IF;

  SELECT e.expires_at
  INTO v_expires
  FROM public.user_offline_download_entitlement e
  WHERE e.user_id = v_uid;

  v_active := v_expires IS NOT NULL AND v_expires > now();

  RETURN jsonb_build_object(
    'active', v_active,
    'expires_at', to_jsonb(v_expires),
    'monthly_cost_treats', v_cost
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_offline_download_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_offline_download_status() TO authenticated;

COMMENT ON FUNCTION public.get_offline_download_status() IS
  'Returns offline-download subscription status and monthly Treat cost.';

-- 3) Subscribe RPC: deduct Treats + extend 30 days
CREATE OR REPLACE FUNCTION public.subscribe_offline_download_monthly()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cost constant numeric := 300;
  v_balance_before numeric;
  v_balance_after numeric;
  v_expires timestamptz;
  v_new_expires timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.treat_wallets w WHERE w.user_id = v_uid) THEN
    INSERT INTO public.treat_wallets (
      user_id, balance, earned_balance, purchased_balance,
      total_purchased, total_spent, total_earned, total_withdrawn
    )
    VALUES (v_uid, 0, 0, 0, 0, 0, 0, 0);
  END IF;

  SELECT COALESCE(w.balance, 0)
  INTO v_balance_before
  FROM public.treat_wallets w
  WHERE w.user_id = v_uid
  FOR UPDATE;

  IF v_balance_before < v_cost THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'insufficient_treats',
      'required', v_cost,
      'balance', v_balance_before
    );
  END IF;

  v_balance_after := v_balance_before - v_cost;

  INSERT INTO public.treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    status,
    metadata
  )
  VALUES (
    v_uid,
    'spend',
    -v_cost,
    v_balance_before,
    v_balance_after,
    'Offline downloads — monthly access (30 days)',
    'completed',
    jsonb_build_object('feature', 'offline_download_monthly', 'days', 30)
  );

  SELECT e.expires_at
  INTO v_expires
  FROM public.user_offline_download_entitlement e
  WHERE e.user_id = v_uid;

  v_new_expires := GREATEST(COALESCE(v_expires, now()), now()) + interval '30 days';

  INSERT INTO public.user_offline_download_entitlement (user_id, expires_at, updated_at)
  VALUES (v_uid, v_new_expires, now())
  ON CONFLICT (user_id) DO UPDATE
  SET expires_at = EXCLUDED.expires_at,
      updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'expires_at', to_jsonb(v_new_expires),
    'monthly_cost_treats', v_cost,
    'balance_after', v_balance_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.subscribe_offline_download_monthly() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscribe_offline_download_monthly() TO authenticated;

COMMENT ON FUNCTION public.subscribe_offline_download_monthly() IS
  'Charges monthly_cost Treats and extends offline-download access by 30 days.';
