/*
  # Fix Verified Badge Config RLS Policies

  1. Changes
    - Drop existing INSERT and UPDATE policies that may be too restrictive
    - Add new policies that properly allow admins to insert badge configurations
    - Ensure DELETE operations are properly handled for admin management

  2. Security
    - Only admins can read badge config
    - Only admins can insert new badge configurations
    - Only admins can update existing badge configurations
    - Only admins can delete badge configurations
    - Public access removed from SELECT policy (only authenticated admins)

  3. Notes
    - This fixes the "new row violates row-level security policy" error when uploading badges
    - Admin users with role='admin' will now be able to properly manage badge configurations
*/

-- Drop existing policies that may be too permissive or restrictive
DROP POLICY IF EXISTS "Anyone can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can update verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can insert verified badge config" ON verified_badge_config;

-- Create new, properly scoped policies

-- Admins can read verified badge config
CREATE POLICY "Admins can view verified badge config"
  ON verified_badge_config
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can insert verified badge config
CREATE POLICY "Admins can insert verified badge config"
  ON verified_badge_config
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can update verified badge config
CREATE POLICY "Admins can update verified badge config"
  ON verified_badge_config
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can delete verified badge config
CREATE POLICY "Admins can delete verified badge config"
  ON verified_badge_config
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );
