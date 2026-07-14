/*
  # Update songs country based on artist location
  
  1. Purpose
    - Populate the `country` field for existing songs based on their artist's country
    - This enables country-specific features like "Trending Near You"
  
  2. Changes
    - Update all songs where country is NULL
    - Set song country to match the artist's country from artist_profiles
    - Only updates songs that have an associated artist with a country set
  
  3. Details
    - Uses a single UPDATE statement with JOIN to artist_profiles
    - Safe to run multiple times (idempotent)
    - Only affects songs with NULL country values
    - Preserves manually set country values
  
  4. Notes
    - Songs without an artist profile or artist without country remain NULL
    - Future songs should have country set automatically via application logic
*/

-- Update songs country based on artist's country from artist_profiles
UPDATE songs
SET country = ap.country
FROM artist_profiles ap
WHERE songs.artist_id = ap.user_id
  AND songs.country IS NULL
  AND ap.country IS NOT NULL;