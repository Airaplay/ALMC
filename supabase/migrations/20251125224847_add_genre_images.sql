/*
  # Add Genre Image Support

  1. Schema Updates
    - Add `image_url` column to genres table for storing public Supabase Storage URLs
    - Add `image_path` column to genres table for storing storage path references
    - Add `updated_at` column to track when genre images are modified
    - Create index on image_url for performance

  2. Changes Made
    - Modify genres table to support custom images
    - Allow NULL values for backward compatibility
    - Add timestamp tracking for updates
    - Enable efficient queries for genres with/without custom images

  3. Storage Integration
    - Images will be stored in Supabase Storage 'genre-images' bucket
    - Path format: genre-images/{genre_id}/{timestamp}.{ext}
    - Public read access, admin-only write access via RLS
*/

-- Add image columns to genres table if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'genres' AND column_name = 'image_url'
  ) THEN
    ALTER TABLE genres ADD COLUMN image_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'genres' AND column_name = 'image_path'
  ) THEN
    ALTER TABLE genres ADD COLUMN image_path text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'genres' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE genres ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Create index on image_url for efficient queries
CREATE INDEX IF NOT EXISTS idx_genres_image_url ON genres(image_url) WHERE image_url IS NOT NULL;

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_genres_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS set_genres_updated_at ON genres;
CREATE TRIGGER set_genres_updated_at
  BEFORE UPDATE ON genres
  FOR EACH ROW
  EXECUTE FUNCTION update_genres_updated_at();

-- Add comment to document the image_url column
COMMENT ON COLUMN genres.image_url IS 'Public URL of genre image from Supabase Storage';
COMMENT ON COLUMN genres.image_path IS 'Storage path reference for genre image in Supabase Storage';
COMMENT ON COLUMN genres.updated_at IS 'Timestamp when genre was last updated';
