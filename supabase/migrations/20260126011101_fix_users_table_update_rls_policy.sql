/*
  # Fix Users Table UPDATE RLS Policy - Critical Security Fix

  1. Security Changes
    - Add strict UPDATE policy to users table
    - Prevent non-admin users from changing roles
    - Prevent privilege escalation attacks
    - Allow users to update only their own non-sensitive fields

  2. Changes
    - Drop existing permissive UPDATE policies if any
    - Create restricted UPDATE policy for role changes (admin only)
    - Create safe UPDATE policy for non-sensitive fields (own profile only)
    - Ensure role field cannot be modified unless by admin

  ## Critical Vulnerability Fixed
  Previously, any authenticated user could update their role to 'admin':
  ```sql
  UPDATE users SET role = 'admin' WHERE id = auth.uid();
  ```
  This migration prevents that attack vector.
*/

-- Drop existing permissive policies if any
DROP POLICY IF EXISTS "Users can update own profile" ON users;
DROP POLICY IF EXISTS "Users can update their own data" ON users;
DROP POLICY IF EXISTS "users_update_own_profile_safe_fields" ON users;

-- Create strict UPDATE policy that prevents role changes
CREATE POLICY "users_can_update_own_non_sensitive_fields" ON users
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
  )
  WITH CHECK (
    id = auth.uid()
    AND 
    -- Ensure role isn't being changed (must match current value)
    role = (SELECT role FROM users WHERE id = auth.uid())
  );

-- Create admin-only policy for role changes and sensitive operations
CREATE POLICY "admins_can_update_any_user" ON users
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Add index for performance on role checks
CREATE INDEX IF NOT EXISTS idx_users_role_auth 
ON users(id, role) 
WHERE role = 'admin';

-- Log this security fix
DO $$
BEGIN
  RAISE NOTICE 'Users table UPDATE RLS policy fixed - Privilege escalation vulnerability patched';
END $$;
