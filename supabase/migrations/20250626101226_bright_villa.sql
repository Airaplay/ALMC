/*
  # Add country field to artist profiles

  1. Changes
    - Add `country` column to `artist_profiles` table
    - Column is optional (nullable) to maintain compatibility with existing records

  2. Security
    - No changes to existing RLS policies
    - New column inherits existing security model
*/

-- Add country column to artist_profiles table
ALTER TABLE artist_profiles 
ADD COLUMN IF NOT EXISTS country text;