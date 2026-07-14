/*
  # Add Song and Album Support to Listener Curations Section

  1. Updates
    - Add 'song' (singles) content type to Listener Curations
    - Add 'album' (albums/EPs) content type to Listener Curations

  2. Pricing
    - 5 treats for 24 hours (consistent with other content types)

  3. Notes
    - Users can now promote singles, albums/EPs, and playlists in Listener Curations
    - This section is designed to showcase listener-curated content
*/

-- Add song support to Listener Curations section
INSERT INTO promotion_section_pricing (section_id, content_type, treats_cost, duration_hours, is_active)
SELECT 
  id,
  'song' as content_type,
  5 as treats_cost,
  24 as duration_hours,
  true as is_active
FROM promotion_sections
WHERE section_key = 'listener_curations'
ON CONFLICT (section_id, content_type) DO UPDATE SET
  treats_cost = EXCLUDED.treats_cost,
  duration_hours = EXCLUDED.duration_hours,
  is_active = EXCLUDED.is_active;

-- Add album support to Listener Curations section
INSERT INTO promotion_section_pricing (section_id, content_type, treats_cost, duration_hours, is_active)
SELECT 
  id,
  'album' as content_type,
  5 as treats_cost,
  24 as duration_hours,
  true as is_active
FROM promotion_sections
WHERE section_key = 'listener_curations'
ON CONFLICT (section_id, content_type) DO UPDATE SET
  treats_cost = EXCLUDED.treats_cost,
  duration_hours = EXCLUDED.duration_hours,
  is_active = EXCLUDED.is_active;

-- Verify the changes
DO $$
DECLARE
  playlist_count integer;
  song_count integer;
  album_count integer;
BEGIN
  -- Check playlist support
  SELECT COUNT(*) INTO playlist_count
  FROM promotion_section_pricing psp
  JOIN promotion_sections ps ON psp.section_id = ps.id
  WHERE ps.section_key = 'listener_curations' AND psp.content_type = 'playlist';
  
  -- Check song support
  SELECT COUNT(*) INTO song_count
  FROM promotion_section_pricing psp
  JOIN promotion_sections ps ON psp.section_id = ps.id
  WHERE ps.section_key = 'listener_curations' AND psp.content_type = 'song';
  
  -- Check album support
  SELECT COUNT(*) INTO album_count
  FROM promotion_section_pricing psp
  JOIN promotion_sections ps ON psp.section_id = ps.id
  WHERE ps.section_key = 'listener_curations' AND psp.content_type = 'album';
  
  IF playlist_count = 0 THEN
    RAISE EXCEPTION 'Listener Curations missing playlist support';
  END IF;
  
  IF song_count = 0 THEN
    RAISE EXCEPTION 'Failed to add song support to Listener Curations';
  END IF;
  
  IF album_count = 0 THEN
    RAISE EXCEPTION 'Failed to add album support to Listener Curations';
  END IF;
  
  RAISE NOTICE 'Listener Curations now supports: playlists, songs (singles), and albums';
  RAISE NOTICE 'Playlist entries: %, Song entries: %, Album entries: %', playlist_count, song_count, album_count;
END $$;
