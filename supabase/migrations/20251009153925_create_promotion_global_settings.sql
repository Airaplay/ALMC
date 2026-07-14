/*
  # Create Promotion Global Settings Table

  1. New Tables
    - `promotion_global_settings`: Stores admin-configurable global promotion settings
      - `id` (uuid, primary key)
      - `auto_approval_enabled` (boolean) - Enable automatic approval of promotions
      - `default_duration_hours` (integer) - Default promotion duration in hours
      - `refund_on_rejection` (boolean) - Whether to refund treats on rejection
      - `promotions_enabled` (boolean) - Global toggle for promotion system
      - `min_treats_balance` (numeric) - Minimum treats balance required to promote
      - `max_active_promotions_per_user` (integer) - Max concurrent promotions per user
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on promotion_global_settings table
    - Only admins can view and update settings
    - Single row configuration table

  3. Default Values
    - Auto approval: disabled
    - Default duration: 24 hours
    - Refund on rejection: enabled
    - Promotions enabled: true
    - Min treats balance: 100
    - Max active promotions: 5
*/

-- Create promotion_global_settings table
CREATE TABLE IF NOT EXISTS promotion_global_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auto_approval_enabled boolean DEFAULT false,
  default_duration_hours integer DEFAULT 24,
  refund_on_rejection boolean DEFAULT true,
  promotions_enabled boolean DEFAULT true,
  min_treats_balance numeric DEFAULT 100,
  max_active_promotions_per_user integer DEFAULT 5,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_promotion_global_settings_enabled ON promotion_global_settings(promotions_enabled);

-- Enable RLS
ALTER TABLE promotion_global_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for promotion_global_settings table

-- Admins can view all settings
CREATE POLICY "Admins can view promotion global settings"
  ON promotion_global_settings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Admins can insert settings
CREATE POLICY "Admins can insert promotion global settings"
  ON promotion_global_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Admins can update settings
CREATE POLICY "Admins can update promotion global settings"
  ON promotion_global_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Insert default global settings (single row)
INSERT INTO promotion_global_settings (
  auto_approval_enabled,
  default_duration_hours,
  refund_on_rejection,
  promotions_enabled,
  min_treats_balance,
  max_active_promotions_per_user
) VALUES (
  false,
  24,
  true,
  true,
  100,
  5
)
ON CONFLICT DO NOTHING;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_promotion_global_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS update_promotion_global_settings_timestamp ON promotion_global_settings;
CREATE TRIGGER update_promotion_global_settings_timestamp
  BEFORE UPDATE ON promotion_global_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_promotion_global_settings_updated_at();

-- Add rejected status if not exists
DO $$
BEGIN
  ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_status_check;
  ALTER TABLE promotions ADD CONSTRAINT promotions_status_check 
    CHECK (status IN ('pending_approval', 'pending', 'active', 'completed', 'cancelled', 'rejected'));
END $$;