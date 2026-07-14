/*
  # Create banners table for admin-managed promotional content

  1. New Tables
    - `banners` - Store promotional banners for the greeting section
      - `id` (uuid, primary key)
      - `title` (text, optional)
      - `subtitle` (text, required)
      - `image_url` (text, required)
      - `gradient_from` (text, required for CSS gradient)
      - `gradient_to` (text, required for CSS gradient)
      - `order_index` (integer, for display order)
      - `is_active` (boolean, to show/hide banners)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on banners table
    - Public read access for active banners
    - Admin-only write access

  3. Sample Data
    - Insert default banners for immediate functionality
*/

-- Create banners table if it doesn't exist
CREATE TABLE IF NOT EXISTS banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  subtitle text NOT NULL,
  image_url text NOT NULL,
  gradient_from text NOT NULL,
  gradient_to text NOT NULL,
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_banners_active ON banners (is_active);
CREATE INDEX IF NOT EXISTS idx_banners_order ON banners (order_index);

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Public can read active banners" ON banners;
DROP POLICY IF EXISTS "Admins can manage banners" ON banners;

-- Create policies
CREATE POLICY "Public can read active banners"
  ON banners
  FOR SELECT
  TO public
  USING (is_active = true);

CREATE POLICY "Admins can manage banners"
  ON banners
  FOR ALL
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

-- Insert sample banners only if table is empty
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM banners LIMIT 1) THEN
    INSERT INTO banners (title, subtitle, image_url, gradient_from, gradient_to, order_index, is_active) VALUES
    ('New', 'English Songs', 'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=800', 'from-purple-600/80', 'to-blue-600/80', 0, true),
    ('Weekly', 'TOP 20', 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800', 'from-pink-600/80', 'to-red-600/80', 1, true),
    ('Trending', 'Hip Hop Hits', 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=800', 'from-orange-600/80', 'to-yellow-600/80', 2, true),
    ('Discover', 'New Artists', 'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=800', 'from-green-600/80', 'to-teal-600/80', 3, true),
    ('Featured', 'Artist Spotlight', 'https://images.pexels.com/photos/1587927/pexels-photo-1587927.jpeg?auto=compress&cs=tinysrgb&w=800', 'from-indigo-600/80', 'to-purple-600/80', 4, true);
  END IF;
END $$;

-- Function to get active banners
CREATE OR REPLACE FUNCTION get_active_banners()
RETURNS TABLE (
  id uuid,
  title text,
  subtitle text,
  image_url text,
  gradient_from text,
  gradient_to text,
  order_index integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id,
    b.title,
    b.subtitle,
    b.image_url,
    b.gradient_from,
    b.gradient_to,
    b.order_index
  FROM banners b
  WHERE b.is_active = true
  ORDER BY b.order_index ASC, b.created_at ASC;
END;
$$;

-- Grant execute permission to public
GRANT EXECUTE ON FUNCTION get_active_banners TO public;