/*
  # Add comment likes functionality

  1. New Table
    - `comment_likes` - Store likes for comments
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `comment_id` (uuid, references clip_comments)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on comment_likes table
    - Add policies for insert, delete, and select
    - Users can only like/unlike their own likes
    - Anyone can view like counts

  3. Functions
    - `get_comment_likes_count` - Get like count for a comment
    - `is_comment_liked_by_user` - Check if user has liked a comment

  4. Indexes
    - Add indexes for performance optimization
*/

-- Create comment_likes table
CREATE TABLE IF NOT EXISTS comment_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES clip_comments(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, comment_id)
);

-- Enable Row Level Security (RLS)
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_comment_likes_user_id ON comment_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_created_at ON comment_likes(created_at);

-- RLS Policies for comment_likes table
CREATE POLICY "Users can like comments"
ON comment_likes
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can unlike comments"
ON comment_likes
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Anyone can read comment likes"
ON comment_likes
FOR SELECT
TO public
USING (true);

-- Function to get comment likes count
CREATE OR REPLACE FUNCTION get_comment_likes_count(comment_uuid uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  likes_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO likes_count
  FROM comment_likes
  WHERE comment_id = comment_uuid;
  
  RETURN likes_count;
END;
$$;

-- Function to check if user has liked a comment
CREATE OR REPLACE FUNCTION is_comment_liked_by_user(comment_uuid uuid, user_uuid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  is_liked boolean;
BEGIN
  IF user_uuid IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM comment_likes
    WHERE comment_id = comment_uuid AND user_id = user_uuid
  ) INTO is_liked;
  
  RETURN is_liked;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_comment_likes_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_comment_likes_count(uuid) TO anon;
GRANT EXECUTE ON FUNCTION is_comment_liked_by_user(uuid, uuid) TO authenticated;