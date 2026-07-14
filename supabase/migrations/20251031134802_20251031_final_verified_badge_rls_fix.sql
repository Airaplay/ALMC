/*
  # Final Verified Badge RLS Policy Fix

  ## Overview
  This migration consolidates all verified badge configuration RLS policies into a single,
  clean, non-conflicting set. It's designed to run AFTER all previous badge-related migrations
  and provides the definitive policy configuration.

  ## Problem Addressed
  - Multiple conflicting RLS policies from previous migrations (6+ policies)
  - Inconsistent admin verification methods (is_admin() vs inline checks)
  - "new row violates row-level security policy" error when admins upload badges
  - Migration execution order issues causing policy conflicts

  ## Solution
  1. Drop ALL existing badge policies (comprehensive cleanup)
  2. Verify is_admin() helper function exists
  3. Create exactly 4 clean policies with consistent naming:
     - SELECT: Everyone can read badge config
     - INSERT: Only admins can create
     - UPDATE: Only admins can modify
     - DELETE: Only admins can delete

  ## Security Model
  - Public read access: Required for profile badge display
  - Admin-only writes: Uses is_admin() SECURITY DEFINER function
  - Explicit schema qualification: Prevents ambiguity
  - Clear policy names: Indicates purpose at a glance

  ## Testing
  - Admin users with role='admin' in public.users can insert/update/delete
  - Non-admin users cannot perform write operations
  - All users can read badge config for display purposes
  - Creator request approval/rejection functions work without RLS errors
*/

-- Step 1: Drop ALL existing policies on verified_badge_config table
-- This comprehensively cleans up conflicting policies from previous migrations
DROP POLICY IF EXISTS "Public badge viewing" ON verified_badge_config;
DROP POLICY IF EXISTS "Public can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Authenticated users can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can insert verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can update verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can delete verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Anyone can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Only admins can insert verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Only admins can update verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Only admins can delete verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Everyone can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "verified_badge_config_select_all" ON verified_badge_config;
DROP POLICY IF EXISTS "verified_badge_config_insert_admin" ON verified_badge_config;
DROP POLICY IF EXISTS "verified_badge_config_update_admin" ON verified_badge_config;
DROP POLICY IF EXISTS "verified_badge_config_delete_admin" ON verified_badge_config;
DROP POLICY IF EXISTS "verified_badge_select_everyone" ON verified_badge_config;
DROP POLICY IF EXISTS "verified_badge_insert_admin_only" ON verified_badge_config;
DROP POLICY IF EXISTS "verified_badge_update_admin_only" ON verified_badge_config;
DROP POLICY IF EXISTS "verified_badge_delete_admin_only" ON verified_badge_config;

-- Step 2: Ensure RLS is enabled on verified_badge_config
ALTER TABLE verified_badge_config ENABLE ROW LEVEL SECURITY;

-- Step 3: Verify is_admin() helper function exists, create if needed
-- This function is SECURITY DEFINER which means it runs with the creator's permissions
-- and properly evaluates admin status even when called from RLS policies
CREATE OR REPLACE FUNCTION public.is_admin()
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

-- Step 4: Create exactly 4 clean, non-conflicting RLS policies

-- Policy 1: SELECT - Everyone (anon + authenticated) can read badge config
-- This is safe and necessary for displaying the verified badge on user profiles
CREATE POLICY "badge_select_public"
  ON verified_badge_config
  FOR SELECT
  USING (true);

-- Policy 2: INSERT - Only admins can create badge configurations
-- Uses is_admin() helper function for consistent admin verification
CREATE POLICY "badge_insert_admin_only"
  ON verified_badge_config
  FOR INSERT
  WITH CHECK (is_admin());

-- Policy 3: UPDATE - Only admins can modify badge configurations
-- Uses is_admin() helper function for both USING (select phase) and WITH CHECK (write phase)
CREATE POLICY "badge_update_admin_only"
  ON verified_badge_config
  FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- Policy 4: DELETE - Only admins can delete badge configurations
-- Uses is_admin() helper function for consistent admin verification
CREATE POLICY "badge_delete_admin_only"
  ON verified_badge_config
  FOR DELETE
  USING (is_admin());

-- Step 5: Add helpful documentation comment
COMMENT ON TABLE verified_badge_config IS 
'System-wide verified badge configuration. RLS Policy: Everyone can read badge_url for profile display. Only admins (role=admin in public.users) can insert/update/delete. Admin checks use is_admin() SECURITY DEFINER function for proper permission evaluation.';

-- Step 6: Ensure table has the default badge entry
INSERT INTO verified_badge_config (badge_url)
VALUES ('https://via.placeholder.com/24x24.png?text=V')
ON CONFLICT DO NOTHING;