/*
  # Add Playlist, Album, and Short_Clip Promotion Types

  1. Updates
    - Add 'playlist', 'album', and 'short_clip' to promotion_type CHECK constraint in promotions table
    - Add 'playlist', 'album', and 'short_clip' to promotion_type CHECK constraint in promotion_settings table

  2. Changes
    - Enables playlist promotions for Listener Curations section
    - Enables album and short_clip promotions for future use
    - Maintains backward compatibility with existing promotion types

  3. Notes
    - Playlists can now be promoted in the "Listener Curations" section
    - Regular users/listeners can promote their created playlists
*/

-- Drop existing CHECK constraints and add new ones with additional types

-- Update promotions table
ALTER TABLE promotions
DROP CONSTRAINT IF EXISTS promotions_promotion_type_check;

ALTER TABLE promotions
ADD CONSTRAINT promotions_promotion_type_check
CHECK (promotion_type IN ('song', 'video', 'profile', 'album', 'short_clip', 'playlist'));

-- Update promotion_settings table (if it exists)
ALTER TABLE promotion_settings
DROP CONSTRAINT IF EXISTS promotion_settings_promotion_type_check;

ALTER TABLE promotion_settings
ADD CONSTRAINT promotion_settings_promotion_type_check
CHECK (promotion_type IN ('song', 'video', 'profile', 'album', 'short_clip', 'playlist'));

-- Verify the migration
DO $$
DECLARE
  promotions_check_exists boolean;
  settings_check_exists boolean;
BEGIN
  -- Check if promotions constraint exists
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'promotions_promotion_type_check'
  ) INTO promotions_check_exists;

  IF NOT promotions_check_exists THEN
    RAISE EXCEPTION 'Failed to add promotion_type constraint to promotions table';
  END IF;

  -- Check if settings constraint exists
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'promotion_settings_promotion_type_check'
  ) INTO settings_check_exists;

  IF NOT settings_check_exists THEN
    RAISE EXCEPTION 'Failed to add promotion_type constraint to promotion_settings table';
  END IF;

  RAISE NOTICE 'Playlist promotion type successfully added to database schema';
END $$;
