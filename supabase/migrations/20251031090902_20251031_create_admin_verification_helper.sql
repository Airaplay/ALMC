/*
  # Create Admin Verification Helper Function
  
  1. New Function
    - `is_admin()` - Helper function to check if current user is admin
    - Used by RLS policies to consistently verify admin role
    - Improves code maintainability and reduces duplication
  
  2. Security
    - SECURITY DEFINER to ensure proper permission evaluation
    - Returns boolean for clear policy evaluation
    - Safe to call from RLS policies
  
  3. Notes
    - Replaces inline admin checks in RLS policies
    - Makes it easy to modify admin verification logic in one place
    - Useful for both RLS policies and application code
*/

-- Create helper function to check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  );
$$;