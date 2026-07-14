/*
  Offline downloads: admin-configurable monthly Treat pricing.

  - Adds `public.offline_download_pricing` (admins set monthly_cost_treats).
  - Updates:
      - `public.get_offline_download_status()` to read monthly_cost_treats from active pricing
      - `public.subscribe_offline_download_monthly()` to charge the configured price

  This keeps the client unchanged and avoids hard-coding 300 Treats.
*/

-- 1) Pricing table
CREATE TABLE IF NOT EXISTS public.offline_download_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_cost_treats integer NOT NULL DEFAULT 300 CHECK (monthly_cost_treats >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.offline_download_pricing ENABLE ROW LEVEL SECURITY;

-- Everyone can view active pricing
DROP POLICY IF EXISTS "Anyone can view active offline download pricing" ON public.offline_download_pricing;
CREATE POLICY "Anyone can view active offline download pricing"
  ON public.offline_download_pricing
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Admins can manage pricing
DROP POLICY IF EXISTS "Admins can manage offline download pricing" ON public.offline_download_pricing;
CREATE POLICY "Admins can manage offline download pricing"
  ON public.offline_download_pricing
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'manager')
    )
  );

-- Keep updated_at fresh for admin edits
CREATE OR REPLACE FUNCTION public.offline_download_pricing_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offline_download_pricing_updated_at_trigger ON public.offline_download_pricing;
CREATE TRIGGER offline_download_pricing_updated_at_trigger
  BEFORE UPDATE ON public.offline_download_pricing
  FOR EACH ROW
  EXECUTE FUNCTION public.offline_download_pricing_updated_at();

-- Default pricing row
INSERT INTO public.offline_download_pricing (monthly_cost_treats, is_active)
SELECT 300, true
WHERE NOT EXISTS (SELECT 1 FROM public.offline_download_pricing);

-- 2) Status RPC: read active price from table
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
  v_cost integer := 300;
  v_active boolean;
BEGIN
  SELECT p.monthly_cost_treats
  INTO v_cost
  FROM public.offline_download_pricing p
  WHERE p.is_active = true
  ORDER BY p.updated_at DESC
  LIMIT 1;

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
  'Returns offline-download subscription status and admin-configured monthly Treat cost.';

-- 3) Subscribe RPC: charge configured price
CREATE OR REPLACE FUNCTION public.subscribe_offline_download_monthly()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cost integer := 300;
  v_balance_before numeric;
  v_balance_after numeric;
  v_expires timestamptz;
  v_new_expires timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Read configured cost at time of purchase.
  SELECT p.monthly_cost_treats
  INTO v_cost
  FROM public.offline_download_pricing p
  WHERE p.is_active = true
  ORDER BY p.updated_at DESC
  LIMIT 1;

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
    (-v_cost)::numeric,
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
  'Charges admin-configured monthly_cost_treats and extends offline-download access by 30 days.';

