/*
  # Fix admin_get_announcements function return type

  1. Changes
    - Update the admin_get_announcements function to return bigint for target_count
    - This fixes the type mismatch error when querying the function
    - Ensures proper counting of large user bases

  2. Security
    - No changes to existing security model
    - Function maintains existing security definer setting
*/

-- Drop the existing function first to avoid conflicts
DROP FUNCTION IF EXISTS admin_get_announcements(text, integer, integer);

-- Recreate the function with the correct return type for target_count
CREATE OR REPLACE FUNCTION admin_get_announcements(
  status_filter text DEFAULT NULL,
  limit_param integer DEFAULT 100,
  offset_param integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  title text,
  message text,
  link_url text,
  embedded_media_url text,
  target_type text,
  target_country_code text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  status text,
  created_at timestamptz,
  created_by uuid,
  admin_name text,
  target_count bigint  -- Changed from integer to bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  -- Return announcements with optional status filter
  RETURN QUERY
  SELECT 
    a.id,
    a.title,
    a.message,
    a.link_url,
    a.embedded_media_url,
    a.target_type,
    a.target_country_code,
    a.scheduled_at,
    a.sent_at,
    a.status,
    a.created_at,
    a.created_by,
    u.display_name as admin_name,
    CASE a.target_type
      WHEN 'all' THEN (SELECT COUNT(*) FROM users WHERE is_active = true)
      WHEN 'listener' THEN (SELECT COUNT(*) FROM users WHERE role = 'listener' AND is_active = true)
      WHEN 'creator' THEN (SELECT COUNT(*) FROM users WHERE role = 'creator' AND is_active = true)
      WHEN 'country' THEN (SELECT COUNT(*) FROM users WHERE country = a.target_country_code AND is_active = true)
      ELSE 0
    END as target_count
  FROM announcements a
  LEFT JOIN users u ON a.created_by = u.id
  WHERE 
    (status_filter IS NULL OR a.status = status_filter)
  ORDER BY 
    CASE a.status
      WHEN 'draft' THEN 1
      WHEN 'scheduled' THEN 2
      WHEN 'sent' THEN 3
      WHEN 'failed' THEN 4
    END,
    COALESCE(a.scheduled_at, a.created_at) DESC
  LIMIT limit_param
  OFFSET offset_param;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION admin_get_announcements(text, integer, integer) TO authenticated;