/*
  # Fix comment_likes foreign key to support content_comments

  1. Changes
    - Drop old foreign key constraint pointing to clip_comments
    - Add new foreign key constraint pointing to content_comments
    - This allows comment likes to work with the content_comments table

  2. Security
    - Maintains existing RLS policies
    - No data loss
*/

-- Drop the old foreign key constraint
ALTER TABLE comment_likes 
  DROP CONSTRAINT IF EXISTS comment_likes_comment_id_fkey;

-- Add new foreign key constraint pointing to content_comments
ALTER TABLE comment_likes
  ADD CONSTRAINT comment_likes_comment_id_fkey
  FOREIGN KEY (comment_id)
  REFERENCES content_comments(id)
  ON DELETE CASCADE;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id 
  ON comment_likes(comment_id);

CREATE INDEX IF NOT EXISTS idx_comment_likes_user_id_comment_id 
  ON comment_likes(user_id, comment_id);
