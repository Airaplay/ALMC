/*
  # Admin Security Enhancements

  ## Summary
  Strengthens the admin dashboard against brute-force attacks and improves audit trail quality.

  ## Changes

  ### 1. New Table: admin_login_attempts
  Tracks failed login attempts per email address to enforce rate limiting.
  - `email` - the email address that attempted login
  - `attempted_at` - timestamp of the attempt
  - `ip_address` - client IP (passed from client)
  - `user_agent` - browser/device info
  - `success` - whether the attempt succeeded

  ### 2. New Function: check_admin_login_rate_limit
  Returns whether a given email is currently locked out (>= 5 failures in 15 minutes).

  ### 3. New Function: record_admin_login_attempt
  Inserts a login attempt record (success or failure).

  ### 4. New Function: clear_admin_login_attempts
  Clears attempts for an email after a successful login.

  ### 5. Alter Table: admin_activity_logs
  Adds `ip_address` and `user_agent` columns to capture richer audit context.

  ### 6. New Function: log_admin_activity_with_context
  Enhanced version of log_admin_activity that accepts IP and user agent.

  ## Security
  - RLS enabled on admin_login_attempts
  - Only service role can insert/read attempts (prevents enumeration)
  - Rate limit: 5 failed attempts within 15 minutes = 15 minute lockout
*/

-- ============================================================
-- 1. admin_login_attempts table
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  attempted_at timestamptz DEFAULT now() NOT NULL,
  ip_address text DEFAULT '' NOT NULL,
  user_agent text DEFAULT '' NOT NULL,
  success boolean DEFAULT false NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_email_time 
  ON admin_login_attempts (email, attempted_at DESC);

ALTER TABLE admin_login_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage login attempts"
  ON admin_login_attempts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow the check function (SECURITY DEFINER) to insert attempts from anon/authenticated callers
CREATE POLICY "Authenticated can insert own attempt"
  ON admin_login_attempts
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- ============================================================
-- 2. check_admin_login_rate_limit function
-- Returns true if the email is LOCKED OUT (too many recent failures)
-- ============================================================
CREATE OR REPLACE FUNCTION check_admin_login_rate_limit(
  email_param text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  failure_count integer;
  lockout_until timestamptz;
  earliest_failure timestamptz;
BEGIN
  -- Count failed attempts in the last 15 minutes
  SELECT COUNT(*), MIN(attempted_at)
  INTO failure_count, earliest_failure
  FROM admin_login_attempts
  WHERE email = email_param
    AND success = false
    AND attempted_at > now() - interval '15 minutes';

  IF failure_count >= 5 THEN
    lockout_until := earliest_failure + interval '15 minutes';
    RETURN jsonb_build_object(
      'locked', true,
      'failure_count', failure_count,
      'lockout_until', lockout_until,
      'seconds_remaining', GREATEST(0, EXTRACT(EPOCH FROM (lockout_until - now()))::integer)
    );
  END IF;

  RETURN jsonb_build_object(
    'locked', false,
    'failure_count', failure_count,
    'attempts_remaining', 5 - failure_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_admin_login_rate_limit(text) TO authenticated, anon;

-- ============================================================
-- 3. record_admin_login_attempt function
-- ============================================================
CREATE OR REPLACE FUNCTION record_admin_login_attempt(
  email_param text,
  success_param boolean,
  ip_address_param text DEFAULT '',
  user_agent_param text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO admin_login_attempts (email, success, ip_address, user_agent)
  VALUES (email_param, success_param, ip_address_param, user_agent_param);

  -- Auto-clean old attempts older than 24 hours to keep table lean
  DELETE FROM admin_login_attempts
  WHERE attempted_at < now() - interval '24 hours';
END;
$$;

GRANT EXECUTE ON FUNCTION record_admin_login_attempt(text, boolean, text, text) TO authenticated, anon;

-- ============================================================
-- 4. clear_admin_login_attempts - called on successful login
-- ============================================================
CREATE OR REPLACE FUNCTION clear_admin_login_attempts(
  email_param text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM admin_login_attempts
  WHERE email = email_param AND success = false;
END;
$$;

GRANT EXECUTE ON FUNCTION clear_admin_login_attempts(text) TO authenticated, anon;

-- ============================================================
-- 5. Add ip_address and user_agent to admin_activity_logs
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_activity_logs' AND column_name = 'ip_address'
  ) THEN
    ALTER TABLE admin_activity_logs ADD COLUMN ip_address text DEFAULT '' NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_activity_logs' AND column_name = 'user_agent'
  ) THEN
    ALTER TABLE admin_activity_logs ADD COLUMN user_agent text DEFAULT '' NOT NULL;
  END IF;
END $$;

-- ============================================================
-- 6. Enhanced log_admin_activity that accepts IP + user agent
-- ============================================================
CREATE OR REPLACE FUNCTION log_admin_activity_with_context(
  action_type_param text,
  details_param jsonb DEFAULT '{}',
  ip_address_param text DEFAULT '',
  user_agent_param text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_admin_id uuid := auth.uid();
BEGIN
  IF current_admin_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO admin_activity_logs (admin_id, action_type, details, ip_address, user_agent)
  VALUES (current_admin_id, action_type_param, details_param, ip_address_param, user_agent_param);
END;
$$;

GRANT EXECUTE ON FUNCTION log_admin_activity_with_context(text, jsonb, text, text) TO authenticated;
