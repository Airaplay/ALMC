/*
  # Create clip_likes and clip_comments tables

  1. New Tables
    - `clip_likes` - Store likes for short clips
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `clip_id` (uuid, references content_uploads)
      - `created_at` (timestamptz)
    - `clip_comments` - Store comments for short clips
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `clip_id` (uuid, references content_uploads)
      - `comment_text` (text)
      - `parent_comment_id` (uuid, self-reference for replies)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Add policies for CRUD operations
    - Users can only manage their own likes and comments

  3. Indexes
    - Add indexes for better performance
*/

-- Create clip_likes table
CREATE TABLE IF NOT EXISTS clip_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clip_id uuid NOT NULL REFERENCES content_uploads(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, clip_id)
);

-- Enable Row Level Security (RLS)
ALTER TABLE clip_likes ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_clip_likes_user_id ON clip_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_clip_likes_clip_id ON clip_likes(clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_likes_created_at ON clip_likes(created_at);

-- RLS Policies for clip_likes table
-- Allow authenticated users to insert their own likes
CREATE POLICY "Users can like clips"
ON clip_likes
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Allow authenticated users to delete their own likes
CREATE POLICY "Users can unlike clips"
ON clip_likes
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Allow anyone to read likes
CREATE POLICY "Anyone can read clip likes"
ON clip_likes
FOR SELECT
TO public
USING (true);

-- Create clip_comments table
CREATE TABLE IF NOT EXISTS clip_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clip_id uuid NOT NULL REFERENCES content_uploads(id) ON DELETE CASCADE,
  comment_text text NOT NULL,
  parent_comment_id uuid REFERENCES clip_comments(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE clip_comments ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_clip_comments_user_id ON clip_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_clip_comments_clip_id ON clip_comments(clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_comments_parent_id ON clip_comments(parent_comment_id) WHERE parent_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clip_comments_created_at ON clip_comments(created_at);

-- RLS Policies for clip_comments table
-- Allow authenticated users to insert their own comments
CREATE POLICY "Users can comment on clips"
ON clip_comments
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Allow authenticated users to update their own comments
CREATE POLICY "Users can update their own comments"
ON clip_comments
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Allow authenticated users to delete their own comments
CREATE POLICY "Users can delete their own comments"
ON clip_comments
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Allow anyone to read comments
CREATE POLICY "Anyone can read clip comments"
ON clip_comments
FOR SELECT
TO public
USING (true);

-- Function to get clip likes count
CREATE OR REPLACE FUNCTION get_clip_likes_count(clip_uuid uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  likes_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO likes_count
  FROM clip_likes
  WHERE clip_id = clip_uuid;
  
  RETURN likes_count;
END;
$$;

-- Function to check if user has liked a clip
CREATE OR REPLACE FUNCTION is_clip_liked_by_user(clip_uuid uuid, user_uuid uuid DEFAULT auth.uid())
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
    SELECT 1 FROM clip_likes
    WHERE clip_id = clip_uuid AND user_id = user_uuid
  ) INTO is_liked;
  
  RETURN is_liked;
END;
$$;

-- Function to get clip comments count
CREATE OR REPLACE FUNCTION get_clip_comments_count(clip_uuid uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  comments_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO comments_count
  FROM clip_comments
  WHERE clip_id = clip_uuid;
  
  RETURN comments_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_clip_likes_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_clip_likes_count(uuid) TO anon;
GRANT EXECUTE ON FUNCTION is_clip_liked_by_user(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_clip_comments_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_clip_comments_count(uuid) TO anon;