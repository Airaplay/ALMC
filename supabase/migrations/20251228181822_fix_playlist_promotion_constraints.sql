/*
  # Fix Playlist Promotion Support - Update All Constraints

  1. Updates
    - Update CHECK constraint on promotion_section_pricing table to include 'playlist'
    - Update Listener Curations from 'profile' to 'playlist' content type
    - Add playlist support to AI Recommended section
    - Add playlist support to Trending Near You section

  2. Pricing
    - 5 treats for 24 hours (consistent with other content types)

  3. Notes
    - Regular users/listeners can now promote playlists in:
      * Listener Curations
      * AI Recommended
      * Trending Near You
*/

-- Step 1: Update CHECK constraint on promotion_section_pricing table
ALTER TABLE promotion_section_pricing
DROP CONSTRAINT IF EXISTS promotion_section_pricing_content_type_check;

ALTER TABLE promotion_section_pricing
ADD CONSTRAINT promotion_section_pricing_content_type_check
CHECK (content_type = ANY (ARRAY['song'::text, 'video'::text, 'short_clip'::text, 'profile'::text, 'album'::text, 'playlist'::text]));

-- Step 2: Update Listener Curations from profile to playlist
UPDATE promotion_section_pricing
SET content_type = 'playlist'
WHERE section_id = (
  SELECT id FROM promotion_sections 
  WHERE section_key = 'listener_curations'
) AND content_type = 'profile';

-- Step 3: Add playlist support to AI Recommended section
INSERT INTO promotion_section_pricing (section_id, content_type, treats_cost, duration_hours, is_active)
SELECT 
  id,
  'playlist' as content_type,
  5 as treats_cost,
  24 as duration_hours,
  true as is_active
FROM promotion_sections
WHERE section_key = 'ai_recommended'
ON CONFLICT (section_id, content_type) DO UPDATE SET
  treats_cost = EXCLUDED.treats_cost,
  duration_hours = EXCLUDED.duration_hours,
  is_active = EXCLUDED.is_active;

-- Step 4: Add playlist support to Trending Near You section
INSERT INTO promotion_section_pricing (section_id, content_type, treats_cost, duration_hours, is_active)
SELECT 
  id,
  'playlist' as content_type,
  5 as treats_cost,
  24 as duration_hours,
  true as is_active
FROM promotion_sections
WHERE section_key = 'trending_near_you'
ON CONFLICT (section_id, content_type) DO UPDATE SET
  treats_cost = EXCLUDED.treats_cost,
  duration_hours = EXCLUDED.duration_hours,
  is_active = EXCLUDED.is_active;

-- Verify the changes
DO $$
DECLARE
  constraint_exists boolean;
  listener_curations_count integer;
  ai_recommended_count integer;
  trending_near_you_count integer;
BEGIN
  -- Check constraint exists with playlist
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'promotion_section_pricing'
    AND con.conname = 'promotion_section_pricing_content_type_check'
    AND pg_get_constraintdef(con.oid) LIKE '%playlist%'
  ) INTO constraint_exists;
  
  IF NOT constraint_exists THEN
    RAISE EXCEPTION 'Failed to update promotion_section_pricing constraint';
  END IF;
  
  -- Check Listener Curations has playlist
  SELECT COUNT(*) INTO listener_curations_count
  FROM promotion_section_pricing psp
  JOIN promotion_sections ps ON psp.section_id = ps.id
  WHERE ps.section_key = 'listener_curations' AND psp.content_type = 'playlist';
  
  -- Check AI Recommended has playlist
  SELECT COUNT(*) INTO ai_recommended_count
  FROM promotion_section_pricing psp
  JOIN promotion_sections ps ON psp.section_id = ps.id
  WHERE ps.section_key = 'ai_recommended' AND psp.content_type = 'playlist';
  
  -- Check Trending Near You has playlist
  SELECT COUNT(*) INTO trending_near_you_count
  FROM promotion_section_pricing psp
  JOIN promotion_sections ps ON psp.section_id = ps.id
  WHERE ps.section_key = 'trending_near_you' AND psp.content_type = 'playlist';
  
  IF listener_curations_count = 0 THEN
    RAISE EXCEPTION 'Failed to add playlist support to Listener Curations';
  END IF;
  
  IF ai_recommended_count = 0 THEN
    RAISE EXCEPTION 'Failed to add playlist support to AI Recommended';
  END IF;
  
  IF trending_near_you_count = 0 THEN
    RAISE EXCEPTION 'Failed to add playlist support to Trending Near You';
  END IF;
  
  RAISE NOTICE 'Playlist promotion sections configured successfully';
  RAISE NOTICE 'Listener Curations: % playlist entries', listener_curations_count;
  RAISE NOTICE 'AI Recommended: % playlist entries', ai_recommended_count;
  RAISE NOTICE 'Trending Near You: % playlist entries', trending_near_you_count;
END $$;
