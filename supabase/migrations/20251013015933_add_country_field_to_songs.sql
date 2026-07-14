/*
  # Add country field to songs table
  
  1. Changes
    - Add `country` column to `songs` table to store the song's origin country
    - This enables country-specific trending and discovery features
  
  2. Details
    - Column is nullable to support existing songs without country data
    - Column is indexed for efficient country-based queries
    - Defaults to NULL for existing records
*/

-- Add country column to songs table
ALTER TABLE songs
ADD COLUMN IF NOT EXISTS country text;

-- Create index for efficient country-based queries
CREATE INDEX IF NOT EXISTS idx_songs_country ON songs(country);

-- Create composite index for country + play_count queries (trending near you)
CREATE INDEX IF NOT EXISTS idx_songs_country_play_count ON songs(country, play_count DESC);
