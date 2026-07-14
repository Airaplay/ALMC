/*
  # Harden Admin Dashboard security

  Fixes critical weaknesses where login rate-limit helpers could be abused:
  - Prevent clearing failed attempts for arbitrary emails
  - Reduce login enumeration signal
  - Prevent non-admin users from writing to admin activity logs

  Notes:
  - The admin UI calls these RPCs during login and dashboard usage.
  - We keep attempt logging usable pre-auth (anon) but tighten what it can do.
*/

-- ============================================================
-- 1) Safer admin activity logging (admin-portal roles only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_admin_activity_with_context(
  action_type_param text,
  details_param jsonb DEFAULT '{}',
  ip_address_param text DEFAULT '',
  user_agent_param text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin_portal boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = v_uid
      AND role IN ('admin', 'manager', 'editor', 'account')
  ) INTO v_is_admin_portal;

  IF NOT v_is_admin_portal THEN
    -- Do not allow non-admin-portal users to pollute admin logs
    RETURN;
  END IF;

  INSERT INTO public.admin_activity_logs (admin_id, action_type, details, ip_address, user_agent)
  VALUES (v_uid, action_type_param, details_param, ip_address_param, user_agent_param);
END;
$$;

REVOKE ALL ON FUNCTION public.log_admin_activity_with_context(text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_admin_activity_with_context(text, jsonb, text, text) TO authenticated;

-- ============================================================
-- 2) Reduce brute-force / enumeration utility of rate-limit check
--    (still callable pre-auth but returns minimal signal)
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_admin_login_rate_limit(
  email_param text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  failure_count integer;
  lockout_until timestamptz;
  earliest_failure timestamptz;
BEGIN
  -- Count failed attempts in the last 15 minutes
  SELECT COUNT(*), MIN(attempted_at)
  INTO failure_count, earliest_failure
  FROM public.admin_login_attempts
  WHERE email = email_param
    AND success = false
    AND attempted_at > now() - interval '15 minutes';

  IF failure_count >= 5 THEN
    lockout_until := earliest_failure + interval '15 minutes';
    RETURN jsonb_build_object(
      'locked', true,
      'seconds_remaining', GREATEST(0, EXTRACT(EPOCH FROM (lockout_until - now()))::integer)
    );
  END IF;

  -- Intentionally do NOT return remaining-attempt counters (reduces enumeration signal)
  RETURN jsonb_build_object(
    'locked', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_admin_login_rate_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_admin_login_rate_limit(text) TO authenticated, anon;

-- ============================================================
-- 3) Attempt recording: keep anon access but add basic spam throttle
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_admin_login_attempt(
  email_param text,
  success_param boolean,
  ip_address_param text DEFAULT '',
  user_agent_param text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last_attempt timestamptz;
BEGIN
  -- Basic throttle per-email to reduce spam/noise (does not block real users)
  SELECT attempted_at
  INTO v_last_attempt
  FROM public.admin_login_attempts
  WHERE email = email_param
  ORDER BY attempted_at DESC
  LIMIT 1;

  IF v_last_attempt IS NOT NULL AND v_last_attempt > now() - interval '2 seconds' THEN
    RETURN;
  END IF;

  INSERT INTO public.admin_login_attempts (email, success, ip_address, user_agent)
  VALUES (email_param, success_param, ip_address_param, user_agent_param);

  -- Auto-clean old attempts older than 24 hours to keep table lean
  DELETE FROM public.admin_login_attempts
  WHERE attempted_at < now() - interval '24 hours';
END;
$$;

REVOKE ALL ON FUNCTION public.record_admin_login_attempt(text, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_admin_login_attempt(text, boolean, text, text) TO authenticated, anon;

-- ============================================================
-- 4) Clearing failed attempts: ONLY the authenticated user owning the email
-- ============================================================
CREATE OR REPLACE FUNCTION public.clear_admin_login_attempts(
  email_param text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Pull email from the JWT (available post-auth)
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  IF v_email = '' OR lower(email_param) <> v_email THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  DELETE FROM public.admin_login_attempts
  WHERE email = lower(email_param) AND success = false;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_admin_login_attempts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_admin_login_attempts(text) TO authenticated;

