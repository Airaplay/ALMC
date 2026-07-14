/*
  # Add Pricing Configuration for New Promotion Sections
  
  1. Pricing Setup
    - Listener Curations: For playlists (profile type)
    - Tracks Blowing Up: For songs
    
  2. Pricing Structure
    - Competitive with existing sections
    - Based on standard platform rates
    - 24-hour minimum duration
    
  3. Content Types
    - listener_curations: profile (playlists)
    - tracks_blowing_up: song
*/

-- Add pricing for Listener Curations (playlists)
INSERT INTO promotion_section_pricing (section_id, content_type, treats_cost, duration_hours, is_active)
SELECT
  id,
  'profile' as content_type,
  300 as treats_cost,  -- 300 treats per 24 hours (competitive rate for playlist promotion)
  24 as duration_hours,
  true as is_active
FROM promotion_sections
WHERE section_key = 'listener_curations'
ON CONFLICT (section_id, content_type) DO UPDATE SET
  treats_cost = EXCLUDED.treats_cost,
  duration_hours = EXCLUDED.duration_hours,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Add pricing for Tracks Blowing Up (songs)
INSERT INTO promotion_section_pricing (section_id, content_type, treats_cost, duration_hours, is_active)
SELECT
  id,
  'song' as content_type,
  250 as treats_cost,  -- 250 treats per 24 hours (competitive rate for song promotion)
  24 as duration_hours,
  true as is_active
FROM promotion_sections
WHERE section_key = 'tracks_blowing_up'
ON CONFLICT (section_id, content_type) DO UPDATE SET
  treats_cost = EXCLUDED.treats_cost,
  duration_hours = EXCLUDED.duration_hours,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Verify pricing was added
DO $$
DECLARE
  listener_count INTEGER;
  blowing_up_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO listener_count
  FROM promotion_section_pricing pp
  JOIN promotion_sections ps ON pp.section_id = ps.id
  WHERE ps.section_key = 'listener_curations';
  
  SELECT COUNT(*) INTO blowing_up_count
  FROM promotion_section_pricing pp
  JOIN promotion_sections ps ON pp.section_id = ps.id
  WHERE ps.section_key = 'tracks_blowing_up';
  
  IF listener_count = 0 THEN
    RAISE EXCEPTION 'Failed to add pricing for listener_curations';
  END IF;
  
  IF blowing_up_count = 0 THEN
    RAISE EXCEPTION 'Failed to add pricing for tracks_blowing_up';
  END IF;
  
  RAISE NOTICE 'Successfully added pricing for both sections';
END $$;
