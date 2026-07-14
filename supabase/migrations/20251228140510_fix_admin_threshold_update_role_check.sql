/*
  # Fix Admin Threshold Update Function - Use Correct Role Column

  1. Problem
    - Function checks for is_admin column which doesn't exist
    - Users table uses role = 'admin' instead
    - Causes error: "column is_admin does not exist"

  2. Solution
    - Update admin_update_section_threshold to check role = 'admin'
    - Fix all other admin functions that might have the same issue

  3. Changes
    - Replace is_admin = true check with role = 'admin'
    - Maintain all other functionality
*/

-- Fix the threshold update function
CREATE OR REPLACE FUNCTION admin_update_section_threshold(
  section_key_param TEXT,
  min_play_count_param INT,
  min_like_count_param INT,
  time_window_days_param INT,
  is_enabled_param BOOLEAN,
  notes_param TEXT DEFAULT NULL
)
RETURNS TABLE(
  section_key TEXT,
  section_name TEXT,
  min_play_count INT,
  min_like_count INT,
  time_window_days INT,
  is_enabled BOOLEAN,
  use_fallback BOOLEAN,
  notes TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  computed_use_fallback BOOLEAN;
BEGIN
  -- Only admins can update thresholds (use role column, not is_admin)
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Auto-determine use_fallback based on threshold
  -- High thresholds = no fallback (admin wants strict filtering)
  -- Low thresholds = allow fallback (for new apps with little content)
  computed_use_fallback := CASE
    WHEN min_play_count_param > 100 THEN false
    ELSE true
  END;

  -- Update the threshold
  UPDATE content_section_thresholds
  SET
    min_play_count = min_play_count_param,
    min_like_count = min_like_count_param,
    time_window_days = time_window_days_param,
    is_enabled = is_enabled_param,
    use_fallback = computed_use_fallback,
    notes = notes_param,
    updated_at = NOW()
  WHERE content_section_thresholds.section_key = section_key_param;

  -- Return updated row
  RETURN QUERY
  SELECT
    cst.section_key,
    cst.section_name,
    cst.min_play_count,
    cst.min_like_count,
    cst.time_window_days,
    cst.is_enabled,
    cst.use_fallback,
    cst.notes,
    cst.updated_at
  FROM content_section_thresholds cst
  WHERE cst.section_key = section_key_param;
END;
$$;

-- Grant execute permission to authenticated users (admin check is inside function)
GRANT EXECUTE ON FUNCTION admin_update_section_threshold TO authenticated;