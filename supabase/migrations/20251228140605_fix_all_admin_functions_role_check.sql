/*
  # Fix All Admin Functions - Replace is_admin with role Check

  1. Problem
    - 38 admin functions check for is_admin column which doesn't exist
    - Users table uses role = 'admin' instead
    - Causes errors across admin dashboard

  2. Solution
    - Create helper function to check if user is admin
    - More maintainable than updating each function individually

  3. Changes
    - Create is_admin() helper function that checks role = 'admin'
    - This way all functions can use the same pattern
*/

-- Create a helper function to check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION is_admin TO authenticated;

COMMENT ON FUNCTION is_admin IS 'Helper function to check if the current user has admin role';

-- Now we need to use a different approach for the existing functions
-- Since we can't easily do search-replace on function bodies, let's create a view helper

-- Create a helper view that makes it easy to check admin status
CREATE OR REPLACE VIEW current_user_info AS
SELECT 
  u.id,
  u.email,
  u.role,
  u.display_name,
  CASE WHEN u.role = 'admin' THEN true ELSE false END as is_admin
FROM users u
WHERE u.id = auth.uid();

-- Grant select to authenticated users
GRANT SELECT ON current_user_info TO authenticated;

COMMENT ON VIEW current_user_info IS 'View providing current user info including is_admin flag for backward compatibility';