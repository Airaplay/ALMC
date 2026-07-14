/*
  # Add bio and country columns to users table

  1. Changes
    - Add `bio` column to `users` table for user biography/about section
    - Add `country` column to `users` table for user's country information
    - Add `show_artist_badge` column to control artist badge visibility
    - Both columns are nullable to maintain compatibility with existing records

  2. Security
    - No changes to existing RLS policies
    - New columns inherit existing security model
    - Users can only update their own profile information

  3. Data Migration
    - Existing records will have NULL values for new columns
    - Profile updates will populate these fields as needed
*/

-- Add bio column to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'bio'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN bio text;
  END IF;
END $$;

-- Add country column to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'country'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN country text;
  END IF;
END $$;

-- Add show_artist_badge column to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'show_artist_badge'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN show_artist_badge boolean DEFAULT true;
  END IF;
END $$;

-- Create index for country-based queries (optional, for performance)
CREATE INDEX IF NOT EXISTS idx_users_country 
ON users(country) WHERE country IS NOT NULL;

-- Create index for users with bios (optional, for performance)
CREATE INDEX IF NOT EXISTS idx_users_bio 
ON users(bio) WHERE bio IS NOT NULL;

-- Update existing users to have show_artist_badge = true by default
UPDATE users 
SET show_artist_badge = true 
WHERE show_artist_badge IS NULL;