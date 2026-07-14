/*
  # Security Hardening — corrected grant tightening

  Follow-up to 20260514040000. The previous migration tried column-level
  REVOKEs and `REVOKE … FROM anon`, but the live grants are actually:

    - public.users: table-level SELECT to anon & authenticated, so column
      REVOKEs were no-ops. Switch to: REVOKE SELECT ON users + GRANT only
      whitelisted columns.

    - bot/fraud RPCs: EXECUTE granted to PUBLIC (which implicitly includes
      anon), so `REVOKE … FROM anon` was a no-op. Switch to REVOKE FROM
      PUBLIC and re-grant explicitly to authenticated + service_role.

  Idempotent and safe to re-run.
*/

-- ============================================================================
-- 1. Tighten public.users SELECT to a column whitelist
-- ============================================================================

-- Strip the broad table-level SELECT. The wide-open RLS policies on `users`
-- still permit row visibility, but column-level GRANTs determine which fields
-- the row exposes — so revoking table-level SELECT here is the precondition
-- for the per-column whitelist below.
REVOKE SELECT ON public.users FROM anon;
REVOKE SELECT ON public.users FROM authenticated;

-- Anonymous browsers see only the strictly-public identity / profile fields
-- needed for content attribution joins (display_name, avatar_url, etc.).
-- Critical exclusions: email, role, wallet_address, total_earnings,
-- date_of_birth, gender, all security_pin_*, all notification preferences.
GRANT SELECT (
  id,
  username,
  display_name,
  avatar_url,
  bio,
  country,
  show_artist_badge,
  background_image_url,
  social_media_platform,
  social_media_url,
  profile_visibility,
  is_active,
  username_changed,
  username_last_changed_at,
  country_last_changed_at,
  created_at,
  updated_at,
  show_listening_history
) ON public.users TO anon;

-- Authenticated callers retain access to their own (and other users') public
-- fields, plus the additional fields the app needs:
--   - email / role: required for self-profile screens and admin auth checks
--   - wallet_address / total_earnings: shown on creator dashboard
--   - notification preference columns: shown on settings screens
--   - date_of_birth / gender: shown on profile/edit-profile screens
-- Excluded for everyone (including own row): security_pin_hash and the PIN
-- counters. PIN verification flows through SECURITY DEFINER functions which
-- run as `postgres` and don't depend on these per-role grants.
GRANT SELECT (
  id,
  email,
  display_name,
  avatar_url,
  created_at,
  updated_at,
  role,
  bio,
  country,
  show_artist_badge,
  wallet_address,
  username,
  username_changed,
  total_earnings,
  receive_new_follower_notifications,
  receive_content_notifications,
  receive_playlist_notifications,
  receive_system_notifications,
  show_listening_history,
  profile_visibility,
  is_active,
  background_image_url,
  social_media_platform,
  social_media_url,
  username_last_changed_at,
  country_last_changed_at,
  gender,
  email_notifications,
  push_notifications,
  notification_sound,
  quiet_hours_enabled,
  quiet_hours_start,
  quiet_hours_end,
  date_of_birth
) ON public.users TO authenticated;

-- ============================================================================
-- 2. Bot/fraud RPCs: revoke EXECUTE from PUBLIC
-- ============================================================================

-- These functions appeared as `proacl: {=X/postgres,...}` — the `=X/postgres`
-- entry is PUBLIC EXECUTE, which silently grants every role (including anon).
-- Revoke from PUBLIC and re-grant explicitly to the only roles that should
-- ever invoke them.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enqueue_bot_contribution_clawback'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.enqueue_bot_contribution_clawback(uuid, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.enqueue_bot_contribution_clawback(uuid, text) TO authenticated, service_role;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'detect_fraud_patterns_cached'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.detect_fraud_patterns_cached(uuid, uuid, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.detect_fraud_patterns_cached(uuid, uuid, text) TO authenticated, service_role;
  END IF;
END $$;
