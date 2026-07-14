/*
  # Add audio URL constraint for songs data integrity

  1. Constraints
    - Ensure songs table has non-null audio_url constraint
    - Add check constraint for valid URL format

  2. Data Cleanup
    - Log any existing NULL audio_url records for admin review

  3. Notes
    - Prevents storing songs without playable audio
    - Improves app reliability by ensuring data integrity at database level
    - URLs must start with https:// or blob:
*/

-- First, log any songs with NULL audio_url (for admin review)
DO $$
DECLARE
  null_audio_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_audio_count
  FROM songs
  WHERE audio_url IS NULL OR audio_url = '';
  
  IF null_audio_count > 0 THEN
    RAISE NOTICE 'Found % songs with NULL or empty audio_url that need review', null_audio_count;
  END IF;
END $$;

-- Add constraint to songs table to ensure audio_url is not null and not empty
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'songs_audio_url_not_empty'
  ) THEN
    ALTER TABLE songs
    ADD CONSTRAINT songs_audio_url_not_empty 
    CHECK (audio_url IS NOT NULL AND audio_url != '');
  END IF;
END $$;

-- Add constraint for valid URL format (must start with https:// or blob:)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'songs_audio_url_valid_format'
  ) THEN
    ALTER TABLE songs
    ADD CONSTRAINT songs_audio_url_valid_format
    CHECK (
      audio_url ~ '^https://' OR 
      audio_url ~ '^blob:'
    );
  END IF;
END $$;

-- Create index for faster queries with non-null audio URLs
CREATE INDEX IF NOT EXISTS idx_songs_audio_url_not_null 
ON songs(id) 
WHERE audio_url IS NOT NULL AND audio_url != '';
