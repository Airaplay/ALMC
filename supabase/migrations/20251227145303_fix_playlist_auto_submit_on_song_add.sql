/*
  # Fix Playlist Auto-Submit When Songs Are Added

  ## Problem
  The auto-submit trigger only runs on playlist INSERT/UPDATE, but song_count
  is updated via a trigger on playlist_songs table. This means playlists don't
  auto-submit when they reach 10 songs through adding songs.

  ## Solution
  Update the song count trigger to also check and update curation_status
  when a playlist reaches 10 songs.

  ## Changes
  1. Modify update_playlist_song_count() to check eligibility after updating count
  2. Auto-submit to 'pending' when playlist reaches 10 songs (if public + listener)
*/

-- Update the song count trigger to also handle auto-submission
CREATE OR REPLACE FUNCTION update_playlist_song_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_count integer;
  v_is_public boolean;
  v_user_role text;
  v_current_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Update song count
    UPDATE playlists
    SET song_count = song_count + 1,
        updated_at = now()
    WHERE id = NEW.playlist_id
    RETURNING song_count, is_public, curation_status INTO v_new_count, v_is_public, v_current_status;
    
    -- Check if we should auto-submit after adding this song
    IF v_new_count >= 10 AND v_is_public = true AND v_current_status = 'none' THEN
      -- Get user role
      SELECT u.role INTO v_user_role
      FROM playlists p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = NEW.playlist_id;
      
      -- Auto-submit if user is a listener
      IF v_user_role = 'listener' THEN
        UPDATE playlists
        SET curation_status = 'pending',
            updated_at = now()
        WHERE id = NEW.playlist_id;
      END IF;
    END IF;
    
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE playlists
    SET song_count = GREATEST(0, song_count - 1),
        updated_at = now()
    WHERE id = OLD.playlist_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger already exists, just replaced the function above
-- No need to recreate trigger since it still points to same function name

-- Backfill: Check existing playlists that should be auto-submitted
-- (Public playlists with 10+ songs by listeners that are still 'none')
UPDATE playlists p
SET curation_status = 'pending',
    updated_at = now()
FROM users u
WHERE p.user_id = u.id
  AND p.is_public = true
  AND p.song_count >= 10
  AND u.role = 'listener'
  AND p.curation_status = 'none';
