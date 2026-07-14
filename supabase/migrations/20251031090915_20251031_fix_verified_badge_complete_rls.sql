/*
  # Complete RLS Policy Fix for Verified Badge Config
  
  1. Policy Cleanup
    - Drop all existing policies on verified_badge_config
    - Start fresh with clear, non-conflicting policies
  
  2. New Policies (Non-Conflicting)
    - SELECT: Everyone (public + authenticated) can view the badge config
    - INSERT: Only admins can create new badge configurations
    - UPDATE: Only admins can modify badge configurations
    - DELETE: Only admins can delete badge configurations
  
  3. Admin Verification
    - Uses the is_admin() helper function for consistency
    - Clear and maintainable policy logic
    - Prevents future conflicts from multiple admin checks
  
  4. Security
    - RLS remains enabled and restrictive
    - Only admins can perform write operations
    - Public can read badge for display purposes
    - All policies use consistent admin verification
  
  5. Notes
    - Addresses the issue where INSERT and UPDATE policies were missing
    - "Public badge viewing" SELECT policy has been replaced with explicit policies
    - This ensures badges display on all user profiles while maintaining admin-only writes
*/

-- Drop all existing policies on verified_badge_config to prevent conflicts
DROP POLICY IF EXISTS "Public badge viewing" ON verified_badge_config;
DROP POLICY IF EXISTS "Public can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Authenticated users can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can insert verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can update verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can delete verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Anyone can view verified badge config" ON verified_badge_config;

-- Create unified SELECT policy for public badge viewing
CREATE POLICY "Everyone can view verified badge config"
  ON verified_badge_config
  FOR SELECT
  USING (true);

-- Create INSERT policy for admin users only
CREATE POLICY "Only admins can insert verified badge config"
  ON verified_badge_config
  FOR INSERT
  WITH CHECK (is_admin());

-- Create UPDATE policy for admin users only
CREATE POLICY "Only admins can update verified badge config"
  ON verified_badge_config
  FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- Create DELETE policy for admin users only
CREATE POLICY "Only admins can delete verified badge config"
  ON verified_badge_config
  FOR DELETE
  USING (is_admin());