/*
  # Emergency Financial Safety System - Option B Implementation
  
  1. Rate Limiting System
    - Creates `contribution_rate_limits` table to track daily activity counts
    - Implements per-activity caps (20 actions per day)
    - Adds cooldown periods (5 minutes between same activities)
    
  2. Daily Earning Caps
    - Creates `user_daily_earnings` table to track daily point accumulation
    - Enforces maximum 100 points per user per day
    - Prevents unlimited earning exploitation
    
  3. Withdrawal Freeze Mechanism
    - Creates `platform_financial_controls` table for admin control
    - Allows emergency freeze of all withdrawals
    - Tracks freeze status and reasons
    
  4. Updated Contribution Recording
    - Replaces existing `record_listener_contribution` function
    - Adds all safety checks: rate limits, caps, cooldowns
    - Includes detailed error messages for better UX
    
  5. Security
    - All tables have RLS enabled
    - Admin-only access to financial controls
    - Users can view their own limits
*/

-- ============================================================================
-- 1. RATE LIMITING SYSTEM
-- ============================================================================

-- Track daily activity counts per user
CREATE TABLE IF NOT EXISTS contribution_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  activity_type text NOT NULL,
  contribution_date date NOT NULL DEFAULT CURRENT_DATE,
  count integer DEFAULT 0 NOT NULL,
  last_contribution_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, activity_type, contribution_date)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_activity ON contribution_rate_limits(user_id, activity_type, contribution_date);
CREATE INDEX IF NOT EXISTS idx_rate_limits_date ON contribution_rate_limits(contribution_date);

-- RLS for rate limits
ALTER TABLE contribution_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own rate limits"
  ON contribution_rate_limits FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can manage rate limits"
  ON contribution_rate_limits FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 2. DAILY EARNING CAPS
-- ============================================================================

-- Track daily point accumulation per user
CREATE TABLE IF NOT EXISTS user_daily_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  earning_date date NOT NULL DEFAULT CURRENT_DATE,
  total_points_earned integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, earning_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_earnings_user_date ON user_daily_earnings(user_id, earning_date);

-- RLS for daily earnings
ALTER TABLE user_daily_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own daily earnings"
  ON user_daily_earnings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can manage daily earnings"
  ON user_daily_earnings FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 3. WITHDRAWAL FREEZE MECHANISM
-- ============================================================================

-- Platform-wide financial controls
CREATE TABLE IF NOT EXISTS platform_financial_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_name text UNIQUE NOT NULL,
  is_active boolean DEFAULT false NOT NULL,
  reason text,
  activated_by uuid REFERENCES auth.users(id),
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Insert default controls
INSERT INTO platform_financial_controls (control_name, is_active, reason)
VALUES 
  ('withdrawal_freeze', true, 'Emergency restructuring - Option B implementation'),
  ('contribution_rewards_active', true, 'Contribution system active with safety limits'),
  ('monthly_conversion_active', false, 'Paused during restructuring')
ON CONFLICT (control_name) DO NOTHING;

-- RLS for financial controls
ALTER TABLE platform_financial_controls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view financial controls"
  ON platform_financial_controls FOR SELECT
  USING (true);

CREATE POLICY "Only admins can update financial controls"
  ON platform_financial_controls FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- ============================================================================
-- 4. UPDATED CONTRIBUTION RECORDING WITH ALL SAFEGUARDS
-- ============================================================================

-- Drop existing function to change return type
DROP FUNCTION IF EXISTS record_listener_contribution(uuid, text, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION record_listener_contribution(
  p_user_id uuid,
  p_activity_type text,
  p_reference_id uuid DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_points integer := 0;
  v_daily_cap integer := 20;
  v_daily_earnings_cap integer := 100;
  v_cooldown_minutes integer := 5;
  v_current_count integer := 0;
  v_current_daily_points integer := 0;
  v_last_contribution timestamptz;
  v_user_role text;
  v_content_creator_id uuid;
  v_is_own_content boolean := false;
  v_contribution_id uuid;
  v_rewards_active boolean;
BEGIN
  -- Check if contribution rewards are active
  SELECT is_active INTO v_rewards_active
  FROM platform_financial_controls
  WHERE control_name = 'contribution_rewards_active';
  
  IF NOT v_rewards_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Contribution rewards are currently paused'
    );
  END IF;

  -- Get user role
  SELECT role INTO v_user_role
  FROM users
  WHERE id = p_user_id;
  
  -- Check if creator is engaging with their own content
  IF p_reference_id IS NOT NULL AND v_user_role = 'creator' THEN
    -- Determine content creator based on reference type
    CASE p_reference_type
      WHEN 'song' THEN
        SELECT artist_id INTO v_content_creator_id
        FROM songs WHERE id = p_reference_id;
      WHEN 'album' THEN
        SELECT artist_id INTO v_content_creator_id
        FROM albums WHERE id = p_reference_id;
      WHEN 'video' THEN
        SELECT artist_id INTO v_content_creator_id
        FROM videos WHERE id = p_reference_id;
      WHEN 'playlist' THEN
        SELECT user_id INTO v_content_creator_id
        FROM playlists WHERE id = p_reference_id;
      ELSE
        v_content_creator_id := NULL;
    END CASE;
    
    -- Check if it's their own content
    IF v_content_creator_id = p_user_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Creators cannot earn rewards from their own content'
      );
    END IF;
  END IF;

  -- Check daily activity cap
  SELECT COALESCE(count, 0), last_contribution_at
  INTO v_current_count, v_last_contribution
  FROM contribution_rate_limits
  WHERE user_id = p_user_id
    AND activity_type = p_activity_type
    AND contribution_date = CURRENT_DATE;
  
  IF v_current_count >= v_daily_cap THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Daily limit reached for %s. You can earn more tomorrow!', p_activity_type),
      'limit', v_daily_cap,
      'current', v_current_count
    );
  END IF;

  -- Check cooldown period
  IF v_last_contribution IS NOT NULL AND 
     v_last_contribution > NOW() - (v_cooldown_minutes || ' minutes')::interval THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Please wait %s minutes between actions', v_cooldown_minutes),
      'cooldown_remaining_seconds', EXTRACT(EPOCH FROM (v_last_contribution + (v_cooldown_minutes || ' minutes')::interval - NOW()))::integer
    );
  END IF;

  -- Check daily earnings cap
  SELECT COALESCE(total_points_earned, 0)
  INTO v_current_daily_points
  FROM user_daily_earnings
  WHERE user_id = p_user_id
    AND earning_date = CURRENT_DATE;
  
  -- Get reward points for this activity
  SELECT base_reward_points INTO v_points
  FROM contribution_activities
  WHERE activity_type = p_activity_type
    AND is_active = true;
  
  IF v_points IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid activity type or activity is not active'
    );
  END IF;

  -- Check if adding these points would exceed daily cap
  IF (v_current_daily_points + v_points) > v_daily_earnings_cap THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Daily earning cap reached. Current: %s points, Cap: %s points', v_current_daily_points, v_daily_earnings_cap),
      'points_earned_today', v_current_daily_points,
      'daily_cap', v_daily_earnings_cap
    );
  END IF;

  -- All checks passed - record the contribution
  INSERT INTO listener_contributions (
    user_id,
    activity_type,
    reference_id,
    reference_type,
    points_earned,
    metadata
  ) VALUES (
    p_user_id,
    p_activity_type,
    p_reference_id,
    p_reference_type,
    v_points,
    p_metadata
  )
  RETURNING id INTO v_contribution_id;

  -- Update rate limit
  INSERT INTO contribution_rate_limits (
    user_id,
    activity_type,
    contribution_date,
    count,
    last_contribution_at
  ) VALUES (
    p_user_id,
    p_activity_type,
    CURRENT_DATE,
    1,
    NOW()
  )
  ON CONFLICT (user_id, activity_type, contribution_date)
  DO UPDATE SET
    count = contribution_rate_limits.count + 1,
    last_contribution_at = NOW();

  -- Update daily earnings
  INSERT INTO user_daily_earnings (
    user_id,
    earning_date,
    total_points_earned
  ) VALUES (
    p_user_id,
    CURRENT_DATE,
    v_points
  )
  ON CONFLICT (user_id, earning_date)
  DO UPDATE SET
    total_points_earned = user_daily_earnings.total_points_earned + v_points,
    updated_at = NOW();

  -- Update contribution scores
  INSERT INTO listener_contribution_scores (
    user_id,
    total_points,
    current_period_points,
    last_contribution_at
  ) VALUES (
    p_user_id,
    v_points,
    v_points,
    NOW()
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    total_points = listener_contribution_scores.total_points + v_points,
    current_period_points = listener_contribution_scores.current_period_points + v_points,
    last_contribution_at = NOW();

  -- Return success with details
  RETURN jsonb_build_object(
    'success', true,
    'points_earned', v_points,
    'activity_count_today', v_current_count + 1,
    'daily_activity_cap', v_daily_cap,
    'total_points_today', v_current_daily_points + v_points,
    'daily_earnings_cap', v_daily_earnings_cap,
    'contribution_id', v_contribution_id
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION record_listener_contribution TO authenticated, anon;

-- ============================================================================
-- 5. CLEANUP OLD DATA (OPTIONAL - RUNS DAILY)
-- ============================================================================

-- Function to clean up old rate limit records (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM contribution_rate_limits
  WHERE contribution_date < CURRENT_DATE - INTERVAL '30 days';
  
  DELETE FROM user_daily_earnings
  WHERE earning_date < CURRENT_DATE - INTERVAL '30 days';
END;
$$;

-- ============================================================================
-- 6. HELPER FUNCTIONS
-- ============================================================================

-- Function to check user's current limits
CREATE OR REPLACE FUNCTION get_user_contribution_limits(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'daily_earnings', COALESCE(
      (SELECT jsonb_build_object(
        'points_earned_today', total_points_earned,
        'daily_cap', 100,
        'remaining', GREATEST(0, 100 - total_points_earned)
      )
      FROM user_daily_earnings
      WHERE user_id = p_user_id AND earning_date = CURRENT_DATE),
      jsonb_build_object('points_earned_today', 0, 'daily_cap', 100, 'remaining', 100)
    ),
    'activity_limits', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'activity_type', activity_type,
          'count_today', count,
          'daily_cap', 20,
          'remaining', GREATEST(0, 20 - count),
          'last_contribution', last_contribution_at
        )
      )
      FROM contribution_rate_limits
      WHERE user_id = p_user_id AND contribution_date = CURRENT_DATE),
      '[]'::jsonb
    )
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_contribution_limits TO authenticated;

-- Function for admins to view financial controls status
CREATE OR REPLACE FUNCTION admin_get_financial_controls()
RETURNS TABLE (
  control_name text,
  is_active boolean,
  reason text,
  activated_at timestamptz,
  deactivated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can view financial controls';
  END IF;
  
  RETURN QUERY
  SELECT 
    pfc.control_name,
    pfc.is_active,
    pfc.reason,
    pfc.activated_at,
    pfc.deactivated_at
  FROM platform_financial_controls pfc
  ORDER BY pfc.control_name;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_financial_controls TO authenticated;
