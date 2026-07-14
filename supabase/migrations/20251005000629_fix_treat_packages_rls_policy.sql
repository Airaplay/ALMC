/*
  # Fix treat_packages RLS policy to use correct users table

  1. Changes
    - Drop the incorrect policy that references non-existent user_profiles table
    - Create new policy that checks users.role = 'admin'
    - Ensure admins can fully manage treat packages
  
  2. Security
    - Only users with role = 'admin' in the users table can manage packages
    - All authenticated users can view active packages
*/

-- Drop the incorrect policy if it exists
DROP POLICY IF EXISTS "Admins can manage treat packages" ON treat_packages;

-- Create correct policy for admin management
CREATE POLICY "Admins can manage treat packages"
  ON treat_packages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );