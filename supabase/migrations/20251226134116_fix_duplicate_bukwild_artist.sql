/*
  # Fix Duplicate Artist Entries for Bukwild Da Ikwerrian

  1. Problem
    - Two artist records exist for "Bukwild Da Ikwerrian"
    - Artist ID d35f8e90-075c-4374-8d96-6d650bdc3ace (correct - has profile and 2 followers)
    - Artist ID 49566884-0d2b-41de-a19d-f1832840a45c (orphaned - no profile, 0 followers)
    - Song "Ma Babe" uses the orphaned artist_id, causing follower count to show 0

  2. Solution
    - Update the song using orphaned artist_id to use the correct artist_id
    - Delete the orphaned artist record

  3. Changes
    - Update songs.artist_id for affected song
    - Delete orphaned artist entry
*/

-- Update song "Ma Babe" to use the correct artist_id with profile
UPDATE songs
SET artist_id = 'd35f8e90-075c-4374-8d96-6d650bdc3ace'
WHERE artist_id = '49566884-0d2b-41de-a19d-f1832840a45c'
  AND title = 'Ma Babe';

-- Verify no more songs reference the orphaned artist
DO $$
DECLARE
  remaining_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_count
  FROM songs
  WHERE artist_id = '49566884-0d2b-41de-a19d-f1832840a45c';
  
  IF remaining_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete orphaned artist - % songs still reference it', remaining_count;
  END IF;
END $$;

-- Delete the orphaned artist entry
DELETE FROM artists
WHERE id = '49566884-0d2b-41de-a19d-f1832840a45c'
  AND name = 'Bukwild Da Ikwerrian';
