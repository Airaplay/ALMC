/*
  # Fix Diagnostic Function - Drop and Recreate

  Drop and recreate get_user_points_today with correct column references.
*/

DROP FUNCTION IF EXISTS get_user_points_today(uuid);

CREATE FUNCTION get_user_points_today(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  total_contributions bigint,
  total_points_earned bigint,
  unique_activities bigint,
  breakdown jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_today date := CURRENT_DATE;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated or provide user_id';
  END IF;

  RETURN QUERY
  WITH activity_summary AS (
    SELECT 
      activity_type,
      COUNT(*) as contribution_count,
      SUM(contribution_points) as total_points
    FROM listener_contributions
    WHERE user_id = v_user_id
      AND created_at >= v_today
    GROUP BY activity_type
  )
  SELECT 
    COALESCE(SUM(contribution_count), 0)::bigint as total_contributions,
    COALESCE(SUM(total_points), 0)::bigint as total_points_earned,
    COUNT(DISTINCT activity_type)::bigint as unique_activities,
    COALESCE(
      jsonb_object_agg(
        activity_type,
        jsonb_build_object(
          'count', contribution_count,
          'points', total_points
        )
      ),
      '{}'::jsonb
    ) as breakdown
  FROM activity_summary;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_points_today TO authenticated;

COMMENT ON FUNCTION get_user_points_today IS
'Quick summary of points earned today with activity breakdown.';
