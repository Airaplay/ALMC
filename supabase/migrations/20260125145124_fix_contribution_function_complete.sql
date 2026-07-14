/*
  # Fix Contribution Function - Complete Column Name Fix
  
  1. Issues Fixed
    - Changed `points_earned` to `contribution_points` in INSERT
    - Changed `last_contribution_at` to `updated_at` in listener_contribution_scores
    - Table uses `updated_at` not `last_contribution_at`
  
  2. Impact
    - Contribution tracking will now work properly
    - Users will earn points when they like songs, comment, etc.
*/

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
SET search_path TO 'public', 'pg_temp'
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
    RETURN jsondb_build_object(
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
    contribution_points,
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

  -- Update contribution scores (use updated_at, not last_contribution_at)
  INSERT INTO listener_contribution_scores (
    user_id,
    total_points,
    current_period_points,
    updated_at
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
    updated_at = NOW();

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

-- Re-grant permissions
GRANT EXECUTE ON FUNCTION record_listener_contribution(uuid, text, uuid, text, jsonb) TO authenticated, service_role, anon;
