/*
  # Revert payment-channel and profile-display access changes

  Requested rollback for the Supabase-side changes that affected:
    1. Payment Channels public reads
    2. Public/profile-display reads from public.users

  This intentionally leaves unrelated hardening in place:
    - Edge Function JWT/role checks
    - send-email / process-email-queue auth
    - bot/fraud RPC EXECUTE revokes
    - admin external-revenue guard

  Important: restoring table-level SELECT on public.users and public SELECT on
  treat_payment_channels brings back the previous behavior. It also re-opens
  the older confidentiality risks on those tables, so this should be treated as
  a compatibility rollback rather than the final security posture.
*/

-- ============================================================================
-- 1. Payment channels: restore direct public reads of enabled channels
-- ============================================================================

GRANT SELECT ON public.treat_payment_channels TO anon, authenticated;

DROP POLICY IF EXISTS "treat_payment_channels_select_enabled"
  ON public.treat_payment_channels;

CREATE POLICY "treat_payment_channels_select_enabled"
  ON public.treat_payment_channels
  FOR SELECT
  TO anon, authenticated
  USING (is_enabled = true);

DROP POLICY IF EXISTS "Public can view enabled channels"
  ON public.treat_payment_channels;

CREATE POLICY "Public can view enabled channels"
  ON public.treat_payment_channels
  FOR SELECT
  TO public
  USING (is_enabled = true);

-- Return the compatibility view to the original security-invoker behavior.
-- With the public enabled-channel policies restored above, anon/authenticated
-- callers can resolve the redacted view through normal RLS again.
ALTER VIEW IF EXISTS public.enabled_payment_channels_public
  SET (security_invoker = true);

COMMENT ON VIEW public.enabled_payment_channels_public IS
  'Browser-safe projection of treat_payment_channels. Restored to security_invoker=true for compatibility with the direct public enabled-channel policies.';

-- ============================================================================
-- 2. Profiles: restore broad table SELECT for profile display compatibility
-- ============================================================================

GRANT SELECT ON public.users TO anon, authenticated;

COMMENT ON VIEW public.public_user_profiles IS
  'Strictly-public profile fields safe for unauthenticated content attribution. Kept for compatibility, but broad SELECT on public.users has been restored by rollback migration 20260514134200.';
