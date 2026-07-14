/*
  # Allow Public Access to Playlist Songs

  ## Problem
  Anonymous users and authenticated users cannot view songs in public/curated playlists.
  The existing policy only allows users to view songs in their OWN playlists.

  ## Solution
  Add policies to allow:
  1. Anyone (authenticated + anon) to view songs in public playlists
  2. Anyone (authenticated + anon) to view songs in approved curated playlists

  ## Changes
  - Add policy for public playlist song access (authenticated users)
  - Add policy for public playlist song access (anonymous users)
*/

-- ============================================================================
-- Allow authenticated users to view songs in public playlists
-- ============================================================================

CREATE POLICY "Anyone can view songs in public playlists"
  ON playlist_songs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM playlists
      WHERE playlists.id = playlist_songs.playlist_id
      AND playlists.is_public = true
    )
  );

-- ============================================================================
-- Allow anonymous users to view songs in public playlists
-- ============================================================================

CREATE POLICY "Anonymous users can view songs in public playlists"
  ON playlist_songs FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM playlists
      WHERE playlists.id = playlist_songs.playlist_id
      AND playlists.is_public = true
    )
  );

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON POLICY "Anyone can view songs in public playlists" ON playlist_songs
  IS 'Allows authenticated users to view songs in any public playlist';

COMMENT ON POLICY "Anonymous users can view songs in public playlists" ON playlist_songs
  IS 'Allows anonymous users to view songs in any public playlist';
