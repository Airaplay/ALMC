/*
  # Add Rate Limiting for Promotion Endpoints (CRITICAL SECURITY FIX)

  ## Security Issues Fixed
  1. **Spam Prevention** - Limits rapid promotion creation
  2. **DOS Protection** - Prevents system overload
  3. **Abuse Mitigation** - Throttles malicious actors

  ## Changes
  - Add rate limits for promotion creation (5/min, 20/hour, 100/day)
  - Add rate limits for promotion updates
  - Add rate limits for promotion deletion
  - Stricter limits than general API

  ## Security Level
  CRITICAL - Prevents spam and DOS attacks
*/

-- Insert promotion-specific rate limit configurations
INSERT INTO rate_limit_config (endpoint_pattern, requests_per_minute, requests_per_hour, requests_per_day, is_enabled) VALUES
  -- Promotion creation is the most sensitive
  ('/promotions/create', 5, 20, 100, true),
  ('/rest/v1/promotions', 5, 20, 100, true),
  
  -- Promotion updates (more lenient)
  ('/promotions/update', 10, 50, 500, true),
  
  -- Promotion deletion
  ('/promotions/delete', 10, 50, 500, true),
  
  -- Viewing promotions (read-heavy)
  ('/promotions/list', 30, 300, 3000, true)
ON CONFLICT (endpoint_pattern) DO UPDATE SET
  requests_per_minute = EXCLUDED.requests_per_minute,
  requests_per_hour = EXCLUDED.requests_per_hour,
  requests_per_day = EXCLUDED.requests_per_day,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();

-- Add comment
COMMENT ON TABLE rate_limit_config IS 'Rate limiting configuration for all endpoints including critical promotion operations';