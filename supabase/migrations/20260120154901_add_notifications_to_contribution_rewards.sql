/*
  # Add Notifications to Contribution Rewards Distribution
  
  1. Changes
    - Update admin_distribute_contribution_rewards function
    - Send notification to each user who receives rewards
    - Notification shows amount earned and contribution points used
  
  2. Notification Details
    - Type: 'reward'
    - Category: 'contribution_rewards'
    - Shows USD amount earned and points converted
*/

-- Drop existing function
DROP FUNCTION IF EXISTS admin_distribute_contribution_rewards(DATE, NUMERIC);

-- Create updated function with notifications
CREATE OR REPLACE FUNCTION admin_distribute_contribution_rewards(
  p_period_date DATE,
  p_reward_pool_usd NUMERIC
)
RETURNS TABLE (
  success BOOLEAN,
  total_distributed_usd NUMERIC,
  distributed_count INTEGER,
  scaling_applied BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_is_admin BOOLEAN;
  v_total_points BIGINT;
  v_conversion_history_id UUID;
  v_users_rewarded INTEGER := 0;
  v_total_distributed NUMERIC := 0;
  v_conversion_rate NUMERIC;
  v_min_points INTEGER;
  v_scaling_applied BOOLEAN := false;
  v_actual_rate NUMERIC;
BEGIN
  -- Get current user ID
  v_admin_id := auth.uid();
  
  -- Check if user ID is NULL
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication failed: No user session found. Please ensure you are logged in.';
  END IF;
  
  -- Check if user is admin
  SELECT (role = 'admin') INTO v_is_admin
  FROM users
  WHERE id = v_admin_id;
  
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Permission denied: Admin role required. Current user is not an admin.';
  END IF;

  -- Validate inputs
  IF p_period_date IS NULL THEN
    RAISE EXCEPTION 'Invalid input: Period date cannot be NULL';
  END IF;
  
  IF p_reward_pool_usd IS NULL OR p_reward_pool_usd <= 0 THEN
    RAISE EXCEPTION 'Invalid input: Reward pool must be greater than 0';
  END IF;

  -- Get conversion settings
  SELECT 
    cs.conversion_rate,
    cs.minimum_points_for_payout
  INTO v_conversion_rate, v_min_points
  FROM contribution_conversion_settings cs
  WHERE cs.is_active = true
  ORDER BY cs.updated_at DESC
  LIMIT 1;

  -- Default values if no settings found
  v_conversion_rate := COALESCE(v_conversion_rate, 0.001);
  v_min_points := COALESCE(v_min_points, 10);

  -- Get total eligible contribution points from listener_contribution_scores
  SELECT COALESCE(SUM(lcs.current_period_points), 0) INTO v_total_points
  FROM listener_contribution_scores lcs
  WHERE lcs.current_period_points >= v_min_points;

  -- If no points to distribute, return early
  IF v_total_points = 0 THEN
    RETURN QUERY SELECT 
      true::BOOLEAN,
      0::NUMERIC,
      0::INTEGER,
      false::BOOLEAN,
      'No eligible users found with minimum points'::TEXT;
    RETURN;
  END IF;

  -- Calculate if scaling is needed
  IF (v_total_points * v_conversion_rate) > p_reward_pool_usd THEN
    v_scaling_applied := true;
    v_actual_rate := p_reward_pool_usd / v_total_points;
  ELSE
    v_actual_rate := v_conversion_rate;
  END IF;

  -- Create conversion history record
  INSERT INTO contribution_conversion_history (
    conversion_date,
    reward_pool_usd,
    total_points_converted,
    total_users_paid,
    conversion_rate_used,
    actual_rate_applied,
    scaling_applied,
    total_distributed_usd,
    executed_by,
    status
  )
  VALUES (
    p_period_date,
    p_reward_pool_usd,
    v_total_points,
    0,
    v_conversion_rate,
    v_actual_rate,
    v_scaling_applied,
    0,
    v_admin_id,
    'processing'
  )
  RETURNING id INTO v_conversion_history_id;

  -- Create temporary table to calculate rewards
  CREATE TEMP TABLE earnings_updates AS
  SELECT 
    lcs.user_id,
    lcs.current_period_points as total_points,
    ROUND((lcs.current_period_points * v_actual_rate)::NUMERIC, 2) as reward_amount_usd
  FROM listener_contribution_scores lcs
  WHERE lcs.current_period_points >= v_min_points;

  -- Update users.total_earnings for all eligible users
  UPDATE users u
  SET 
    total_earnings = COALESCE(u.total_earnings, 0) + eu.reward_amount_usd,
    updated_at = NOW()
  FROM earnings_updates eu
  WHERE u.id = eu.user_id;

  -- Get count and total distributed
  SELECT COUNT(*)::INTEGER, COALESCE(SUM(reward_amount_usd), 0)::NUMERIC 
  INTO v_users_rewarded, v_total_distributed
  FROM earnings_updates;

  -- Send notifications to users who received rewards
  INSERT INTO notifications (
    user_id,
    type,
    category,
    title,
    message,
    metadata,
    is_read
  )
  SELECT
    eu.user_id,
    'reward',
    'contribution_rewards',
    'Contribution Rewards Received',
    'You earned $' || eu.reward_amount_usd::TEXT || ' from your ' || eu.total_points::TEXT || ' contribution points this month!',
    jsonb_build_object(
      'conversion_history_id', v_conversion_history_id,
      'period_date', p_period_date,
      'amount_usd', eu.reward_amount_usd,
      'points_converted', eu.total_points,
      'source', 'contribution_rewards'
    ),
    false
  FROM earnings_updates eu;

  -- Reset current period points for users who received rewards
  UPDATE listener_contribution_scores lcs
  SET 
    current_period_points = 0,
    last_reward_date = p_period_date,
    updated_at = NOW()
  FROM earnings_updates eu
  WHERE lcs.user_id = eu.user_id;

  -- Update conversion history with final results
  UPDATE contribution_conversion_history
  SET 
    total_users_paid = v_users_rewarded,
    total_distributed_usd = v_total_distributed,
    status = 'completed'
  WHERE id = v_conversion_history_id;

  -- Clean up temp table
  DROP TABLE earnings_updates;

  -- Return success with details
  RETURN QUERY SELECT 
    true::BOOLEAN,
    v_total_distributed,
    v_users_rewarded,
    v_scaling_applied,
    'Conversion completed successfully. Notifications sent to all recipients.'::TEXT;

EXCEPTION
  WHEN OTHERS THEN
    -- Clean up temp table if it exists
    DROP TABLE IF EXISTS earnings_updates;
    
    -- Update history if it was created
    IF v_conversion_history_id IS NOT NULL THEN
      UPDATE contribution_conversion_history
      SET status = 'failed', execution_notes = SQLERRM
      WHERE id = v_conversion_history_id;
    END IF;
    
    RAISE EXCEPTION 'Monthly conversion failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION admin_distribute_contribution_rewards TO authenticated;