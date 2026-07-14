/*
  # Fix Trending Album Section Content Types

  1. Changes
    - Remove 'song' content type from Trending Album section
    - This section only displays albums in the UI, so only album promotions should be allowed
    - This prevents confusion when users try to promote songs in this section

  2. Notes
    - The TrendingAlbumsSection component only fetches and displays albums
    - Song promotions in this section would never be visible
    - Users should use other sections like "Now Trending" or "Tracks Blowing Up" for song promotions
*/

-- Remove song content type from Trending Album section
DELETE FROM promotion_section_pricing
WHERE section_id = (
  SELECT id FROM promotion_sections WHERE section_key = 'trending_album'
)
AND content_type = 'song';

-- Verify that only album type remains
DO $$
DECLARE
  album_count integer;
  song_count integer;
BEGIN
  SELECT COUNT(*) INTO album_count
  FROM promotion_section_pricing psp
  JOIN promotion_sections ps ON psp.section_id = ps.id
  WHERE ps.section_key = 'trending_album' AND psp.content_type = 'album';
  
  SELECT COUNT(*) INTO song_count
  FROM promotion_section_pricing psp
  JOIN promotion_sections ps ON psp.section_id = ps.id
  WHERE ps.section_key = 'trending_album' AND psp.content_type = 'song';
  
  IF album_count = 0 THEN
    RAISE EXCEPTION 'Trending Album section missing album support';
  END IF;
  
  IF song_count > 0 THEN
    RAISE EXCEPTION 'Failed to remove song support from Trending Album section';
  END IF;
  
  RAISE NOTICE 'Trending Album section now only supports album promotions';
END $$;
