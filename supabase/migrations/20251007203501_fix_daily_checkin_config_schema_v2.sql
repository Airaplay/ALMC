/*
  # Fix Daily Check-in Config Schema V2
  
  1. Schema Changes
    - Add `ad_enabled` column to `daily_checkin_config` table
    - This column controls whether to show ads before rewards on specific days
    
  2. Security Updates
    - Drop and recreate RLS policies to reference `users` table correctly
    
  3. Data Migration
    - Set default value for existing rows
*/

-- Add ad_enabled column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_checkin_config' 
    AND column_name = 'ad_enabled'
  ) THEN
    ALTER TABLE daily_checkin_config 
    ADD COLUMN ad_enabled boolean DEFAULT true;
  END IF;
END $$;

-- Update all existing rows to have ad_enabled = true
UPDATE daily_checkin_config 
SET ad_enabled = true 
WHERE ad_enabled IS NULL;

-- Drop all existing policies
DROP POLICY IF EXISTS "Only admins can manage checkin config" ON daily_checkin_config;
DROP POLICY IF EXISTS "Admins can manage checkin config" ON daily_checkin_config;
DROP POLICY IF EXISTS "Anyone can read checkin config" ON daily_checkin_config;
DROP POLICY IF EXISTS "Public can read active checkin config" ON daily_checkin_config;
DROP POLICY IF EXISTS "Everyone can read checkin config" ON daily_checkin_config;

-- Create correct RLS policies
CREATE POLICY "authenticated_users_can_read_checkin_config"
  ON daily_checkin_config FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admins_can_manage_checkin_config"
  ON daily_checkin_config FOR ALL
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
