/*
  # Create manual blowing up artists table
  
  1. New Tables
    - `manual_blowing_up_artists` - Store manually curated artists for the "Blowing Up" section
      - `id` (uuid, primary key)
      - `artist_id` (uuid, references artists) - The artist/creator to feature
      - `display_order` (integer) - Order in which artists appear (lower = first)
      - `added_by` (uuid, references users) - Admin who added the artist
      - `added_at` (timestamptz) - When the artist was added
      - `is_active` (boolean) - Whether the entry is active
      - `notes` (text, nullable) - Optional admin notes
  
  2. Security
    - Enable RLS on manual_blowing_up_artists table
    - Only admins can insert/update/delete
    - Public can view active entries
    - Admins can view all entries
  
  3. Indexes
    - Index on is_active for efficient queries
    - Index on display_order for sorting
    - Index on artist_id for lookups
*/

-- Create manual_blowing_up_artists table
CREATE TABLE IF NOT EXISTS manual_blowing_up_artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE manual_blowing_up_artists ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Allow public to view active entries
CREATE POLICY "Public can view active manual blowing up artists"
ON manual_blowing_up_artists
FOR SELECT
TO public
USING (is_active = true);

-- Allow authenticated users (admins, managers, editors) to view all entries
CREATE POLICY "Admins can view all manual blowing up artists"
ON manual_blowing_up_artists
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'manager', 'editor')
  )
);

-- Allow admins, managers, and editors to insert
CREATE POLICY "Admins can insert manual blowing up artists"
ON manual_blowing_up_artists
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'manager', 'editor')
  )
);

-- Allow admins, managers, and editors to update
CREATE POLICY "Admins can update manual blowing up artists"
ON manual_blowing_up_artists
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'manager', 'editor')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'manager', 'editor')
  )
);

-- Allow admins, managers, and editors to delete
CREATE POLICY "Admins can delete manual blowing up artists"
ON manual_blowing_up_artists
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'manager', 'editor')
  )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_manual_blowing_up_artists_active 
ON manual_blowing_up_artists(is_active) 
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_manual_blowing_up_artists_display_order 
ON manual_blowing_up_artists(display_order, is_active);

CREATE INDEX IF NOT EXISTS idx_manual_blowing_up_artists_artist_id 
ON manual_blowing_up_artists(artist_id);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_manual_blowing_up_artists_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE TRIGGER update_manual_blowing_up_artists_updated_at
BEFORE UPDATE ON manual_blowing_up_artists
FOR EACH ROW
EXECUTE FUNCTION update_manual_blowing_up_artists_updated_at();

-- Add comment to table
COMMENT ON TABLE manual_blowing_up_artists IS 'Stores manually curated artists for the "Blowing Up" section. Manual entries coexist with auto-trending logic.';









