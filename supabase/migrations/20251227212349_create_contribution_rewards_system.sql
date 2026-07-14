/*
  # Create Contribution-Based Rewards System (AdMob Compliant)

  ## Overview
  This migration implements a compliant monetization model where:
  - Ad revenue goes ONLY to Creators (60%) and Platform (40%)
  - Listeners earn ZERO from ad revenue directly
  - Platform allocates a separate budget for community contribution rewards
  - Listener earnings are based on VALUE-ADDING activities

  ## New Tables

  ### 1. `contribution_activities`
  Tracks all contribution types and their base reward values

  ### 2. `listener_contributions`
  Records individual contribution events

  ### 3. `listener_contribution_scores`
  Aggregated contribution scores per user

  ### 4. `platform_rewards_budget`
  Tracks platform's allocation to community rewards

  ### 5. `contribution_rewards_history`
  Records actual reward payouts

  ## Security
  - Enable RLS on all tables
  - Users can read their own contributions and scores
  - Only admins can manage activities and budgets
*/

-- ================================================================
-- 1. CONTRIBUTION ACTIVITIES TABLE
-- ================================================================

CREATE TABLE IF NOT EXISTS contribution_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type text NOT NULL UNIQUE,
  activity_name text NOT NULL,
  description text NOT NULL,
  base_reward_points integer NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE contribution_activities ENABLE ROW LEVEL SECURITY;

-- Public read access for active activities
CREATE POLICY "Anyone can view active contribution activities"
  ON contribution_activities FOR SELECT
  USING (is_active = true);

-- Admin-only management
CREATE POLICY "Admins can manage contribution activities"
  ON contribution_activities FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ================================================================
-- 2. LISTENER CONTRIBUTIONS TABLE
-- ================================================================

CREATE TABLE IF NOT EXISTS listener_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  reference_id uuid,
  reference_type text,
  contribution_points integer NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_listener_contributions_user_id ON listener_contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_listener_contributions_activity_type ON listener_contributions(activity_type);
CREATE INDEX IF NOT EXISTS idx_listener_contributions_created_at ON listener_contributions(created_at);
CREATE INDEX IF NOT EXISTS idx_listener_contributions_reference ON listener_contributions(reference_id, reference_type);

ALTER TABLE listener_contributions ENABLE ROW LEVEL SECURITY;

-- Users can view their own contributions
CREATE POLICY "Users can view own contributions"
  ON listener_contributions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- System can insert contributions (via service role)
CREATE POLICY "Service role can insert contributions"
  ON listener_contributions FOR INSERT
  WITH CHECK (true);

-- Admins can view all contributions
CREATE POLICY "Admins can view all contributions"
  ON listener_contributions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ================================================================
-- 3. LISTENER CONTRIBUTION SCORES TABLE
-- ================================================================

CREATE TABLE IF NOT EXISTS listener_contribution_scores (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_points integer DEFAULT 0,
  current_period_points integer DEFAULT 0,
  playlist_creation_points integer DEFAULT 0,
  discovery_points integer DEFAULT 0,
  curation_points integer DEFAULT 0,
  engagement_points integer DEFAULT 0,
  last_reward_date date,
  updated_at timestamptz DEFAULT now()
);

-- Index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_listener_scores_current_period ON listener_contribution_scores(current_period_points DESC);
CREATE INDEX IF NOT EXISTS idx_listener_scores_total ON listener_contribution_scores(total_points DESC);

ALTER TABLE listener_contribution_scores ENABLE ROW LEVEL SECURITY;

-- Users can view their own score
CREATE POLICY "Users can view own contribution score"
  ON listener_contribution_scores FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Public leaderboard access (top contributors)
CREATE POLICY "Anyone can view contribution scores for leaderboard"
  ON listener_contribution_scores FOR SELECT
  USING (true);

-- System can update scores
CREATE POLICY "Service role can manage contribution scores"
  ON listener_contribution_scores FOR ALL
  WITH CHECK (true);

-- ================================================================
-- 4. PLATFORM REWARDS BUDGET TABLE
-- ================================================================

CREATE TABLE IF NOT EXISTS platform_rewards_budget (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_date date NOT NULL UNIQUE,
  total_budget_usd decimal(10,2) NOT NULL DEFAULT 0,
  distributed_amount_usd decimal(10,2) DEFAULT 0,
  remaining_budget_usd decimal(10,2) DEFAULT 0,
  total_points_pool bigint DEFAULT 0,
  usd_per_point decimal(10,6) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for date queries
CREATE INDEX IF NOT EXISTS idx_platform_budget_period_date ON platform_rewards_budget(period_date DESC);

ALTER TABLE platform_rewards_budget ENABLE ROW LEVEL SECURITY;

-- Admins can manage budget
CREATE POLICY "Admins can manage rewards budget"
  ON platform_rewards_budget FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Public can view current budget info
CREATE POLICY "Anyone can view rewards budget"
  ON platform_rewards_budget FOR SELECT
  USING (true);

-- ================================================================
-- 5. CONTRIBUTION REWARDS HISTORY TABLE
-- ================================================================

CREATE TABLE IF NOT EXISTS contribution_rewards_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_date date NOT NULL,
  contribution_points integer NOT NULL,
  reward_amount_usd decimal(10,2) NOT NULL,
  reward_source text DEFAULT 'platform_community_budget',
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contribution_rewards_user_id ON contribution_rewards_history(user_id);
CREATE INDEX IF NOT EXISTS idx_contribution_rewards_period ON contribution_rewards_history(period_date);
CREATE INDEX IF NOT EXISTS idx_contribution_rewards_status ON contribution_rewards_history(status);

ALTER TABLE contribution_rewards_history ENABLE ROW LEVEL SECURITY;

-- Users can view their own reward history
CREATE POLICY "Users can view own reward history"
  ON contribution_rewards_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all rewards
CREATE POLICY "Admins can view all contribution rewards"
  ON contribution_rewards_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- System can insert rewards
CREATE POLICY "Service role can manage contribution rewards"
  ON contribution_rewards_history FOR ALL
  WITH CHECK (true);

-- ================================================================
-- 6. INSERT DEFAULT CONTRIBUTION ACTIVITIES
-- ================================================================

INSERT INTO contribution_activities (activity_type, activity_name, description, base_reward_points, is_active)
VALUES
  ('playlist_created', 'Create Playlist', 'Create a new public playlist', 10, true),
  ('playlist_play', 'Playlist Gets Play', 'Your playlist is played by another user', 5, true),
  ('playlist_quality_bonus', 'Quality Playlist Bonus', 'Bonus for playlists with 50+ plays from other users', 100, true),
  ('early_discovery', 'Early Discovery', 'Add a song before it gets 100 plays that later becomes popular (1000+ plays)', 50, true),
  ('curation_featured', 'Curation Featured', 'Your listener curation is featured by admins', 200, true),
  ('curation_engagement', 'Curation Engagement', 'Your listener curation gets played by others', 10, true),
  ('daily_engagement', 'Daily Active Contributor', 'Bonus for being an active contributor (daily)', 5, true),
  ('referral_contribution', 'Referral Joins', 'Referred user becomes active contributor', 50, true)
ON CONFLICT (activity_type) DO NOTHING;

-- ================================================================
-- 7. FUNCTIONS FOR CONTRIBUTION TRACKING
-- ================================================================

-- Function to record a contribution and update scores
CREATE OR REPLACE FUNCTION record_listener_contribution(
  p_user_id uuid,
  p_activity_type text,
  p_reference_id uuid DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_points integer;
BEGIN
  -- Get base reward points for this activity
  SELECT base_reward_points INTO v_points
  FROM contribution_activities
  WHERE activity_type = p_activity_type
  AND is_active = true;

  -- If activity doesn't exist or inactive, exit
  IF v_points IS NULL THEN
    RETURN;
  END IF;

  -- Insert contribution record
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
  );

  -- Update user's contribution score
  INSERT INTO listener_contribution_scores (
    user_id,
    total_points,
    current_period_points,
    updated_at
  ) VALUES (
    p_user_id,
    v_points,
    v_points,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_points = listener_contribution_scores.total_points + v_points,
    current_period_points = listener_contribution_scores.current_period_points + v_points,
    updated_at = now();

  -- Update specific category points
  CASE p_activity_type
    WHEN 'playlist_created', 'playlist_play', 'playlist_quality_bonus' THEN
      UPDATE listener_contribution_scores
      SET playlist_creation_points = playlist_creation_points + v_points
      WHERE user_id = p_user_id;
    WHEN 'early_discovery' THEN
      UPDATE listener_contribution_scores
      SET discovery_points = discovery_points + v_points
      WHERE user_id = p_user_id;
    WHEN 'curation_featured', 'curation_engagement' THEN
      UPDATE listener_contribution_scores
      SET curation_points = curation_points + v_points
      WHERE user_id = p_user_id;
    WHEN 'daily_engagement' THEN
      UPDATE listener_contribution_scores
      SET engagement_points = engagement_points + v_points
      WHERE user_id = p_user_id;
  END CASE;

END;
$$;

-- Function to get top contributors for current period
CREATE OR REPLACE FUNCTION get_top_contributors(
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  user_id uuid,
  username text,
  avatar_url text,
  current_period_points integer,
  total_points integer,
  rank bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    lcs.user_id,
    u.username,
    u.avatar_url,
    lcs.current_period_points,
    lcs.total_points,
    ROW_NUMBER() OVER (ORDER BY lcs.current_period_points DESC) as rank
  FROM listener_contribution_scores lcs
  JOIN users u ON u.id = lcs.user_id
  WHERE lcs.current_period_points > 0
  ORDER BY lcs.current_period_points DESC
  LIMIT p_limit;
END;
$$;

-- Function to calculate and distribute rewards for a period
CREATE OR REPLACE FUNCTION admin_distribute_contribution_rewards(
  p_period_date date,
  p_budget_usd decimal
)
RETURNS TABLE (
  distributed_count integer,
  total_distributed_usd decimal
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_points bigint;
  v_usd_per_point decimal;
  v_distributed_count integer := 0;
  v_total_distributed decimal := 0;
BEGIN
  -- Verify admin
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Get total points for the period
  SELECT COALESCE(SUM(current_period_points), 0)
  INTO v_total_points
  FROM listener_contribution_scores
  WHERE current_period_points > 0;

  -- If no contributions, return
  IF v_total_points = 0 THEN
    RETURN QUERY SELECT 0, 0::decimal;
    RETURN;
  END IF;

  -- Calculate USD per point
  v_usd_per_point := p_budget_usd / v_total_points;

  -- Create or update budget record
  INSERT INTO platform_rewards_budget (
    period_date,
    total_budget_usd,
    distributed_amount_usd,
    remaining_budget_usd,
    total_points_pool,
    usd_per_point
  ) VALUES (
    p_period_date,
    p_budget_usd,
    p_budget_usd,
    0,
    v_total_points,
    v_usd_per_point
  )
  ON CONFLICT (period_date) DO UPDATE SET
    total_budget_usd = p_budget_usd,
    distributed_amount_usd = p_budget_usd,
    remaining_budget_usd = 0,
    total_points_pool = v_total_points,
    usd_per_point = v_usd_per_point,
    updated_at = now();

  -- Distribute rewards to users
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
    ROUND((current_period_points * v_usd_per_point)::numeric, 2),
    'platform_community_budget',
    'completed'
  FROM listener_contribution_scores
  WHERE current_period_points > 0
  AND (last_reward_date IS NULL OR last_reward_date < p_period_date);

  GET DIAGNOSTICS v_distributed_count = ROW_COUNT;

  SELECT COALESCE(SUM(reward_amount_usd), 0)
  INTO v_total_distributed
  FROM contribution_rewards_history
  WHERE period_date = p_period_date;

  -- Reset current period points and update last reward date
  UPDATE listener_contribution_scores
  SET
    current_period_points = 0,
    last_reward_date = p_period_date,
    updated_at = now()
  WHERE current_period_points > 0;

  RETURN QUERY SELECT v_distributed_count, v_total_distributed;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION record_listener_contribution TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_top_contributors TO authenticated, anon;
GRANT EXECUTE ON FUNCTION admin_distribute_contribution_rewards TO authenticated;

-- ================================================================
-- 8. UPDATE AD REVENUE CONFIGURATION
-- ================================================================

-- Update admob configuration to reflect new split
-- Ad revenue now: 60% creators, 40% platform (0% to listeners)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admob_configuration') THEN
    UPDATE admob_configuration
    SET
      creator_share = 0.60,
      listener_share = 0.00,
      platform_share = 0.40,
      updated_at = now()
    WHERE id IN (SELECT id FROM admob_configuration LIMIT 1);
    
    -- Add comment to document the change
    COMMENT ON TABLE admob_configuration IS 'AdMob ad revenue split: 60% to creators, 40% to platform. Listeners earn separately through contribution rewards from platform budget, NOT from ads.';
  END IF;
END $$;
