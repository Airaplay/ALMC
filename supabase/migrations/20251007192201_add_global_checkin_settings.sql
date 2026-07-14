/*
  # Add Global Daily Check-in Settings

  1. New Table
    - `daily_checkin_settings`
      - `id` (uuid, primary key) - singleton row
      - `feature_enabled` (boolean) - global enable/disable for daily check-in feature
      - `ad_provider` (text) - ad provider to use (admob, unity, custom, none)
      - `ad_unit_id` (text) - ad unit ID for the provider (optional)
      - `updated_at` (timestamptz)
      - `updated_by` (uuid) - admin who made the change

  2. Security
    - Enable RLS
    - Anyone can read settings
    - Only admins can update settings

  3. Important Notes
    - Only one row should exist in this table (singleton pattern)
    - Default: feature enabled with AdMob provider
*/

-- Create daily_checkin_settings table
CREATE TABLE IF NOT EXISTS daily_checkin_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_enabled boolean DEFAULT true,
  ad_provider text DEFAULT 'admob' CHECK (ad_provider IN ('admob', 'unity', 'custom', 'none')),
  ad_unit_id text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE daily_checkin_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can read checkin settings"
  ON daily_checkin_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only admins can update checkin settings"
  ON daily_checkin_settings FOR UPDATE
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

CREATE POLICY "Only admins can insert checkin settings"
  ON daily_checkin_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Insert default settings (singleton row)
INSERT INTO daily_checkin_settings (feature_enabled, ad_provider, ad_unit_id)
VALUES (true, 'admob', NULL)
ON CONFLICT DO NOTHING;
