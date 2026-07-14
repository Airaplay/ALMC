/*
  # Create banners table for auto-sliding homepage banners

  1. New Tables
    - `banners` - Store banner information for homepage carousel
      - `id` (uuid, primary key)
      - `title` (text, optional)
      - `subtitle` (text, required)
      - `image_url` (text, required)
      - `gradient_from` (text, required - CSS gradient class)
      - `gradient_to` (text, required - CSS gradient class)
      - `order_index` (integer, for ordering)
      - `is_active` (boolean, default true)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on banners table
    - Public can read active banners
    - Only admins can manage banners

  3. Functions
    - `get_active_banners` - Get active banners ordered by index
*/

-- Create banners table
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

-- Enable Row Level Security (RLS)
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;

-- Allow public read access to active banners
CREATE POLICY "Public can read active banners"
ON banners
FOR SELECT
TO public
USING (is_active = true);

-- Allow admins to manage banners
CREATE POLICY "Admins can manage banners"
ON banners
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND role = 'admin'
  )
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_banners_active ON banners(is_active);
CREATE INDEX IF NOT EXISTS idx_banners_order ON banners(order_index);

-- Insert sample banners (using $$ quoting to avoid escaping issues)
INSERT INTO banners (title, subtitle, image_url, gradient_from, gradient_to, order_index) VALUES
(
  'New',
  'English Songs',
  'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=800',
  'from-purple-600/80',
  'to-blue-600/80',
  0
),
(
  'Weekly',
  'TOP 20',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800',
  'from-pink-600/80',
  'to-red-600/80',
  1
),
(
  'SING ALONG WITH',
  'THE CHAINSMOKERS',
  'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=800',
  'from-green-600/80',
  'to-teal-600/80',
  2
),
(
  'All New from',
  'TAMIL TRENDING',
  'https://images.pexels.com/photos/167636/pexels-photo-167636.jpeg?auto=compress&cs=tinysrgb&w=800',
  'from-orange-600/80',
  'to-yellow-600/80',
  3
),
(
  $$This Week's$$,
  'EDM Bangers',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800',
  'from-indigo-600/80',
  'to-purple-600/80',
  4
);

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