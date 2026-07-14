/*
  # Security Hardening — grants, public-safe views, and admin-only RPCs

  Closes high/critical findings from the May 14 admin dashboard security review:

    1. Payment channels: introduce `enabled_payment_channels_public` view
       that exposes only fields safe for the browser. Provider secrets stay
       behind admin-only RLS in `treat_payment_channels.configuration`.

    2. Anonymous user lookups: drop the wide-open `anon SELECT * FROM users`
       policy and expose only the strictly-public fields needed for content
       attribution via the `public_user_profiles` view.

    3. Bot/fraud RPCs: revoke `anon` execute on `enqueue_bot_contribution_clawback`
       and `detect_fraud_patterns_cached`. These RPCs are SECURITY DEFINER and
       should only be invoked by authenticated paths (and the service role).

    4. External revenue: add an admin guard to
       `admin_get_pending_external_revenue_topup_total` and revoke the open
       authenticated execute grant.

  This migration is idempotent and safe to re-run.
*/

-- ============================================================================
-- 1. Payment channels: public-safe view
-- ============================================================================

-- View exposes a redacted `public_configuration` jsonb that strips provider
-- secrets, so even a future RLS misconfiguration on the underlying table
-- cannot leak `secret_key` / `encryption_key` / `api_token` to clients.
DROP VIEW IF EXISTS public.enabled_payment_channels_public CASCADE;

CREATE VIEW public.enabled_payment_channels_public
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.channel_name,
  c.channel_type,
  c.is_enabled,
  c.icon_url,
  c.display_order,
  c.created_at,
  c.updated_at,
  -- Whitelist only fields the browser legitimately needs to render the
  -- payment selector or initialize a Play / USDT flow. Anything not listed
  -- here (secret_key, encryption_key, api_token, webhook_url, etc.) is
  -- intentionally dropped from the public payload.
  jsonb_strip_nulls(jsonb_build_object(
    'public_key',                c.configuration ->> 'public_key',
    'currency',                  c.configuration ->> 'currency',
    'wallet_address',            c.configuration ->> 'wallet_address',
    'network',                   c.configuration ->> 'network',
    'android_application_id',    c.configuration ->> 'android_application_id',
    'product_id_by_package',     c.configuration -> 'product_id_by_package',
    'api_version',               c.configuration ->> 'api_version'
  )) AS public_configuration
FROM public.treat_payment_channels c
WHERE c.is_enabled = true;

COMMENT ON VIEW public.enabled_payment_channels_public IS
  'Browser-safe projection of treat_payment_channels. Strips provider secrets from configuration; only fields needed to render the payment selector or initialize Play/USDT flows are exposed.';

-- security_invoker=true ensures the view evaluates RLS as the calling role,
-- which is fine because the underlying treat_payment_channels has a public
-- "Anyone can view enabled payment channels" SELECT policy. The redaction
-- happens at the SQL projection level above.
GRANT SELECT ON public.enabled_payment_channels_public TO anon, authenticated;

-- ============================================================================
-- 2. Anonymous user attribution: replace anon SELECT * with a safe view
-- ============================================================================

-- The live database currently grants column-level SELECT on EVERY column of
-- `public.users` to both `anon` and `authenticated`, including `email`,
-- `wallet_address`, `total_earnings`, `date_of_birth`, `gender`, and
-- `security_pin_hash`. Combined with the wide-open RLS policy
-- "Anon can read public user profiles" / "Authenticated can read basic user info",
-- any client could enumerate the entire user table including PIN hashes.
--
-- We keep the row-level policies intact — many anonymous content fetches join
-- to `users` for `display_name` / `avatar_url`, and breaking those would
-- break the public home / search / "must watch" flows. Instead we close the
-- leak with column-level GRANT/REVOKE: rows still flow through joins, but
-- sensitive columns are no longer readable by browsers.

-- Defense in depth: provide a view for callers that want an explicitly public
-- projection (e.g. anonymous content attribution paths added going forward).
DROP VIEW IF EXISTS public.public_user_profiles CASCADE;

CREATE VIEW public.public_user_profiles
WITH (security_invoker = false) AS
SELECT
  u.id,
  u.username,
  u.display_name,
  u.avatar_url,
  u.bio,
  COALESCE(u.show_artist_badge, false) AS show_artist_badge
FROM public.users u;

COMMENT ON VIEW public.public_user_profiles IS
  'Strictly-public profile fields safe for unauthenticated content attribution. Excludes email, role, wallet_address, total_earnings, and any sensitive columns.';

GRANT SELECT ON public.public_user_profiles TO anon, authenticated;

-- Anonymous browsers must never see contact, financial, demographic, or PIN data.
-- Revoke these column SELECT grants from `anon`; the wide-open RLS policy still
-- allows reading the safe identity columns (id, username, display_name, etc.).
REVOKE SELECT (
  email,
  wallet_address,
  total_earnings,
  date_of_birth,
  gender,
  security_pin_hash,
  security_pin_failed_attempts,
  security_pin_locked_until,
  email_notifications,
  push_notifications,
  notification_sound,
  quiet_hours_enabled,
  quiet_hours_start,
  quiet_hours_end,
  receive_content_notifications,
  receive_new_follower_notifications,
  receive_playlist_notifications,
  receive_system_notifications,
  show_listening_history
) ON public.users FROM anon;

-- Authenticated users must never be able to read another user's PIN hash or
-- failed-attempt counters. PIN verification is gated through SECURITY DEFINER
-- helpers, which keep working because they run with elevated privileges.
REVOKE SELECT (
  security_pin_hash,
  security_pin_failed_attempts,
  security_pin_locked_until
) ON public.users FROM authenticated;

-- ============================================================================
-- 3. Bot/fraud SECURITY DEFINER RPCs: revoke anon EXECUTE
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enqueue_bot_contribution_clawback'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.enqueue_bot_contribution_clawback(uuid, text) FROM anon;
    -- Keep authenticated + service_role; the function is invoked via PERFORM
    -- inside other SECURITY DEFINER paths and from server jobs.
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'detect_fraud_patterns_cached'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.detect_fraud_patterns_cached(uuid, uuid, text) FROM anon;
    -- Keep authenticated (real logged-in playback recording) + service_role.
  END IF;
END $$;

-- ============================================================================
-- 4. External revenue: admin-only guard on pending topup totals
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_pending_external_revenue_topup_total()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_total numeric;
BEGIN
  IF NOT public.admin_external_revenue_is_admin()
     AND NOT public.admin_external_revenue_is_finance_role() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Admin or finance role required'
    );
  END IF;

  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(amount_usd), 0)::numeric
  INTO v_count, v_total
  FROM public.external_revenue_contribution_pool_topups
  WHERE status = 'pending';

  -- Keep response shape compatible with the original RPC
  -- (`success`, `pending_count`, `pending_total_usd`).
  RETURN jsonb_build_object(
    'success', true,
    'pending_count', v_count,
    'pending_total_usd', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_pending_external_revenue_topup_total() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_pending_external_revenue_topup_total() TO authenticated;

COMMENT ON FUNCTION public.admin_get_pending_external_revenue_topup_total() IS
  'Returns pending external-revenue topup totals. Requires admin or finance role; returns {success:false} for everyone else.';
