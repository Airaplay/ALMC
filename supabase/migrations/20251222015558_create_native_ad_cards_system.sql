/*
  # Create Native Ad Cards System

  1. New Tables
    - `native_ad_cards`
      - `id` (uuid, primary key)
      - `title` (text) - Ad title/headline
      - `description` (text) - Ad description
      - `image_url` (text) - Ad image/thumbnail URL
      - `click_url` (text) - Destination URL when ad is clicked
      - `advertiser_name` (text) - Name of advertiser
      - `placement_type` (text) - Where ad can appear (e.g., 'trending_near_you_grid', 'explore_grid')
      - `priority` (integer) - Display priority (higher = more frequent)
      - `is_active` (boolean) - Whether ad is currently active
      - `impression_count` (integer) - Total impressions
      - `click_count` (integer) - Total clicks
      - `target_countries` (text[]) - Array of country codes to target (null = all countries)
      - `target_genres` (text[]) - Array of genre IDs to target (null = all genres)
      - `created_at` (timestamptz)
      - `expires_at` (timestamptz) - When ad should stop showing

  2. Security
    - Enable RLS on `native_ad_cards` table
    - Add policy for public read access to active ads
    - Add policy for admin-only write access

  3. Indexes
    - Index on placement_type and is_active for fast queries
    - Index on expires_at for filtering expired ads
*/

-- Create native_ad_cards table
CREATE TABLE IF NOT EXISTS native_ad_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  image_url text NOT NULL,
  click_url text NOT NULL,
  advertiser_name text NOT NULL,
  placement_type text NOT NULL DEFAULT 'trending_near_you_grid',
  priority integer NOT NULL DEFAULT 1 CHECK (priority >= 1 AND priority <= 10),
  is_active boolean NOT NULL DEFAULT true,
  impression_count integer NOT NULL DEFAULT 0 CHECK (impression_count >= 0),
  click_count integer NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  target_countries text[],
  target_genres text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_native_ad_cards_placement_active 
  ON native_ad_cards(placement_type, is_active) 
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_native_ad_cards_expires_at 
  ON native_ad_cards(expires_at) 
  WHERE expires_at IS NOT NULL;

-- Enable RLS
ALTER TABLE native_ad_cards ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can view active, non-expired ads
CREATE POLICY "Public can view active native ads"
  ON native_ad_cards
  FOR SELECT
  USING (
    is_active = true 
    AND (expires_at IS NULL OR expires_at > now())
  );

-- Policy: Only admins can insert native ads
CREATE POLICY "Admins can insert native ads"
  ON native_ad_cards
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

-- Policy: Only admins can update native ads
CREATE POLICY "Admins can update native ads"
  ON native_ad_cards
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

-- Policy: Only admins can delete native ads
CREATE POLICY "Admins can delete native ads"
  ON native_ad_cards
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

-- Create function to increment impression count
CREATE OR REPLACE FUNCTION increment_native_ad_impression(ad_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE native_ad_cards
  SET impression_count = impression_count + 1
  WHERE id = ad_id;
END;
$$;

-- Create function to increment click count
CREATE OR REPLACE FUNCTION increment_native_ad_click(ad_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE native_ad_cards
  SET click_count = click_count + 1
  WHERE id = ad_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION increment_native_ad_impression TO authenticated, anon;
GRANT EXECUTE ON FUNCTION increment_native_ad_click TO authenticated, anon;
