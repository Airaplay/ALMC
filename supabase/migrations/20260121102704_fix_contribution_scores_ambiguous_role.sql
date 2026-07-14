/*
  # Fix Ambiguous Role Column in Contribution Scores

  1. Changes
    - Update admin_get_all_contribution_scores function to resolve ambiguous 'role' column reference
    - Explicitly qualify the role column with the users table alias

  2. Details
    - The error occurred because the column 'role' exists in multiple contexts
    - Fixed by ensuring all column references are explicitly qualified with table aliases
*/

-- Drop and recreate the function with explicit column qualification
DROP FUNCTION IF EXISTS admin_get_all_contribution_scores(text, text, integer, integer);

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
DECLARE
  v_is_admin boolean;
BEGIN
  -- Verify admin access using a variable to avoid ambiguity
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    lcs.user_id,
    u.username,
    u.email,
    u.display_name,
    u.avatar_url,
    u.role::text,
    lcs.total_points,
    lcs.current_period_points,
    lcs.playlist_creation_points,
    lcs.discovery_points,
    lcs.curation_points,
    lcs.engagement_points,
    lcs.last_reward_date,
    lcs.updated_at,
    (
      SELECT COUNT(*)::bigint
      FROM listener_contributions lc
      WHERE lc.user_id = lcs.user_id
    ) as total_contributions
  FROM listener_contribution_scores lcs
  INNER JOIN users u ON u.id = lcs.user_id
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION admin_get_all_contribution_scores TO authenticated;