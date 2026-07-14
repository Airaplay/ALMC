/*
  # Add Admin Contribution Score Management
  
  1. New Features
    - Admin can view all users' contribution scores
    - Admin can manually adjust contribution scores (add/subtract)
    - All adjustments are logged with reasons
  
  2. New Tables
    - `contribution_score_adjustments` - Logs all manual adjustments by admin
  
  3. New Functions
    - `admin_get_all_contribution_scores` - Get all users with their scores
    - `admin_adjust_contribution_score` - Manually adjust user's score
  
  4. Security
    - Only admins can access and modify scores
    - All adjustments are audit-logged
*/

-- ================================================================
-- 1. CREATE ADJUSTMENTS LOG TABLE
-- ================================================================

CREATE TABLE IF NOT EXISTS contribution_score_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  points_change integer NOT NULL,
  category text CHECK (category IN ('total_points', 'current_period_points', 'playlist_creation_points', 'discovery_points', 'curation_points', 'engagement_points')),
  reason text NOT NULL,
  previous_value integer NOT NULL,
  new_value integer NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contribution_adjustments_user_id ON contribution_score_adjustments(user_id);
CREATE INDEX IF NOT EXISTS idx_contribution_adjustments_admin_id ON contribution_score_adjustments(admin_id);
CREATE INDEX IF NOT EXISTS idx_contribution_adjustments_created_at ON contribution_score_adjustments(created_at DESC);

ALTER TABLE contribution_score_adjustments ENABLE ROW LEVEL SECURITY;

-- Only admins can view adjustments
CREATE POLICY "Admins can view all contribution score adjustments"
  ON contribution_score_adjustments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Only admins can insert adjustments
CREATE POLICY "Admins can log contribution score adjustments"
  ON contribution_score_adjustments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ================================================================
-- 2. ADMIN FUNCTION: GET ALL CONTRIBUTION SCORES
-- ================================================================

CREATE OR REPLACE FUNCTION admin_get_all_contribution_scores(
  p_search text DEFAULT NULL,
  p_sort_by text DEFAULT 'current_period_points',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  username text,
  email text,
  display_name text,
  avatar_url text,
  role text,
  total_points integer,
  current_period_points integer,
  playlist_creation_points integer,
  discovery_points integer,
  curation_points integer,
  engagement_points integer,
  last_reward_date date,
  updated_at timestamptz,
  total_contributions bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify admin access
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    lcs.user_id,
    u.username,
    u.email,
    u.display_name,
    u.avatar_url,
    u.role,
    lcs.total_points,
    lcs.current_period_points,
    lcs.playlist_creation_points,
    lcs.discovery_points,
    lcs.curation_points,
    lcs.engagement_points,
    lcs.last_reward_date,
    lcs.updated_at,
    (
      SELECT COUNT(*)
      FROM listener_contributions lc
      WHERE lc.user_id = lcs.user_id
    ) as total_contributions
  FROM listener_contribution_scores lcs
  JOIN users u ON u.id = lcs.user_id
  WHERE 
    (p_search IS NULL OR 
     u.username ILIKE '%' || p_search || '%' OR
     u.email ILIKE '%' || p_search || '%' OR
     u.display_name ILIKE '%' || p_search || '%')
  ORDER BY
    CASE 
      WHEN p_sort_by = 'current_period_points' THEN lcs.current_period_points
      WHEN p_sort_by = 'total_points' THEN lcs.total_points
      WHEN p_sort_by = 'username' THEN 0
      ELSE lcs.current_period_points
    END DESC,
    CASE WHEN p_sort_by = 'username' THEN u.username ELSE '' END ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- ================================================================
-- 3. ADMIN FUNCTION: ADJUST CONTRIBUTION SCORE
-- ================================================================

CREATE OR REPLACE FUNCTION admin_adjust_contribution_score(
  p_user_id uuid,
  p_points_change integer,
  p_category text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_previous_value integer;
  v_new_value integer;
  v_result jsonb;
BEGIN
  -- Verify admin access
  SELECT id INTO v_admin_id
  FROM users
  WHERE id = auth.uid()
  AND role = 'admin';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Validate category
  IF p_category NOT IN ('total_points', 'current_period_points', 'playlist_creation_points', 
                        'discovery_points', 'curation_points', 'engagement_points') THEN
    RAISE EXCEPTION 'Invalid category. Must be one of: total_points, current_period_points, playlist_creation_points, discovery_points, curation_points, engagement_points';
  END IF;

  -- Ensure user has a contribution score record
  INSERT INTO listener_contribution_scores (user_id, total_points, current_period_points)
  VALUES (p_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Get previous value
  EXECUTE format('SELECT %I FROM listener_contribution_scores WHERE user_id = $1', p_category)
  INTO v_previous_value
  USING p_user_id;

  v_previous_value := COALESCE(v_previous_value, 0);
  v_new_value := GREATEST(0, v_previous_value + p_points_change);

  -- Update the score
  EXECUTE format(
    'UPDATE listener_contribution_scores SET %I = $1, updated_at = now() WHERE user_id = $2',
    p_category
  ) USING v_new_value, p_user_id;

  -- Also update total_points if adjusting current_period_points
  IF p_category = 'current_period_points' THEN
    UPDATE listener_contribution_scores
    SET total_points = GREATEST(0, total_points + p_points_change)
    WHERE user_id = p_user_id;
  END IF;

  -- Log the adjustment
  INSERT INTO contribution_score_adjustments (
    user_id,
    admin_id,
    points_change,
    category,
    reason,
    previous_value,
    new_value
  ) VALUES (
    p_user_id,
    v_admin_id,
    p_points_change,
    p_category,
    p_reason,
    v_previous_value,
    v_new_value
  );

  -- Return result
  v_result := jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'category', p_category,
    'previous_value', v_previous_value,
    'new_value', v_new_value,
    'points_change', p_points_change,
    'reason', p_reason
  );

  RETURN v_result;
END;
$$;

-- ================================================================
-- 4. ADMIN FUNCTION: GET USER'S ADJUSTMENT HISTORY
-- ================================================================

CREATE OR REPLACE FUNCTION admin_get_contribution_adjustments(
  p_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  username text,
  admin_id uuid,
  admin_username text,
  points_change integer,
  category text,
  reason text,
  previous_value integer,
  new_value integer,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify admin access
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    csa.id,
    csa.user_id,
    u.username,
    csa.admin_id,
    admin_u.username as admin_username,
    csa.points_change,
    csa.category,
    csa.reason,
    csa.previous_value,
    csa.new_value,
    csa.created_at
  FROM contribution_score_adjustments csa
  JOIN users u ON u.id = csa.user_id
  LEFT JOIN users admin_u ON admin_u.id = csa.admin_id
  WHERE (p_user_id IS NULL OR csa.user_id = p_user_id)
  ORDER BY csa.created_at DESC
  LIMIT p_limit;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION admin_get_all_contribution_scores TO authenticated;
GRANT EXECUTE ON FUNCTION admin_adjust_contribution_score TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_contribution_adjustments TO authenticated;