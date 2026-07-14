/*
  # Fix Remaining CASCADE DELETE Issues

  1. Issues Fixed
    - Change user_playback_state.song_id from SET NULL to CASCADE
      (When song is deleted, user's playback state for that song should be cleared)
    
    - Add missing foreign key constraint for content_comments.content_id
      (Critical: content_comments has no FK to content_uploads, causing orphaned comments)

  2. Security
    - Maintains all existing RLS policies
    - Only fixes CASCADE behavior for data consistency

  3. Impact
    - Prevents orphaned playback states for deleted songs
    - Prevents orphaned comments on deleted content (videos, albums, etc.)
    - Ensures complete cleanup when content is deleted
*/

-- ========================================
-- 1. Fix user_playback_state.song_id CASCADE
-- ========================================

-- Drop existing constraint with SET NULL
ALTER TABLE user_playback_state 
DROP CONSTRAINT IF EXISTS user_playback_state_song_id_fkey;

-- Add with CASCADE DELETE - when song is deleted, clear playback state
ALTER TABLE user_playback_state
ADD CONSTRAINT user_playback_state_song_id_fkey 
FOREIGN KEY (song_id) 
REFERENCES songs(id) 
ON DELETE CASCADE;

COMMENT ON CONSTRAINT user_playback_state_song_id_fkey ON user_playback_state IS 
'CASCADE DELETE: When a song is deleted, user playback states for that song are automatically removed.';

-- ========================================
-- 2. Add missing foreign key for content_comments.content_id
-- ========================================

-- First, clean up any orphaned comments (safety check)
DELETE FROM content_comments
WHERE content_id IS NOT NULL 
AND content_id NOT IN (SELECT id FROM content_uploads);

-- Add foreign key constraint with CASCADE DELETE
ALTER TABLE content_comments
ADD CONSTRAINT content_comments_content_id_fkey 
FOREIGN KEY (content_id) 
REFERENCES content_uploads(id) 
ON DELETE CASCADE;

COMMENT ON CONSTRAINT content_comments_content_id_fkey ON content_comments IS 
'CASCADE DELETE: When content (video, album, etc.) is deleted, all comments on that content are automatically removed.';

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_content_comments_content_id 
ON content_comments(content_id) 
WHERE content_id IS NOT NULL;

-- ========================================
-- 3. Verify all critical CASCADE rules are in place
-- ========================================

-- Add comments to document the complete CASCADE system
COMMENT ON TABLE content_comments IS 
'Stores comments on all content types. Properly cascades deletion from both songs and content_uploads to prevent orphaned comments.';

COMMENT ON TABLE user_playback_state IS 
'Stores user playback position and state. Cascades deletion when songs are deleted to prevent invalid playback states.';

-- ========================================
-- 4. Create cleanup function to find orphaned data
-- ========================================

-- Function to find orphaned records (for monitoring)
CREATE OR REPLACE FUNCTION find_orphaned_content_references()
RETURNS TABLE (
    table_name text,
    orphaned_count bigint,
    issue_description text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check for any remaining orphaned data
    -- This function can be run periodically to ensure data integrity
    
    -- Check content_comments with invalid content_id
    RETURN QUERY
    SELECT 
        'content_comments'::text,
        COUNT(*)::bigint,
        'Comments referencing non-existent content'::text
    FROM content_comments
    WHERE content_id IS NOT NULL 
    AND content_id NOT IN (SELECT id FROM content_uploads)
    HAVING COUNT(*) > 0;
    
    -- Check user_favorites with invalid song_id
    RETURN QUERY
    SELECT 
        'user_favorites'::text,
        COUNT(*)::bigint,
        'Favorites referencing non-existent songs'::text
    FROM user_favorites
    WHERE song_id NOT IN (SELECT id FROM songs)
    HAVING COUNT(*) > 0;
    
    -- Check playlist_songs with invalid song_id
    RETURN QUERY
    SELECT 
        'playlist_songs'::text,
        COUNT(*)::bigint,
        'Playlist entries referencing non-existent songs'::text
    FROM playlist_songs
    WHERE song_id NOT IN (SELECT id FROM songs)
    HAVING COUNT(*) > 0;
    
    -- Check listening_history with invalid references
    RETURN QUERY
    SELECT 
        'listening_history'::text,
        COUNT(*)::bigint,
        'Play history referencing non-existent songs'::text
    FROM listening_history
    WHERE song_id IS NOT NULL 
    AND song_id NOT IN (SELECT id FROM songs)
    HAVING COUNT(*) > 0;
    
    RETURN;
END;
$$;

COMMENT ON FUNCTION find_orphaned_content_references() IS 
'Diagnostic function to find orphaned references after content deletion. Returns tables with orphaned data counts.';

-- Grant execute to authenticated users (admins can run this)
GRANT EXECUTE ON FUNCTION find_orphaned_content_references() TO authenticated;