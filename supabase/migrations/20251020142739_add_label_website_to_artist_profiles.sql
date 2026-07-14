/*
  # Add label and website fields to artist profiles

  1. Changes
    - Add `label` column to `artist_profiles` table (optional, for record label)
    - Add `website` column to `artist_profiles` table (optional, for artist website/portfolio)
    - Both columns are nullable to maintain compatibility with existing records

  2. Security
    - No changes to existing RLS policies
    - New columns inherit existing security model
    - Only artists can update their own label and website information
*/

-- Add label column to artist_profiles table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'artist_profiles' AND column_name = 'label'
  ) THEN
    ALTER TABLE artist_profiles
    ADD COLUMN label text;
  END IF;
END $$;

-- Add website column to artist_profiles table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'artist_profiles' AND column_name = 'website'
  ) THEN
    ALTER TABLE artist_profiles
    ADD COLUMN website text;
  END IF;
END $$;

-- Add a check constraint to ensure website is a valid URL if provided
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'artist_profiles_website_format'
  ) THEN
    ALTER TABLE artist_profiles
    ADD CONSTRAINT artist_profiles_website_format
    CHECK (website IS NULL OR website ~* '^https?://');
  END IF;
END $$;
