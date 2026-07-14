/*
  # Add release date to songs table

  1. Changes
    - Add `release_date` column to `songs` table to support scheduled releases
    - Column is nullable to support songs without specific release dates
    - Add indexes for efficient querying of release dates

  2. Security
    - No changes to existing RLS policies
    - New column inherits existing security model
*/

-- Add release_date column to songs table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'songs' AND column_name = 'release_date'
  ) THEN
    ALTER TABLE songs 
    ADD COLUMN release_date date;
  END IF;
END $$;

-- Create index for release date queries
CREATE INDEX IF NOT EXISTS idx_songs_release_date 
ON songs(release_date);

-- Create index for songs with release dates (for filtering)
CREATE INDEX IF NOT EXISTS idx_songs_with_release_date 
ON songs(release_date) WHERE release_date IS NOT NULL;