/*
  # Fix RLS policies for all treat tables to use correct users table

  1. Changes
    - Fix treat_payment_channels admin policy
    - Fix treat_withdrawal_settings admin policy
    - All policies now correctly reference users table instead of user_profiles
  
  2. Security
    - Only users with role = 'admin' in the users table can manage these settings
*/

-- Fix treat_payment_channels admin policy
DROP POLICY IF EXISTS "Admins can manage payment channels" ON treat_payment_channels;

CREATE POLICY "Admins can manage payment channels"
  ON treat_payment_channels
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

-- Fix treat_withdrawal_settings admin policy
DROP POLICY IF EXISTS "Admins can manage withdrawal settings" ON treat_withdrawal_settings;

CREATE POLICY "Admins can manage withdrawal settings"
  ON treat_withdrawal_settings
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