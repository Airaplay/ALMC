/*
  # Add artist_id to artist_profiles table

  1. Changes
    - Add `artist_id` column to `artist_profiles` table to link with `artists` table
    - This creates a proper relationship between user-managed profiles and public artist entities
    - Column is nullable initially to maintain compatibility with existing records

  2. Security
    - No changes to existing RLS policies
    - New column inherits existing security model
*/

-- Add artist_id column to artist_profiles table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'artist_profiles' AND column_name = 'artist_id'
  ) THEN
    ALTER TABLE artist_profiles 
    ADD COLUMN artist_id uuid REFERENCES artists(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_artist_profiles_artist_id 
ON artist_profiles(artist_id);