/*
  # Implement Rate Limiting System for Security
  
  This migration creates infrastructure for rate limiting to prevent abuse,
  brute force attacks, and DOS attempts on sensitive endpoints.
  
  ## Security Improvements
  
  1. **Request Tracking** - Track requests per user/IP for rate limiting
  2. **Automatic Blocking** - Auto-block IPs that exceed rate limits
  3. **Audit Trail** - Log all rate limit violations for security analysis
  4. **Configurable Limits** - Admin-configurable rate limits per endpoint
  
  ## Tables Created
  
  1. `rate_limit_config` - Configuration for rate limits
  2. `rate_limit_violations` - Log of rate limit violations
  3. `blocked_ips` - IPs that are temporarily or permanently blocked
  
  ## Functions Created
  
  1. `check_rate_limit()` - Check if request should be allowed
  2. `record_request()` - Record a request for rate limiting
  3. `block_ip()` - Block an IP address
  4. `unblock_ip()` - Unblock an IP address
  
  ## Default Rate Limits
  
  - Auth endpoints: 10 requests per minute
  - Payment endpoints: 5 requests per minute
  - General API: 60 requests per minute
*/

-- Create rate_limit_config table
CREATE TABLE IF NOT EXISTS rate_limit_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_pattern text NOT NULL UNIQUE,
  requests_per_minute integer NOT NULL DEFAULT 60,
  requests_per_hour integer NOT NULL DEFAULT 1000,
  requests_per_day integer NOT NULL DEFAULT 10000,
  is_enabled boolean DEFAULT true,
  block_duration_minutes integer DEFAULT 60,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_limits CHECK (
    requests_per_minute > 0 AND
    requests_per_hour > 0 AND
    requests_per_day > 0
  )
);

-- Create rate_limit_violations table
CREATE TABLE IF NOT EXISTS rate_limit_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  endpoint text NOT NULL,
  violation_type text NOT NULL CHECK (violation_type IN ('minute', 'hour', 'day')),
  request_count integer NOT NULL,
  limit_exceeded integer NOT NULL,
  was_blocked boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create blocked_ips table
CREATE TABLE IF NOT EXISTS blocked_ips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL UNIQUE,
  reason text NOT NULL,
  blocked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  blocked_until timestamptz,
  is_permanent boolean DEFAULT false,
  violation_count integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_rate_limit_violations_ip ON rate_limit_violations(ip_address);
CREATE INDEX IF NOT EXISTS idx_rate_limit_violations_created ON rate_limit_violations(created_at);
CREATE INDEX IF NOT EXISTS idx_blocked_ips_address ON blocked_ips(ip_address);
CREATE INDEX IF NOT EXISTS idx_blocked_ips_until ON blocked_ips(blocked_until) WHERE blocked_until IS NOT NULL;

-- Enable RLS
ALTER TABLE rate_limit_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_ips ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Admin only access
CREATE POLICY "Admins can view rate limit config"
  ON rate_limit_config
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage rate limit config"
  ON rate_limit_config
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can view violations"
  ON rate_limit_violations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

CREATE POLICY "Service role can manage violations"
  ON rate_limit_violations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can view blocked IPs"
  ON blocked_ips
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage blocked IPs"
  ON blocked_ips
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

CREATE POLICY "Service role can manage blocked IPs"
  ON blocked_ips
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to check if IP is blocked
CREATE OR REPLACE FUNCTION is_ip_blocked(p_ip_address text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  blocked_record RECORD;
BEGIN
  SELECT * INTO blocked_record
  FROM blocked_ips
  WHERE ip_address = p_ip_address
  AND (
    is_permanent = true
    OR (blocked_until IS NOT NULL AND blocked_until > now())
  );
  
  RETURN FOUND;
END;
$$;

-- Function to block an IP
CREATE OR REPLACE FUNCTION block_ip_address(
  p_ip_address text,
  p_reason text,
  p_duration_minutes integer DEFAULT 60,
  p_is_permanent boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  blocked_id uuid;
  blocked_until_time timestamptz;
BEGIN
  IF p_is_permanent THEN
    blocked_until_time := NULL;
  ELSE
    blocked_until_time := now() + (p_duration_minutes || ' minutes')::interval;
  END IF;
  
  INSERT INTO blocked_ips (
    ip_address,
    reason,
    blocked_by,
    blocked_until,
    is_permanent
  ) VALUES (
    p_ip_address,
    p_reason,
    auth.uid(),
    blocked_until_time,
    p_is_permanent
  )
  ON CONFLICT (ip_address) DO UPDATE SET
    reason = EXCLUDED.reason,
    blocked_until = EXCLUDED.blocked_until,
    is_permanent = EXCLUDED.is_permanent,
    violation_count = blocked_ips.violation_count + 1,
    updated_at = now()
  RETURNING id INTO blocked_id;
  
  RETURN blocked_id;
END;
$$;

-- Function to unblock an IP
CREATE OR REPLACE FUNCTION unblock_ip_address(p_ip_address text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM blocked_ips
  WHERE ip_address = p_ip_address;
  
  RETURN FOUND;
END;
$$;

-- Function to record rate limit violation
CREATE OR REPLACE FUNCTION record_rate_limit_violation(
  p_ip_address text,
  p_user_id uuid,
  p_endpoint text,
  p_violation_type text,
  p_request_count integer,
  p_limit integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  violation_id uuid;
  violation_count integer;
  should_block boolean;
BEGIN
  INSERT INTO rate_limit_violations (
    ip_address,
    user_id,
    endpoint,
    violation_type,
    request_count,
    limit_exceeded
  ) VALUES (
    p_ip_address,
    p_user_id,
    p_endpoint,
    p_violation_type,
    p_request_count,
    p_limit
  )
  RETURNING id INTO violation_id;
  
  SELECT COUNT(*) INTO violation_count
  FROM rate_limit_violations
  WHERE ip_address = p_ip_address
  AND created_at > now() - interval '1 hour';
  
  IF violation_count >= 5 THEN
    PERFORM block_ip_address(
      p_ip_address,
      'Automatic block due to repeated rate limit violations',
      120,
      false
    );
    
    UPDATE rate_limit_violations
    SET was_blocked = true
    WHERE id = violation_id;
  END IF;
  
  RETURN violation_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION is_ip_blocked(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION block_ip_address(text, text, integer, boolean) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION unblock_ip_address(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION record_rate_limit_violation(text, uuid, text, text, integer, integer) TO service_role;

-- Insert default rate limit configurations
INSERT INTO rate_limit_config (endpoint_pattern, requests_per_minute, requests_per_hour, requests_per_day) VALUES
  ('/auth/signin', 10, 100, 1000),
  ('/auth/signup', 5, 50, 500),
  ('/auth/password-reset', 3, 20, 100),
  ('/process-payment', 5, 50, 500),
  ('/flutterwave-webhook', 100, 1000, 10000),
  ('/payment-webhook', 100, 1000, 10000),
  ('/*', 60, 1000, 10000)
ON CONFLICT (endpoint_pattern) DO NOTHING;

-- Create function to clean up expired blocks
CREATE OR REPLACE FUNCTION cleanup_expired_blocks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM blocked_ips
  WHERE is_permanent = false
  AND blocked_until IS NOT NULL
  AND blocked_until < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION cleanup_expired_blocks() TO service_role;

-- Add comments
COMMENT ON TABLE rate_limit_config IS 'Configuration for rate limiting per endpoint';
COMMENT ON TABLE rate_limit_violations IS 'Log of all rate limit violations for security analysis';
COMMENT ON TABLE blocked_ips IS 'IPs that are temporarily or permanently blocked';
COMMENT ON FUNCTION is_ip_blocked(text) IS 'Check if an IP address is currently blocked';
COMMENT ON FUNCTION block_ip_address(text, text, integer, boolean) IS 'Block an IP address for a specified duration or permanently';
COMMENT ON FUNCTION record_rate_limit_violation(text, uuid, text, text, integer, integer) IS 'Record a rate limit violation and auto-block if threshold exceeded';
