/*
  # Add Promotion Sections and Pricing System

  1. New Tables
    - `promotion_sections`: Stores available promotion sections (e.g., Now Trending, Must Watch, etc.)
    - `promotion_section_pricing`: Stores pricing for each section based on content type

  2. Changes
    - Add `promotion_section_id` to promotions table to track which section content is promoted to
    - Add support for album and short_clip content types

  3. Security
    - Enable RLS on new tables
    - Users can view active promotion sections and pricing
    - Only admins can manage sections and pricing

  4. Content Types and Their Sections
    - Song: Now Trending, New Release, AI Recommended, Inspired By You, Trending Album
    - Video: Must Watch
    - Short Clip (Loop): Loops
    - Profile: Top Artist
    - Album: Trending Album
*/

-- Create promotion_sections table
CREATE TABLE IF NOT EXISTS promotion_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_name text NOT NULL UNIQUE,
  section_key text NOT NULL UNIQUE,
  description text,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create promotion_section_pricing table
CREATE TABLE IF NOT EXISTS promotion_section_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES promotion_sections(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('song', 'video', 'short_clip', 'profile', 'album')),
  treats_cost numeric NOT NULL DEFAULT 0,
  duration_hours integer NOT NULL DEFAULT 24,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(section_id, content_type)
);

-- Add promotion_section_id to promotions table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'promotions' AND column_name = 'promotion_section_id'
  ) THEN
    ALTER TABLE promotions ADD COLUMN promotion_section_id uuid REFERENCES promotion_sections(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Update promotion_type check constraint to include album and short_clip
DO $$
BEGIN
  -- Drop old constraint if exists
  ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_promotion_type_check;
  
  -- Add new constraint with album and short_clip
  ALTER TABLE promotions ADD CONSTRAINT promotions_promotion_type_check 
    CHECK (promotion_type IN ('song', 'video', 'profile', 'album', 'short_clip'));
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_promotion_sections_active ON promotion_sections(is_active);
CREATE INDEX IF NOT EXISTS idx_promotion_section_pricing_section ON promotion_section_pricing(section_id);
CREATE INDEX IF NOT EXISTS idx_promotion_section_pricing_content_type ON promotion_section_pricing(content_type);
CREATE INDEX IF NOT EXISTS idx_promotion_section_pricing_active ON promotion_section_pricing(is_active);
CREATE INDEX IF NOT EXISTS idx_promotions_section_id ON promotions(promotion_section_id);

-- Enable RLS
ALTER TABLE promotion_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_section_pricing ENABLE ROW LEVEL SECURITY;

-- RLS Policies for promotion_sections table

-- Everyone can view active sections
CREATE POLICY "Anyone can view active promotion sections"
  ON promotion_sections
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Admins can view all sections
CREATE POLICY "Admins can view all promotion sections"
  ON promotion_sections
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Admins can manage sections
CREATE POLICY "Admins can insert promotion sections"
  ON promotion_sections
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can update promotion sections"
  ON promotion_sections
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can delete promotion sections"
  ON promotion_sections
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- RLS Policies for promotion_section_pricing table

-- Everyone can view active pricing
CREATE POLICY "Anyone can view active promotion pricing"
  ON promotion_section_pricing
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Admins can view all pricing
CREATE POLICY "Admins can view all promotion pricing"
  ON promotion_section_pricing
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Admins can manage pricing
CREATE POLICY "Admins can insert promotion pricing"
  ON promotion_section_pricing
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can update promotion pricing"
  ON promotion_section_pricing
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can delete promotion pricing"
  ON promotion_section_pricing
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Insert default promotion sections
INSERT INTO promotion_sections (section_name, section_key, description, sort_order, is_active) VALUES
  ('Now Trending', 'now_trending', 'Feature content in the Now Trending section', 1, true),
  ('New Release', 'new_release', 'Feature content in the New Release section', 2, true),
  ('AI Recommended', 'ai_recommended', 'Feature content in the AI Recommended section', 3, true),
  ('Inspired By You', 'inspired_by_you', 'Feature content in the Inspired By You section', 4, true),
  ('Trending Album', 'trending_album', 'Feature albums in the Trending Album section', 5, true),
  ('Must Watch', 'must_watch', 'Feature videos in the Must Watch section', 6, true),
  ('Loops', 'loops', 'Feature short clips in the Loops section', 7, true),
  ('Top Artist', 'top_artist', 'Feature profiles in the Top Artist section', 8, true)
ON CONFLICT (section_key) DO NOTHING;

-- Insert default pricing for each section and content type combination
INSERT INTO promotion_section_pricing (section_id, content_type, treats_cost, duration_hours, is_active)
SELECT 
  ps.id,
  ct.content_type,
  ct.treats_cost,
  24,
  true
FROM promotion_sections ps
CROSS JOIN (
  VALUES 
    ('song', 800),
    ('album', 1200),
    ('video', 1000),
    ('short_clip', 600),
    ('profile', 1500)
) AS ct(content_type, treats_cost)
WHERE 
  (ps.section_key = 'now_trending' AND ct.content_type = 'song')
  OR (ps.section_key = 'new_release' AND ct.content_type = 'song')
  OR (ps.section_key = 'ai_recommended' AND ct.content_type = 'song')
  OR (ps.section_key = 'inspired_by_you' AND ct.content_type = 'song')
  OR (ps.section_key = 'trending_album' AND ct.content_type IN ('song', 'album'))
  OR (ps.section_key = 'must_watch' AND ct.content_type = 'video')
  OR (ps.section_key = 'loops' AND ct.content_type = 'short_clip')
  OR (ps.section_key = 'top_artist' AND ct.content_type = 'profile')
ON CONFLICT (section_id, content_type) DO NOTHING;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_promotion_sections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS update_promotion_sections_timestamp ON promotion_sections;
CREATE TRIGGER update_promotion_sections_timestamp
  BEFORE UPDATE ON promotion_sections
  FOR EACH ROW
  EXECUTE FUNCTION update_promotion_sections_updated_at();

DROP TRIGGER IF EXISTS update_promotion_section_pricing_timestamp ON promotion_section_pricing;
CREATE TRIGGER update_promotion_section_pricing_timestamp
  BEFORE UPDATE ON promotion_section_pricing
  FOR EACH ROW
  EXECUTE FUNCTION update_promotion_sections_updated_at();