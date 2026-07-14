/*
  # Merge All Duplicate Artist Entries

  1. Problem
    - Multiple duplicate artist records exist with same names
    - Some have artist_profiles (correct), others are orphaned (no profile)
    - Songs using orphaned artist_ids show 0 followers instead of actual count
    - Found 14+ artists with duplicates: Peio Tees (4 entries), Di (3 entries), didi, Firechriz, Ike, Miran, etc.

  2. Solution
    - For each duplicate artist name, identify the one with artist_profile
    - Update all songs to use the correct artist_id
    - Delete orphaned artist entries

  3. Changes
    - Update songs.artist_id to use correct artist with profile
    - Update albums.artist_id to use correct artist with profile
    - Delete orphaned artist records
*/

-- Create temporary table to track correct artist_ids (ones with profiles)
CREATE TEMP TABLE correct_artists AS
SELECT DISTINCT ON (LOWER(a.name))
  LOWER(a.name) as name_lower,
  a.id as correct_artist_id,
  a.name as artist_name
FROM artists a
INNER JOIN artist_profiles ap ON a.id = ap.artist_id
WHERE ap.user_id IS NOT NULL
ORDER BY LOWER(a.name), a.created_at;

-- Update songs to use correct artist_id
UPDATE songs s
SET artist_id = ca.correct_artist_id
FROM artists a
JOIN correct_artists ca ON LOWER(a.name) = ca.name_lower
WHERE s.artist_id = a.id
  AND s.artist_id != ca.correct_artist_id;

-- Update albums to use correct artist_id (if albums reference artists directly)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'albums' AND column_name = 'artist_id') THEN
    UPDATE albums alb
    SET artist_id = ca.correct_artist_id
    FROM artists a
    JOIN correct_artists ca ON LOWER(a.name) = ca.name_lower
    WHERE alb.artist_id = a.id
      AND alb.artist_id != ca.correct_artist_id;
  END IF;
END $$;

-- Delete orphaned artist entries (those not in correct_artists list and have no profile)
DELETE FROM artists a
WHERE EXISTS (
  SELECT 1 
  FROM correct_artists ca 
  WHERE LOWER(a.name) = ca.name_lower 
  AND a.id != ca.correct_artist_id
)
AND NOT EXISTS (
  SELECT 1 FROM artist_profiles ap WHERE ap.artist_id = a.id
);

-- Drop temporary table
DROP TABLE correct_artists;
