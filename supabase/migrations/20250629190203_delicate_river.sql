/*
  # Fix ambiguous column reference in admin_get_admin_users function

  1. Problem
    - The admin_get_admin_users function has an ambiguous column reference for "created_at"
    - This occurs because both the users table and admin_activity_log table have a created_at column
    - When joining these tables, PostgreSQL cannot determine which created_at column to use

  2. Solution
    - Drop and recreate the function with explicit table aliases for all columns
    - Specify "u.created_at" to clearly reference the users table's created_at column
    - Maintain the same function signature and permissions
*/

-- Drop the existing function first to avoid conflicts
DROP FUNCTION IF EXISTS admin_get_admin_users();

-- Recreate the function with explicit column references
CREATE OR REPLACE FUNCTION admin_get_admin_users()
RETURNS TABLE (
  id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role IN ('admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  -- Return admin users with explicit table aliases for all columns
  RETURN QUERY
  SELECT 
    u.id,
    u.email,
    u.display_name,
    u.role,
    u.created_at,  -- Explicitly reference the users table's created_at
    (
      SELECT MAX(al.created_at)  -- Explicitly reference the admin_activity_log table's created_at
      FROM admin_activity_log al
      WHERE al.admin_id = u.id
    ) as last_activity
  FROM users u
  WHERE u.role IN ('admin', 'manager', 'editor')
  ORDER BY 
    CASE u.role
      WHEN 'admin' THEN 1
      WHEN 'manager' THEN 2
      WHEN 'editor' THEN 3
    END,
    u.created_at DESC;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION admin_get_admin_users() TO authenticated;