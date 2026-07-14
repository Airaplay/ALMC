/*
  # Fix Drex/Drexz Duplicate Artist Entries

  1. Problem
    - Two artist records exist: "Drex" and "Drexz"
    - Artist ID 02946d83-11a7-455c-a843-15ffec86bd7a (Drex) - Orphaned with 6 songs, 1 album, no profile, 0 followers
    - Artist ID 7652648c-246b-45af-b3ff-e7ac6f6c046e (Drexz) - Has profile with user, 2 followers, but no content
    - Album "Spirit In Motion" shows 0 followers because it uses orphaned artist_id

  2. Solution
    - Update all songs and albums to use the correct artist_id (Drexz with profile)
    - Delete the orphaned Drex artist record

  3. Changes
    - Update songs.artist_id for all Drex songs
    - Update albums.artist_id for Drex album
    - Delete orphaned Drex artist entry
*/

-- Update songs to use correct artist_id (Drexz with profile)
UPDATE songs
SET artist_id = '7652648c-246b-45af-b3ff-e7ac6f6c046e'
WHERE artist_id = '02946d83-11a7-455c-a843-15ffec86bd7a';

-- Update albums to use correct artist_id (Drexz with profile)
UPDATE albums
SET artist_id = '7652648c-246b-45af-b3ff-e7ac6f6c046e'
WHERE artist_id = '02946d83-11a7-455c-a843-15ffec86bd7a';

-- Verify no more content references the orphaned artist
DO $$
DECLARE
  remaining_songs INTEGER;
  remaining_albums INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_songs
  FROM songs
  WHERE artist_id = '02946d83-11a7-455c-a843-15ffec86bd7a';
  
  SELECT COUNT(*) INTO remaining_albums
  FROM albums
  WHERE artist_id = '02946d83-11a7-455c-a843-15ffec86bd7a';
  
  IF remaining_songs > 0 OR remaining_albums > 0 THEN
    RAISE EXCEPTION 'Cannot delete orphaned artist - still has % songs and % albums', remaining_songs, remaining_albums;
  END IF;
END $$;

-- Delete the orphaned artist entry
DELETE FROM artists
WHERE id = '02946d83-11a7-455c-a843-15ffec86bd7a'
  AND name = 'Drex';
