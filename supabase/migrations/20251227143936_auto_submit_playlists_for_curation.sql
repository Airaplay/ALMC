/*
  # Auto-Submit Public Playlists for Curation

  ## Overview
  Automatically submit public playlists for admin review when they meet the requirements,
  eliminating the need for a manual "Submit for Review" button.

  ## Changes
  1. Create trigger function to auto-set curation_status to 'pending' when:
     - Playlist is public (is_public = true)
     - Playlist has 10+ songs
     - User is a listener (not creator/admin)

  2. Trigger runs on:
     - INSERT: When playlist is created
     - UPDATE: When playlist is updated (becomes public or reaches 10 songs)

  ## Behavior
  - New public playlists with 10+ songs → Automatically 'pending'
  - Private playlists → Remain 'none'
  - Playlists with < 10 songs → Remain 'none'
  - Creator/admin playlists → Not auto-submitted
  - Once set to pending/approved/rejected → Status doesn't auto-change
*/

-- Create function to auto-submit eligible playlists for curation
CREATE OR REPLACE FUNCTION auto_submit_playlist_for_curation()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_role text;
BEGIN
  -- Only process if curation_status is currently 'none'
  -- This prevents overriding admin decisions (approved/rejected) or pending submissions
  IF NEW.curation_status != 'none' THEN
    RETURN NEW;
  END IF;

  -- Get user's role
  SELECT role INTO v_user_role
  FROM users
  WHERE id = NEW.user_id;

  -- Check if playlist meets eligibility criteria
  IF NEW.is_public = true
     AND NEW.song_count >= 10
     AND v_user_role = 'listener' THEN
    -- Auto-submit for curation
    NEW.curation_status := 'pending';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop trigger if it exists and recreate
DROP TRIGGER IF EXISTS trigger_auto_submit_playlist_curation ON playlists;

-- Create trigger that runs on INSERT and UPDATE
CREATE TRIGGER trigger_auto_submit_playlist_curation
  BEFORE INSERT OR UPDATE ON playlists
  FOR EACH ROW
  EXECUTE FUNCTION auto_submit_playlist_for_curation();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION auto_submit_playlist_for_curation() TO authenticated;

-- Backfill existing playlists that should be in pending status
-- Only update playlists that are:
-- 1. Public
-- 2. Have 10+ songs
-- 3. Owned by listeners
-- 4. Currently have status 'none'
UPDATE playlists p
SET curation_status = 'pending',
    updated_at = now()
FROM users u
WHERE p.user_id = u.id
  AND p.is_public = true
  AND p.song_count >= 10
  AND u.role = 'listener'
  AND p.curation_status = 'none';
