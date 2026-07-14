/*
  # Fix Contribution Rewards Distribution Function
  
  1. Problem
    - Function admin_distribute_contribution_rewards was using wrong table names:
      - contribution_points (does not exist) -> should be listener_contribution_scores
      - monthly_conversion_history (does not exist) -> should be contribution_conversion_history
  
  2. Changes
    - Rewrite admin_distribute_contribution_rewards to use correct tables
    - Use listener_contribution_scores for user points
    - Use contribution_conversion_history for recording conversions
    - Match exact column names in these tables
    - Return response format matching frontend expectations
  
  3. Tables Used
    - listener_contribution_scores: user_id, current_period_points, total_points
    - contribution_conversion_history: conversion_date, reward_pool_usd, total_points_converted, etc.
    - treat_wallets: balance, earned_balance, total_earned
    - treat_transactions: for recording individual transactions
*/

-- Drop existing function
DROP FUNCTION IF EXISTS admin_distribute_contribution_rewards(DATE, NUMERIC);

-- Create corrected function
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
  -- If total payout at conversion rate exceeds pool, apply proportional scaling
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
    0, -- Will update after
    v_conversion_rate,
    v_actual_rate,
    v_scaling_applied,
    0, -- Will update after
    v_admin_id,
    'processing'
  )
  RETURNING id INTO v_conversion_history_id;

  -- Create temporary table to calculate rewards
  CREATE TEMP TABLE wallet_updates AS
  SELECT 
    lcs.user_id,
    lcs.current_period_points as total_points,
    ROUND((lcs.current_period_points * v_actual_rate)::NUMERIC, 2) as reward_amount_usd
  FROM listener_contribution_scores lcs
  WHERE lcs.current_period_points >= v_min_points;

  -- Ensure treat_wallets exist for all eligible users
  INSERT INTO treat_wallets (user_id, balance, earned_balance, total_earned)
  SELECT wu.user_id, 0, 0, 0
  FROM wallet_updates wu
  WHERE NOT EXISTS (
    SELECT 1 FROM treat_wallets tw WHERE tw.user_id = wu.user_id
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- Update treat_wallets for all eligible users
  UPDATE treat_wallets tw
  SET 
    balance = tw.balance + wu.reward_amount_usd,
    earned_balance = tw.earned_balance + wu.reward_amount_usd,
    total_earned = tw.total_earned + wu.reward_amount_usd,
    updated_at = NOW()
  FROM wallet_updates wu
  WHERE tw.user_id = wu.user_id;

  -- Get count and total distributed
  SELECT COUNT(*)::INTEGER, COALESCE(SUM(reward_amount_usd), 0)::NUMERIC 
  INTO v_users_rewarded, v_total_distributed
  FROM wallet_updates;

  -- Insert transaction records with 'earn' transaction type
  INSERT INTO treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    metadata,
    status
  )
  SELECT
    wu.user_id,
    'earn',
    wu.reward_amount_usd,
    tw.balance - wu.reward_amount_usd,
    tw.balance,
    'Monthly contribution rewards for ' || p_period_date::TEXT,
    jsonb_build_object(
      'conversion_history_id', v_conversion_history_id,
      'period_date', p_period_date,
      'source', 'monthly_conversion',
      'points_converted', wu.total_points
    ),
    'completed'
  FROM wallet_updates wu
  JOIN treat_wallets tw ON tw.user_id = wu.user_id;

  -- Reset current period points for users who received rewards
  UPDATE listener_contribution_scores lcs
  SET 
    current_period_points = 0,
    last_reward_date = p_period_date,
    updated_at = NOW()
  FROM wallet_updates wu
  WHERE lcs.user_id = wu.user_id;

  -- Update conversion history with final results
  UPDATE contribution_conversion_history
  SET 
    total_users_paid = v_users_rewarded,
    total_distributed_usd = v_total_distributed,
    status = 'completed'
  WHERE id = v_conversion_history_id;

  -- Clean up temp table
  DROP TABLE wallet_updates;

  -- Return success with details
  RETURN QUERY SELECT 
    true::BOOLEAN,
    v_total_distributed,
    v_users_rewarded,
    v_scaling_applied,
    'Conversion completed successfully'::TEXT;

EXCEPTION
  WHEN OTHERS THEN
    -- Clean up temp table if it exists
    DROP TABLE IF EXISTS wallet_updates;
    
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
