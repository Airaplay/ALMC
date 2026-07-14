/*
  # Fix Monthly Conversion Transaction Schema

  ## Problem
  The admin_distribute_contribution_rewards function was trying to insert into 
  treat_transactions with columns (reference_type, reference_id) that don't exist.
  
  Also, rewards should be credited to the live balance (main balance field), not 
  just earned_balance.

  ## Solution
  1. Update the function to use the correct treat_transactions schema
  2. Use metadata jsonb field to store reference information
  3. Credit the live balance properly
  4. Ensure balance tracking is accurate

  ## Changes
  - Update transaction insert to use existing columns
  - Store reference info in metadata jsonb field
  - Credit to live balance (balance field)
*/

-- ================================================================
-- FIX THE DISTRIBUTION FUNCTION
-- ================================================================

CREATE OR REPLACE FUNCTION admin_distribute_contribution_rewards(
  p_period_date date,
  p_reward_pool_usd decimal
)
RETURNS TABLE (
  distributed_count integer,
  total_distributed_usd decimal,
  total_points_converted bigint,
  conversion_rate_used decimal,
  actual_rate_applied decimal,
  scaling_applied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_points bigint;
  v_conversion_rate decimal;
  v_actual_rate decimal;
  v_min_points integer;
  v_max_payout_per_user decimal;
  v_distributed_count integer := 0;
  v_total_distributed decimal := 0;
  v_scaling_applied boolean := false;
  v_calculated_total decimal;
  v_conversion_history_id uuid;
  v_admin_id uuid;
  v_admin_role text;
BEGIN
  -- Get current user ID
  v_admin_id := auth.uid();
  
  -- Check if user ID is NULL
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication failed: No user session found. Please ensure you are logged in.';
  END IF;

  -- Verify user exists and get their role
  SELECT role INTO v_admin_role
  FROM users
  WHERE id = v_admin_id;
  
  IF v_admin_role IS NULL THEN
    RAISE EXCEPTION 'User not found in database. User ID: %', v_admin_id;
  END IF;
  
  IF v_admin_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required. Your role: %', v_admin_role;
  END IF;

  -- Validate inputs
  IF p_reward_pool_usd <= 0 THEN
    RAISE EXCEPTION 'Reward pool must be greater than zero';
  END IF;
  
  IF p_period_date IS NULL THEN
    RAISE EXCEPTION 'Conversion date is required';
  END IF;

  -- Get current conversion settings
  SELECT
    conversion_rate,
    minimum_points_for_payout,
    max_payout_per_user_usd
  INTO
    v_conversion_rate,
    v_min_points,
    v_max_payout_per_user
  FROM contribution_conversion_settings
  WHERE is_active = true
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_conversion_rate IS NULL THEN
    RAISE EXCEPTION 'No active conversion settings found. Please configure conversion settings first.';
  END IF;

  -- Get total eligible points for the period
  SELECT COALESCE(SUM(current_period_points), 0)
  INTO v_total_points
  FROM listener_contribution_scores
  WHERE current_period_points >= v_min_points;

  -- If no contributions, return early with success message
  IF v_total_points = 0 THEN
    RAISE NOTICE 'No eligible contributions found for this period';
    RETURN QUERY SELECT 0, 0::decimal, 0::bigint, v_conversion_rate, 0::decimal, false;
    RETURN;
  END IF;

  -- Calculate what total payout would be at conversion rate
  v_calculated_total := v_total_points * v_conversion_rate;

  -- Determine actual rate (with proportional scaling if needed)
  IF v_calculated_total > p_reward_pool_usd THEN
    -- Scale down proportionally to fit within budget
    v_actual_rate := p_reward_pool_usd / v_total_points;
    v_scaling_applied := true;
  ELSE
    -- Use standard conversion rate
    v_actual_rate := v_conversion_rate;
    v_scaling_applied := false;
  END IF;

  -- Create conversion history record
  INSERT INTO contribution_conversion_history (
    conversion_date,
    reward_pool_usd,
    total_points_converted,
    conversion_rate_used,
    actual_rate_applied,
    scaling_applied,
    executed_by,
    status
  ) VALUES (
    p_period_date,
    p_reward_pool_usd,
    v_total_points,
    v_conversion_rate,
    v_actual_rate,
    v_scaling_applied,
    v_admin_id,
    'processing'
  )
  RETURNING id INTO v_conversion_history_id;

  -- Update platform rewards budget (for historical tracking)
  INSERT INTO platform_rewards_budget (
    period_date,
    total_budget_usd,
    distributed_amount_usd,
    remaining_budget_usd,
    total_points_pool,
    usd_per_point
  ) VALUES (
    p_period_date,
    p_reward_pool_usd,
    0, -- Will be updated after distribution
    p_reward_pool_usd,
    v_total_points,
    v_actual_rate
  )
  ON CONFLICT (period_date) DO UPDATE SET
    total_budget_usd = p_reward_pool_usd,
    total_points_pool = v_total_points,
    usd_per_point = v_actual_rate,
    updated_at = now();

  -- Distribute rewards to users
  WITH eligible_users AS (
    SELECT
      user_id,
      current_period_points,
      CASE
        -- Apply per-user cap if set
        WHEN v_max_payout_per_user IS NOT NULL AND
             (current_period_points * v_actual_rate) > v_max_payout_per_user
        THEN v_max_payout_per_user
        ELSE ROUND((current_period_points * v_actual_rate)::numeric, 2)
      END as payout_usd
    FROM listener_contribution_scores
    WHERE current_period_points >= v_min_points
    AND (last_reward_date IS NULL OR last_reward_date < p_period_date)
  ),
  reward_inserts AS (
    -- Insert into contribution_rewards_history
    INSERT INTO contribution_rewards_history (
      user_id,
      period_date,
      contribution_points,
      reward_amount_usd,
      reward_source,
      status
    )
    SELECT
      user_id,
      p_period_date,
      current_period_points,
      payout_usd,
      'platform_community_budget',
      'completed'
    FROM eligible_users
    RETURNING user_id, reward_amount_usd
  ),
  wallet_updates AS (
    -- Credit treat_wallets - update BOTH earned_balance AND balance (live balance)
    UPDATE treat_wallets tw
    SET
      earned_balance = earned_balance + ri.reward_amount_usd,
      balance = balance + ri.reward_amount_usd,  -- Credit to live balance
      total_earned = total_earned + ri.reward_amount_usd,
      updated_at = now()
    FROM reward_inserts ri
    WHERE tw.user_id = ri.user_id
    RETURNING tw.user_id, ri.reward_amount_usd
  ),
  transaction_inserts AS (
    -- Log transactions using correct schema
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
      'contribution_reward',
      wu.reward_amount_usd,
      tw.balance - wu.reward_amount_usd,
      tw.balance,
      'Monthly contribution rewards for ' || p_period_date,
      jsonb_build_object(
        'conversion_history_id', v_conversion_history_id,
        'period_date', p_period_date,
        'source', 'monthly_conversion'
      ),
      'completed'
    FROM wallet_updates wu
    JOIN treat_wallets tw ON tw.user_id = wu.user_id
    RETURNING user_id, amount
  )
  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(amount), 0)
  INTO v_distributed_count, v_total_distributed
  FROM transaction_inserts;

  -- Update conversion history with results
  UPDATE contribution_conversion_history
  SET
    total_users_paid = v_distributed_count,
    total_distributed_usd = v_total_distributed,
    status = 'completed',
    execution_notes = format(
      'Successfully distributed %s USD to %s users. Scaling %s',
      v_total_distributed,
      v_distributed_count,
      CASE WHEN v_scaling_applied THEN 'applied' ELSE 'not needed' END
    )
  WHERE id = v_conversion_history_id;

  -- Update platform_rewards_budget with actual distributed amount
  UPDATE platform_rewards_budget
  SET
    distributed_amount_usd = v_total_distributed,
    remaining_budget_usd = total_budget_usd - v_total_distributed,
    updated_at = now()
  WHERE period_date = p_period_date;

  -- Reset current period points and update last reward date
  UPDATE listener_contribution_scores
  SET
    current_period_points = 0,
    last_reward_date = p_period_date,
    updated_at = now()
  WHERE current_period_points >= v_min_points;

  -- Return results
  RETURN QUERY SELECT
    v_distributed_count,
    v_total_distributed,
    v_total_points,
    v_conversion_rate,
    v_actual_rate,
    v_scaling_applied;
    
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error and re-raise with more context
    RAISE EXCEPTION 'Monthly conversion failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_distribute_contribution_rewards TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION admin_distribute_contribution_rewards IS
'Processes monthly contribution rewards conversion. Credits rewards to users live balance (main balance field) and earned_balance. Uses correct treat_transactions schema with metadata for reference tracking.';
