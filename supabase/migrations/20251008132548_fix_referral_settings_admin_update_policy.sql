/*
  # Fix Referral Settings Admin Update Policy

  1. Problem
    - Admins cannot update referral settings due to missing UPDATE policy
    - Current policies only allow SELECT for authenticated users
    - Only service_role has full access, but admin users need it too

  2. Solution
    - Add UPDATE policy for admin and manager roles
    - Add INSERT policy for admin and manager roles (in case settings don't exist)
    - This allows admins to save changes to referral program settings

  3. Security
    - Restricts UPDATE/INSERT to users with 'admin' or 'manager' role only
    - Maintains read-only access for regular authenticated users
    - Service role retains full access
*/

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Admins can update referral settings" ON referral_settings;
DROP POLICY IF EXISTS "Admins can insert referral settings" ON referral_settings;

-- Allow admins and managers to update referral settings
CREATE POLICY "Admins can update referral settings"
  ON referral_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Allow admins and managers to insert referral settings (if none exist)
CREATE POLICY "Admins can insert referral settings"
  ON referral_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );
