/*
  # Create content_comments table for songs and other content

  1. New Tables
    - `content_comments` - Store comments for songs, albums, videos, and other content
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `content_id` (uuid, references songs/albums/videos)
      - `content_type` (text, 'song' | 'album' | 'video' | 'playlist')
      - `comment_text` (text)
      - `parent_comment_id` (uuid, self-reference for nested replies)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on content_comments table
    - Add policies for authenticated users to create, update, delete their own comments
    - Allow public to read comments
    - Users can only edit/delete their own comments

  3. Indexes
    - Add indexes for content_id, user_id, parent_comment_id for better performance
    - Add composite index for content_id + content_type queries

  4. Functions
    - Create helper functions to get comment counts
*/

-- Drop existing function if exists
DROP FUNCTION IF EXISTS get_content_comments_count(uuid, text);

-- Create content_comments table
CREATE TABLE IF NOT EXISTS content_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id uuid NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('song', 'album', 'video', 'playlist', 'clip')),
  comment_text text NOT NULL,
  parent_comment_id uuid REFERENCES content_comments(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE content_comments ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_content_comments_user_id ON content_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_content_comments_content_id ON content_comments(content_id);
CREATE INDEX IF NOT EXISTS idx_content_comments_content_type ON content_comments(content_type);
CREATE INDEX IF NOT EXISTS idx_content_comments_parent_id ON content_comments(parent_comment_id) WHERE parent_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_comments_created_at ON content_comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_comments_content_composite ON content_comments(content_id, content_type);

-- RLS Policies

-- Allow authenticated users to insert comments
CREATE POLICY "Users can create comments"
ON content_comments
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Allow authenticated users to update their own comments
CREATE POLICY "Users can update their own comments"
ON content_comments
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Allow authenticated users to delete their own comments
CREATE POLICY "Users can delete their own comments"
ON content_comments
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Allow anyone to read comments
CREATE POLICY "Anyone can read comments"
ON content_comments
FOR SELECT
TO public
USING (true);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_content_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_content_comments_updated_at_trigger ON content_comments;
CREATE TRIGGER update_content_comments_updated_at_trigger
  BEFORE UPDATE ON content_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_content_comments_updated_at();

-- Function to get comment count for content
CREATE OR REPLACE FUNCTION get_content_comments_count(content_uuid uuid, type text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  comments_count integer;
BEGIN
  IF type IS NULL THEN
    SELECT COUNT(*)::integer INTO comments_count
    FROM content_comments
    WHERE content_id = content_uuid;
  ELSE
    SELECT COUNT(*)::integer INTO comments_count
    FROM content_comments
    WHERE content_id = content_uuid AND content_type = type;
  END IF;
  
  RETURN COALESCE(comments_count, 0);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_content_comments_count(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_comments_count(uuid, text) TO anon;