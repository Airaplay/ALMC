/*
  # Add Featured Artists Column to Songs Table

  1. Changes
    - Add `featured_artists` column to `songs` table
      - Type: text[] (array of text)
      - Nullable: true (optional field)
      - Default: empty array
    
  2. Purpose
    - Allow songs to credit multiple featured artists
    - Support "feat." or "ft." artist attribution
    - Enable proper artist crediting in single and album uploads
    - Improve searchability and discovery by featured artist

  3. Notes
    - This field will store an array of artist names as strings
    - Frontend components will display featured artists alongside main artist
    - Backward compatible - existing songs will have NULL or empty array
*/

-- Add featured_artists column to songs table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'songs' AND column_name = 'featured_artists'
  ) THEN
    ALTER TABLE songs 
    ADD COLUMN featured_artists text[] DEFAULT '{}';
  END IF;
END $$;

-- Add index for better query performance when searching by featured artists
CREATE INDEX IF NOT EXISTS idx_songs_featured_artists 
ON songs USING GIN (featured_artists);