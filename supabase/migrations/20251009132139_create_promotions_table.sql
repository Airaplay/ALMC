-- Create Promotions Table for Content Promotion System
--
-- 1. New Tables
--   - promotions: Stores user content promotion campaigns
--   - promotion_settings: Admin-managed promotion duration and pricing options
--
-- 2. Security
--   - Enable RLS on both tables
--   - Users can view and manage their own promotions
--   - Only authenticated users can create promotions
--   - Admin can view all promotions and manage settings

-- Create promotions table
CREATE TABLE IF NOT EXISTS promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  promotion_type text NOT NULL CHECK (promotion_type IN ('song', 'video', 'profile')),
  target_id uuid,
  target_title text NOT NULL,
  treats_cost numeric NOT NULL DEFAULT 0,
  duration_hours integer NOT NULL DEFAULT 24,
  duration_days integer NOT NULL DEFAULT 1,
  start_date timestamptz NOT NULL DEFAULT now(),
  end_date timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  impressions_target integer DEFAULT 0,
  impressions_actual integer DEFAULT 0,
  clicks integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create promotion_settings table for admin-managed pricing
CREATE TABLE IF NOT EXISTS promotion_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_type text NOT NULL CHECK (promotion_type IN ('song', 'video', 'profile')),
  duration_hours integer NOT NULL,
  treats_cost numeric NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(promotion_type, duration_hours)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_promotions_user_id ON promotions(user_id);
CREATE INDEX IF NOT EXISTS idx_promotions_status ON promotions(status);
CREATE INDEX IF NOT EXISTS idx_promotions_type ON promotions(promotion_type);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON promotions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_promotion_settings_type ON promotion_settings(promotion_type);
CREATE INDEX IF NOT EXISTS idx_promotion_settings_active ON promotion_settings(is_active);

-- Enable RLS
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for promotions table

-- Users can view their own promotions
CREATE POLICY "Users can view own promotions"
  ON promotions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own promotions
CREATE POLICY "Users can create own promotions"
  ON promotions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own promotions
CREATE POLICY "Users can update own promotions"
  ON promotions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins can view all promotions
CREATE POLICY "Admins can view all promotions"
  ON promotions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Admins can update all promotions
CREATE POLICY "Admins can update all promotions"
  ON promotions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- RLS Policies for promotion_settings table

-- Everyone can view active promotion settings
CREATE POLICY "Anyone can view active promotion settings"
  ON promotion_settings
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Admins can view all promotion settings
CREATE POLICY "Admins can view all promotion settings"
  ON promotion_settings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Admins can manage promotion settings
CREATE POLICY "Admins can insert promotion settings"
  ON promotion_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can update promotion settings"
  ON promotion_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can delete promotion settings"
  ON promotion_settings
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Insert default promotion settings
INSERT INTO promotion_settings (promotion_type, duration_hours, treats_cost, sort_order, is_active) VALUES
  ('song', 24, 50, 1, true),
  ('song', 72, 120, 2, true),
  ('song', 168, 200, 3, true),
  ('video', 24, 60, 1, true),
  ('video', 72, 150, 2, true),
  ('video', 168, 250, 3, true),
  ('profile', 24, 100, 1, true),
  ('profile', 72, 250, 2, true),
  ('profile', 168, 400, 3, true)
ON CONFLICT (promotion_type, duration_hours) DO NOTHING;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_promotions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for promotions
DROP TRIGGER IF EXISTS update_promotions_timestamp ON promotions;
CREATE TRIGGER update_promotions_timestamp
  BEFORE UPDATE ON promotions
  FOR EACH ROW
  EXECUTE FUNCTION update_promotions_updated_at();

-- Create trigger for promotion_settings
DROP TRIGGER IF EXISTS update_promotion_settings_timestamp ON promotion_settings;
CREATE TRIGGER update_promotion_settings_timestamp
  BEFORE UPDATE ON promotion_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_promotions_updated_at();