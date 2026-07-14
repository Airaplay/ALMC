/*
  # Remove Playlist Approval Requirement
  
  ## Overview
  This migration removes the requirement for admin approval on public playlists.
  All public playlists will now automatically appear in the Listener Curations Section
  on the home screen for both authenticated and non-authenticated users.
  
  ## Changes
  
  1. **Updated `get_featured_playlists` Function**
     - Removed `curation_status = 'approved'` filter
     - Now returns ALL public playlists with 10+ songs
     - Sorted by play count (most popular first) and creation date
     - Accessible to both authenticated and anonymous users
  
  2. **Dropped Auto-Submit Trigger**
     - Removed trigger that auto-sets playlists to 'pending' status
     - No longer needed since approval is not required
  
  3. **Backwards Compatibility**
     - Auto-approved all existing public playlists
     - Ensures they show immediately without admin action
  
  ## Security
  - RLS policies already allow anonymous access to public playlists
  - Function remains SECURITY DEFINER for consistent access
  - No changes to insert/update/delete policies
  
  ## User Experience
  - Playlists appear instantly when made public
  - No waiting for admin approval
  - More content in Listener Curations Section
  - Better discovery for listeners
*/

-- ============================================================================
-- Step 1: Update get_featured_playlists function
-- Remove curation_status requirement, show all public playlists
-- ============================================================================

CREATE OR REPLACE FUNCTION get_featured_playlists(limit_count integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  cover_image_url text,
  song_count integer,
  play_count integer,
  curator_id uuid,
  curator_name text,
  curator_avatar text,
  featured_at timestamptz,
  created_at timestamptz
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.title,
    p.description,
    p.cover_image_url,
    p.song_count,
    p.play_count,
    p.user_id as curator_id,
    u.display_name as curator_name,
    u.avatar_url as curator_avatar,
    p.featured_at,
    p.created_at
  FROM playlists p
  JOIN users u ON p.user_id = u.id
  WHERE p.is_public = true
    AND p.song_count >= 10
  ORDER BY
    p.play_count DESC,
    p.created_at DESC
  LIMIT limit_count;
END;
$$;

-- Ensure function is accessible to everyone
GRANT EXECUTE ON FUNCTION get_featured_playlists(integer) TO authenticated, anon;

-- ============================================================================
-- Step 2: Drop auto-submit trigger (no longer needed)
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_auto_submit_playlist_curation ON playlists;
DROP FUNCTION IF EXISTS auto_submit_playlist_for_curation();

-- ============================================================================
-- Step 3: Auto-approve all existing public playlists
-- This ensures they show immediately without admin intervention
-- ============================================================================

UPDATE playlists
SET 
  curation_status = 'approved',
  featured_at = COALESCE(featured_at, now()),
  updated_at = now()
WHERE is_public = true
  AND song_count >= 10
  AND curation_status != 'approved';

-- ============================================================================
-- Step 4: Add comment explaining the curation_status field
-- ============================================================================

COMMENT ON COLUMN playlists.curation_status IS 
  'Legacy field - kept for backwards compatibility. All public playlists are now auto-featured without approval requirement.';
