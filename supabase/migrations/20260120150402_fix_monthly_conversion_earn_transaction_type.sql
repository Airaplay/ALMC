/*
  # Fix Monthly Conversion Transaction Type
  
  1. Changes
    - Drop and recreate admin_distribute_contribution_rewards function
    - Use 'earn' transaction type instead of 'contribution_reward'
    - This matches the existing check constraint on treat_transactions table
  
  2. Details
    - Allowed transaction types: purchase, spend, earn, withdraw, withdrawal, tip_sent, 
      tip_received, daily_checkin, referral_bonus, promotion_refund, ad_revenue, 
      stream_revenue, promotion_spent
    - Using 'earn' for contribution reward conversions
*/

-- Drop existing function
DROP FUNCTION IF EXISTS admin_distribute_contribution_rewards(DATE, NUMERIC);

-- Recreate function with correct transaction type
CREATE OR REPLACE FUNCTION admin_distribute_contribution_rewards(
  p_period_date DATE,
  p_reward_pool_usd NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_is_admin BOOLEAN;
  v_total_points NUMERIC;
  v_conversion_history_id UUID;
  v_users_rewarded INTEGER := 0;
  v_total_distributed NUMERIC := 0;
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

  -- Get total eligible contribution points for the period
  SELECT COALESCE(SUM(contribution_points), 0) INTO v_total_points
  FROM contribution_points
  WHERE earned_at >= p_period_date 
    AND earned_at < (p_period_date + INTERVAL '1 month')
    AND contribution_points >= 10;

  -- If no points to distribute, return early
  IF v_total_points = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'users_rewarded', 0,
      'total_distributed_usd', 0,
      'message', 'No eligible users found with minimum 10 points'
    );
  END IF;

  -- Create conversion history record
  INSERT INTO monthly_conversion_history (
    period_date,
    total_points_converted,
    total_usd_distributed,
    conversion_rate,
    admin_id
  )
  VALUES (
    p_period_date,
    v_total_points,
    p_reward_pool_usd,
    p_reward_pool_usd / v_total_points,
    v_admin_id
  )
  RETURNING id INTO v_conversion_history_id;

  -- Create temporary table to calculate rewards
  CREATE TEMP TABLE wallet_updates AS
  SELECT 
    cp.user_id,
    SUM(cp.contribution_points) as total_points,
    ROUND((SUM(cp.contribution_points) / v_total_points) * p_reward_pool_usd, 2) as reward_amount_usd
  FROM contribution_points cp
  WHERE cp.earned_at >= p_period_date 
    AND cp.earned_at < (p_period_date + INTERVAL '1 month')
    AND cp.contribution_points >= 10
  GROUP BY cp.user_id
  HAVING SUM(cp.contribution_points) >= 10;

  -- Update treat_wallets for all eligible users
  UPDATE treat_wallets tw
  SET 
    balance = balance + wu.reward_amount_usd,
    earned_balance = earned_balance + wu.reward_amount_usd,
    total_earned = total_earned + wu.reward_amount_usd,
    updated_at = NOW()
  FROM wallet_updates wu
  WHERE tw.user_id = wu.user_id;

  -- Get count and total distributed
  SELECT COUNT(*), COALESCE(SUM(reward_amount_usd), 0) 
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
    'earn',  -- Changed from 'contribution_reward' to 'earn'
    wu.reward_amount_usd,
    tw.balance - wu.reward_amount_usd,
    tw.balance,
    'Monthly contribution rewards for ' || p_period_date,
    jsonb_build_object(
      'conversion_history_id', v_conversion_history_id,
      'period_date', p_period_date,
      'source', 'monthly_conversion',
      'points_converted', wu.total_points
    ),
    'completed'
  FROM wallet_updates wu
  JOIN treat_wallets tw ON tw.user_id = wu.user_id;

  -- Mark contribution points as converted
  UPDATE contribution_points cp
  SET converted_at = NOW()
  FROM wallet_updates wu
  WHERE cp.user_id = wu.user_id
    AND cp.earned_at >= p_period_date 
    AND cp.earned_at < (p_period_date + INTERVAL '1 month');

  -- Clean up temp table
  DROP TABLE wallet_updates;

  -- Return success with details
  RETURN jsonb_build_object(
    'success', true,
    'users_rewarded', v_users_rewarded,
    'total_distributed_usd', v_total_distributed,
    'conversion_history_id', v_conversion_history_id,
    'message', 'Conversion completed successfully'
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Clean up temp table if it exists
    DROP TABLE IF EXISTS wallet_updates;
    RAISE EXCEPTION 'Monthly conversion failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

-- Grant execute permission to authenticated users (admin role check is inside function)
GRANT EXECUTE ON FUNCTION admin_distribute_contribution_rewards TO authenticated;
