/*
  # Enhanced AdMob API Security and Monitoring

  This migration improves the AdMob API integration with:
  1. Rate limiting for sync operations
  2. Credentials vault support
  3. Enhanced error monitoring and alerting
  4. API quota tracking

  ## Changes

  1. **admob_api_config** - Add vault support and rate limiting
  2. **admob_sync_rate_limit** - Track sync frequency to prevent abuse
  3. **admob_error_log** - Detailed error tracking and monitoring
  4. **admob_api_quota** - Track API usage against quotas
*/

-- ============================================================================
-- 1. ADD: Vault support and enhanced security to admob_api_config
-- ============================================================================

-- Add vault reference columns
ALTER TABLE admob_api_config
ADD COLUMN IF NOT EXISTS credentials_vault_secret_name text,
ADD COLUMN IF NOT EXISTS use_vault boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS last_credential_rotation timestamptz,
ADD COLUMN IF NOT EXISTS credential_rotation_days integer DEFAULT 90;

-- Add rate limiting columns
ALTER TABLE admob_api_config
ADD COLUMN IF NOT EXISTS max_syncs_per_hour integer DEFAULT 10 CHECK (max_syncs_per_hour >= 1 AND max_syncs_per_hour <= 100),
ADD COLUMN IF NOT EXISTS max_syncs_per_day integer DEFAULT 50 CHECK (max_syncs_per_day >= 1 AND max_syncs_per_day <= 500);

-- Add monitoring columns
ALTER TABLE admob_api_config
ADD COLUMN IF NOT EXISTS consecutive_failures integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_successful_sync timestamptz,
ADD COLUMN IF NOT EXISTS alert_on_failure boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS alert_after_failures integer DEFAULT 3;

COMMENT ON COLUMN admob_api_config.credentials_vault_secret_name IS 'Name of the secret in Supabase Vault containing service account credentials';
COMMENT ON COLUMN admob_api_config.use_vault IS 'If true, fetch credentials from vault instead of credentials_encrypted column';
COMMENT ON COLUMN admob_api_config.consecutive_failures IS 'Track consecutive sync failures for alerting';

-- Create index for monitoring
CREATE INDEX IF NOT EXISTS idx_admob_config_failures ON admob_api_config(consecutive_failures, alert_on_failure) WHERE consecutive_failures >= 3;

-- ============================================================================
-- 2. CREATE: admob_sync_rate_limit table
-- ============================================================================

CREATE TABLE IF NOT EXISTS admob_sync_rate_limit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES admob_api_config(id) ON DELETE CASCADE,

  -- Time window
  hour_start timestamptz NOT NULL,
  day_start date NOT NULL,

  -- Counters
  syncs_this_hour integer DEFAULT 0,
  syncs_this_day integer DEFAULT 0,

  -- Tracking
  last_sync_at timestamptz,
  blocked_attempts integer DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique constraint for tracking
CREATE UNIQUE INDEX IF NOT EXISTS idx_admob_rate_limit_hour ON admob_sync_rate_limit(config_id, hour_start);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admob_rate_limit_day ON admob_sync_rate_limit(config_id, day_start);
CREATE INDEX IF NOT EXISTS idx_admob_rate_limit_cleanup ON admob_sync_rate_limit(day_start);

-- RLS Policies
ALTER TABLE admob_sync_rate_limit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read rate limit"
  ON admob_sync_rate_limit FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ============================================================================
-- 3. CREATE: admob_error_log table
-- ============================================================================

CREATE TABLE IF NOT EXISTS admob_error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid REFERENCES admob_api_config(id) ON DELETE SET NULL,
  sync_id uuid REFERENCES admob_sync_history(id) ON DELETE SET NULL,

  -- Error details
  error_type text NOT NULL CHECK (error_type IN ('authentication', 'api_error', 'rate_limit', 'network', 'parsing', 'database', 'unknown')),
  error_message text NOT NULL,
  error_code text,
  http_status_code integer,

  -- Context
  operation text NOT NULL,
  request_payload jsonb,
  response_payload jsonb,

  -- Tracking
  severity text DEFAULT 'error' CHECK (severity IN ('warning', 'error', 'critical')),
  is_resolved boolean DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolution_notes text,

  -- Alert
  alert_sent boolean DEFAULT false,
  alert_sent_at timestamptz,

  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_admob_error_config ON admob_error_log(config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admob_error_type ON admob_error_log(error_type, severity);
CREATE INDEX IF NOT EXISTS idx_admob_error_unresolved ON admob_error_log(is_resolved, severity) WHERE is_resolved = false;
CREATE INDEX IF NOT EXISTS idx_admob_error_cleanup ON admob_error_log(created_at);

-- RLS Policies
ALTER TABLE admob_error_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read error log"
  ON admob_error_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admin update error log"
  ON admob_error_log FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ============================================================================
-- 4. CREATE: admob_api_quota table
-- ============================================================================

CREATE TABLE IF NOT EXISTS admob_api_quota (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES admob_api_config(id) ON DELETE CASCADE,

  -- Time window
  quota_date date NOT NULL,

  -- API calls tracking
  total_api_calls integer DEFAULT 0,
  successful_calls integer DEFAULT 0,
  failed_calls integer DEFAULT 0,

  -- Data metrics
  total_rows_fetched integer DEFAULT 0,
  total_revenue_fetched numeric(12, 6) DEFAULT 0,

  -- Quota limits (from Google)
  daily_quota_limit integer DEFAULT 10000,
  quota_remaining integer,
  quota_reset_at timestamptz,

  -- Status
  quota_exceeded boolean DEFAULT false,
  quota_exceeded_at timestamptz,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_admob_quota_date ON admob_api_quota(config_id, quota_date);
CREATE INDEX IF NOT EXISTS idx_admob_quota_exceeded ON admob_api_quota(quota_exceeded, quota_date) WHERE quota_exceeded = true;
CREATE INDEX IF NOT EXISTS idx_admob_quota_cleanup ON admob_api_quota(quota_date);

-- RLS Policies
ALTER TABLE admob_api_quota ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read quota"
  ON admob_api_quota FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ============================================================================
-- 5. FUNCTION: Check rate limit before sync
-- ============================================================================

CREATE OR REPLACE FUNCTION check_admob_sync_rate_limit(
  p_config_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config admob_api_config%ROWTYPE;
  v_current_hour timestamptz;
  v_current_day date;
  v_syncs_this_hour integer := 0;
  v_syncs_this_day integer := 0;
  v_rate_limit admob_sync_rate_limit%ROWTYPE;
BEGIN
  -- Get config
  SELECT * INTO v_config FROM admob_api_config WHERE id = p_config_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Configuration not found'
    );
  END IF;

  -- Set time windows
  v_current_hour := date_trunc('hour', now());
  v_current_day := CURRENT_DATE;

  -- Get or create rate limit record for this hour
  INSERT INTO admob_sync_rate_limit (config_id, hour_start, day_start, syncs_this_hour, syncs_this_day)
  VALUES (p_config_id, v_current_hour, v_current_day, 0, 0)
  ON CONFLICT (config_id, hour_start) DO NOTHING;

  -- Get current counts
  SELECT * INTO v_rate_limit
  FROM admob_sync_rate_limit
  WHERE config_id = p_config_id AND hour_start = v_current_hour;

  v_syncs_this_hour := COALESCE(v_rate_limit.syncs_this_hour, 0);

  -- Get daily count
  SELECT COALESCE(SUM(syncs_this_hour), 0) INTO v_syncs_this_day
  FROM admob_sync_rate_limit
  WHERE config_id = p_config_id
    AND day_start = v_current_day;

  -- Check limits
  IF v_syncs_this_hour >= v_config.max_syncs_per_hour THEN
    -- Update blocked attempts
    UPDATE admob_sync_rate_limit
    SET blocked_attempts = blocked_attempts + 1
    WHERE config_id = p_config_id AND hour_start = v_current_hour;

    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'hourly_limit_exceeded',
      'limit', v_config.max_syncs_per_hour,
      'current', v_syncs_this_hour,
      'reset_at', v_current_hour + INTERVAL '1 hour'
    );
  END IF;

  IF v_syncs_this_day >= v_config.max_syncs_per_day THEN
    UPDATE admob_sync_rate_limit
    SET blocked_attempts = blocked_attempts + 1
    WHERE config_id = p_config_id AND hour_start = v_current_hour;

    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit_exceeded',
      'limit', v_config.max_syncs_per_day,
      'current', v_syncs_this_day,
      'reset_at', (v_current_day + 1)::timestamptz
    );
  END IF;

  -- Increment counters
  UPDATE admob_sync_rate_limit
  SET
    syncs_this_hour = syncs_this_hour + 1,
    syncs_this_day = syncs_this_day + 1,
    last_sync_at = now(),
    updated_at = now()
  WHERE config_id = p_config_id AND hour_start = v_current_hour;

  RETURN jsonb_build_object(
    'allowed', true,
    'hourly_remaining', v_config.max_syncs_per_hour - v_syncs_this_hour - 1,
    'daily_remaining', v_config.max_syncs_per_day - v_syncs_this_day - 1
  );
END;
$$;

-- ============================================================================
-- 6. FUNCTION: Log AdMob error
-- ============================================================================

CREATE OR REPLACE FUNCTION log_admob_error(
  p_config_id uuid,
  p_sync_id uuid DEFAULT NULL,
  p_error_type text DEFAULT 'unknown',
  p_error_message text DEFAULT 'Unknown error',
  p_error_code text DEFAULT NULL,
  p_http_status_code integer DEFAULT NULL,
  p_operation text DEFAULT 'sync',
  p_severity text DEFAULT 'error',
  p_request_payload jsonb DEFAULT NULL,
  p_response_payload jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_error_id uuid;
  v_config admob_api_config%ROWTYPE;
BEGIN
  -- Insert error log
  INSERT INTO admob_error_log (
    config_id,
    sync_id,
    error_type,
    error_message,
    error_code,
    http_status_code,
    operation,
    severity,
    request_payload,
    response_payload
  ) VALUES (
    p_config_id,
    p_sync_id,
    p_error_type,
    p_error_message,
    p_error_code,
    p_http_status_code,
    p_operation,
    p_severity,
    p_request_payload,
    p_response_payload
  )
  RETURNING id INTO v_error_id;

  -- Update config with failure count
  UPDATE admob_api_config
  SET
    consecutive_failures = consecutive_failures + 1,
    last_error = p_error_message,
    last_error_at = now(),
    connection_status = CASE
      WHEN consecutive_failures + 1 >= alert_after_failures THEN 'error'
      ELSE connection_status
    END
  WHERE id = p_config_id
  RETURNING * INTO v_config;

  -- Check if alert threshold reached
  IF v_config.alert_on_failure AND v_config.consecutive_failures >= v_config.alert_after_failures THEN
    -- Mark error for alerting
    UPDATE admob_error_log
    SET alert_sent = true, alert_sent_at = now()
    WHERE id = v_error_id;

    -- Insert admin notification
    INSERT INTO admin_notifications (
      type,
      severity,
      title,
      message,
      metadata
    ) VALUES (
      'admob_sync_failure',
      'high',
      'AdMob Sync Failures Detected',
      format('AdMob configuration has failed %s consecutive times. Last error: %s',
        v_config.consecutive_failures,
        p_error_message
      ),
      jsonb_build_object(
        'config_id', p_config_id,
        'error_id', v_error_id,
        'consecutive_failures', v_config.consecutive_failures,
        'publisher_id', v_config.publisher_id
      )
    );
  END IF;

  RETURN v_error_id;
END;
$$;

-- ============================================================================
-- 7. FUNCTION: Record successful sync
-- ============================================================================

CREATE OR REPLACE FUNCTION record_admob_sync_success(
  p_config_id uuid,
  p_sync_id uuid,
  p_api_calls integer DEFAULT 1,
  p_rows_fetched integer DEFAULT 0,
  p_revenue_fetched numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reset failure counter
  UPDATE admob_api_config
  SET
    consecutive_failures = 0,
    last_successful_sync = now(),
    last_sync_at = now(),
    connection_status = 'connected'
  WHERE id = p_config_id;

  -- Update quota tracking
  INSERT INTO admob_api_quota (
    config_id,
    quota_date,
    total_api_calls,
    successful_calls,
    total_rows_fetched,
    total_revenue_fetched
  ) VALUES (
    p_config_id,
    CURRENT_DATE,
    p_api_calls,
    p_api_calls,
    p_rows_fetched,
    p_revenue_fetched
  )
  ON CONFLICT (config_id, quota_date)
  DO UPDATE SET
    total_api_calls = admob_api_quota.total_api_calls + p_api_calls,
    successful_calls = admob_api_quota.successful_calls + p_api_calls,
    total_rows_fetched = admob_api_quota.total_rows_fetched + p_rows_fetched,
    total_revenue_fetched = admob_api_quota.total_revenue_fetched + p_revenue_fetched,
    updated_at = now();
END;
$$;

-- ============================================================================
-- 8. FUNCTION: Cleanup old records
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_admob_monitoring_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate_limit_deleted integer;
  v_errors_deleted integer;
  v_quota_deleted integer;
BEGIN
  -- Delete old rate limit records (>7 days)
  DELETE FROM admob_sync_rate_limit
  WHERE day_start < CURRENT_DATE - INTERVAL '7 days';

  GET DIAGNOSTICS v_rate_limit_deleted = ROW_COUNT;

  -- Delete resolved errors (>90 days)
  DELETE FROM admob_error_log
  WHERE created_at < now() - INTERVAL '90 days'
    AND is_resolved = true;

  GET DIAGNOSTICS v_errors_deleted = ROW_COUNT;

  -- Delete old quota records (>30 days)
  DELETE FROM admob_api_quota
  WHERE quota_date < CURRENT_DATE - INTERVAL '30 days';

  GET DIAGNOSTICS v_quota_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'rate_limits_deleted', v_rate_limit_deleted,
    'errors_deleted', v_errors_deleted,
    'quota_records_deleted', v_quota_deleted,
    'cleanup_timestamp', now()
  );
END;
$$;

-- ============================================================================
-- 9. GRANT: Function permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION check_admob_sync_rate_limit TO authenticated;
GRANT EXECUTE ON FUNCTION log_admob_error TO authenticated;
GRANT EXECUTE ON FUNCTION record_admob_sync_success TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_admob_monitoring_data TO authenticated;

-- ============================================================================
-- 10. CREATE: Admin notifications table (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  severity text DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title text NOT NULL,
  message text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  is_read boolean DEFAULT false,
  read_at timestamptz,
  read_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread ON admin_notifications(is_read, severity, created_at DESC) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_admin_notifications_type ON admin_notifications(type, created_at DESC);

ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read notifications"
  ON admin_notifications FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admin update notifications"
  ON admin_notifications FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );
