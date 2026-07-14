/*
  # Monthly Contribution Rewards Conversion System

  ## Overview
  This migration implements a comprehensive monthly conversion system that:
  - Allows admins to set a dynamic conversion rate (default: 0.001 USD per point)
  - Processes monthly conversions with a total reward pool budget
  - Automatically calculates proportional payouts if needed
  - Credits user's earned_balance (Treats) in treat_wallets
  - Resets current_period_points after successful conversion
  - Maintains complete historical records
  - Includes safeguards and constraints

  ## New Tables
  1. `contribution_conversion_settings` - Manages conversion rate and settings
  2. `contribution_conversion_history` - Records each monthly conversion run

  ## Updated Functions
  - `admin_distribute_contribution_rewards` - Enhanced to use conversion rate and credit treat_wallets

  ## Conversion Process
  1. Admin sets conversion rate (e.g., 0.001 USD per point = 1 Treat per point)
  2. At month end, admin inputs total reward pool (e.g., $5,000)
  3. System calculates: point_value = conversion_rate (or scaled if total > pool)
  4. Each user gets: payout = user_points × point_value
  5. Payout is added to treat_wallets.earned_balance
  6. User's current_period_points reset to 0
  7. Total_points remain intact for historical tracking
*/

-- ================================================================
-- 1. CONTRIBUTION CONVERSION SETTINGS TABLE
-- ================================================================

CREATE TABLE IF NOT EXISTS contribution_conversion_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_rate decimal(10, 6) NOT NULL DEFAULT 0.001 CHECK (conversion_rate > 0),
  -- Conversion rate: 1 point = X USD worth of Treats
  -- Default: 0.001 means 1 point = 0.001 USD = 1 Treat (if 1 Treat = $0.001)

  conversion_rate_description text DEFAULT 'Points to Treats conversion rate',
  is_active boolean DEFAULT true,

  -- Optional per-user cap (NULL = no cap)
  max_payout_per_user_usd decimal(10, 2) DEFAULT NULL,

  -- Minimum points required to be eligible for payout
  minimum_points_for_payout integer DEFAULT 10 CHECK (minimum_points_for_payout >= 0),

  -- Settings metadata
  last_updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Insert default settings
INSERT INTO contribution_conversion_settings (
  conversion_rate,
  conversion_rate_description,
  is_active,
  minimum_points_for_payout
) VALUES (
  0.001,
  'Default conversion: 1 point = 0.001 USD worth of Treats (1000 points = 1 USD)',
  true,
  10
) ON CONFLICT DO NOTHING;

-- Index
CREATE INDEX IF NOT EXISTS idx_contribution_conversion_settings_active
ON contribution_conversion_settings(is_active);

-- RLS Policies
ALTER TABLE contribution_conversion_settings ENABLE ROW LEVEL SECURITY;

-- Public can view active settings
CREATE POLICY "Anyone can view active conversion settings"
  ON contribution_conversion_settings FOR SELECT
  USING (is_active = true);

-- Admins can manage settings
CREATE POLICY "Admins can manage conversion settings"
  ON contribution_conversion_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ================================================================
-- 2. CONTRIBUTION CONVERSION HISTORY TABLE
-- ================================================================

CREATE TABLE IF NOT EXISTS contribution_conversion_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_date date NOT NULL,
  reward_pool_usd decimal(10, 2) NOT NULL CHECK (reward_pool_usd >= 0),
  total_points_converted bigint NOT NULL DEFAULT 0,
  total_users_paid integer NOT NULL DEFAULT 0,
  conversion_rate_used decimal(10, 6) NOT NULL,
  actual_rate_applied decimal(10, 6) NOT NULL,
  -- actual_rate_applied may differ from conversion_rate_used if proportional scaling applied
  scaling_applied boolean DEFAULT false,
  total_distributed_usd decimal(10, 2) NOT NULL DEFAULT 0,

  -- Metadata
  executed_by uuid REFERENCES auth.users(id),
  execution_notes text,
  status text DEFAULT 'completed' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),

  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversion_history_date
ON contribution_conversion_history(conversion_date DESC);

CREATE INDEX IF NOT EXISTS idx_conversion_history_status
ON contribution_conversion_history(status);

-- RLS Policies
ALTER TABLE contribution_conversion_history ENABLE ROW LEVEL SECURITY;

-- Users can view conversion history
CREATE POLICY "Anyone can view conversion history"
  ON contribution_conversion_history FOR SELECT
  USING (status = 'completed');

-- Admins can manage conversions
CREATE POLICY "Admins can manage conversion history"
  ON contribution_conversion_history FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ================================================================
-- 3. ENHANCED DISTRIBUTION FUNCTION
-- ================================================================

-- Drop the old function if it exists
DROP FUNCTION IF EXISTS admin_distribute_contribution_rewards(date, decimal);

-- Create the enhanced function
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
BEGIN
  -- Verify admin
  SELECT auth.uid() INTO v_admin_id;

  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = v_admin_id
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Validate inputs
  IF p_reward_pool_usd <= 0 THEN
    RAISE EXCEPTION 'Reward pool must be greater than zero';
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
    RAISE EXCEPTION 'No active conversion settings found';
  END IF;

  -- Get total eligible points for the period
  SELECT COALESCE(SUM(current_period_points), 0)
  INTO v_total_points
  FROM listener_contribution_scores
  WHERE current_period_points >= v_min_points;

  -- If no contributions, return early
  IF v_total_points = 0 THEN
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
    -- Credit treat_wallets.earned_balance
    UPDATE treat_wallets tw
    SET
      earned_balance = earned_balance + ri.reward_amount_usd,
      balance = balance + ri.reward_amount_usd,
      total_earned = total_earned + ri.reward_amount_usd,
      updated_at = now()
    FROM reward_inserts ri
    WHERE tw.user_id = ri.user_id
    RETURNING tw.user_id, ri.reward_amount_usd
  ),
  transaction_inserts AS (
    -- Log transactions
    INSERT INTO treat_transactions (
      user_id,
      transaction_type,
      amount,
      balance_before,
      balance_after,
      reference_type,
      reference_id,
      description
    )
    SELECT
      wu.user_id,
      'contribution_reward',
      wu.reward_amount_usd,
      tw.balance - wu.reward_amount_usd,
      tw.balance,
      'conversion_history',
      v_conversion_history_id,
      'Monthly contribution rewards for ' || p_period_date
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
END;
$$;

-- ================================================================
-- 4. HELPER FUNCTIONS
-- ================================================================

-- Function to update conversion rate
CREATE OR REPLACE FUNCTION admin_update_conversion_rate(
  p_new_rate decimal,
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  -- Verify admin
  SELECT auth.uid() INTO v_admin_id;

  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = v_admin_id
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Validate rate
  IF p_new_rate <= 0 THEN
    RAISE EXCEPTION 'Conversion rate must be greater than zero';
  END IF;

  -- Update active settings
  UPDATE contribution_conversion_settings
  SET
    conversion_rate = p_new_rate,
    conversion_rate_description = COALESCE(p_description, conversion_rate_description),
    last_updated_by = v_admin_id,
    updated_at = now()
  WHERE is_active = true;

  -- If no active settings exist, create one
  IF NOT FOUND THEN
    INSERT INTO contribution_conversion_settings (
      conversion_rate,
      conversion_rate_description,
      is_active,
      last_updated_by
    ) VALUES (
      p_new_rate,
      COALESCE(p_description, 'Points to Treats conversion rate'),
      true,
      v_admin_id
    );
  END IF;
END;
$$;

-- Function to get current conversion preview
CREATE OR REPLACE FUNCTION get_conversion_preview()
RETURNS TABLE (
  total_eligible_points bigint,
  estimated_payout_usd decimal,
  eligible_users_count bigint,
  conversion_rate decimal,
  minimum_points_required integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversion_rate decimal;
  v_min_points integer;
BEGIN
  -- Get current settings
  SELECT
    cs.conversion_rate,
    cs.minimum_points_for_payout
  INTO v_conversion_rate, v_min_points
  FROM contribution_conversion_settings cs
  WHERE cs.is_active = true
  ORDER BY cs.updated_at DESC
  LIMIT 1;

  -- Return preview data
  RETURN QUERY
  SELECT
    COALESCE(SUM(lcs.current_period_points), 0)::bigint as total_eligible_points,
    ROUND((COALESCE(SUM(lcs.current_period_points), 0) * v_conversion_rate)::numeric, 2) as estimated_payout_usd,
    COUNT(*)::bigint as eligible_users_count,
    v_conversion_rate,
    v_min_points
  FROM listener_contribution_scores lcs
  WHERE lcs.current_period_points >= v_min_points;
END;
$$;

-- ================================================================
-- 5. GRANT PERMISSIONS
-- ================================================================

GRANT EXECUTE ON FUNCTION admin_distribute_contribution_rewards TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_conversion_rate TO authenticated;
GRANT EXECUTE ON FUNCTION get_conversion_preview TO authenticated, anon;

-- ================================================================
-- 6. ADD COMMENTS FOR DOCUMENTATION
-- ================================================================

COMMENT ON TABLE contribution_conversion_settings IS
'Manages the monthly conversion rate for contribution points to Treats. Admins can adjust the rate to control reward economics.';

COMMENT ON TABLE contribution_conversion_history IS
'Historical record of all monthly conversion runs, including totals, rates used, and whether proportional scaling was applied.';

COMMENT ON FUNCTION admin_distribute_contribution_rewards IS
'Processes monthly contribution rewards conversion. Calculates payouts based on conversion rate, applies proportional scaling if needed, credits treat_wallets.earned_balance, and resets current_period_points.';

COMMENT ON FUNCTION admin_update_conversion_rate IS
'Updates the active conversion rate for points to Treats. Admin only.';

COMMENT ON FUNCTION get_conversion_preview IS
'Returns a preview of the current period conversion without executing it. Shows total eligible points, estimated payout, and user count.';
