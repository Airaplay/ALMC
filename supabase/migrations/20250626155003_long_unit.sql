/*
  # Add social features to users table

  1. New Tables
    - `user_follows` - Track user following relationships
    - Add follower/following count functionality

  2. Security
    - Enable RLS on user_follows table
    - Add policies for managing follows
    - Add policies for reading follow counts

  3. Functions
    - Add helper functions to get follower/following counts
*/

-- Create user_follows table for following relationships
CREATE TABLE IF NOT EXISTS user_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(follower_id, following_id),
  CHECK (follower_id != following_id)
);

-- Enable RLS on user_follows
ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_follows_follower_id ON user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_following_id ON user_follows(following_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_created_at ON user_follows(created_at DESC);

-- RLS Policies for user_follows
CREATE POLICY "Users can follow others"
ON user_follows
FOR INSERT
TO authenticated
WITH CHECK (follower_id = auth.uid());

CREATE POLICY "Users can unfollow others"
ON user_follows
FOR DELETE
TO authenticated
USING (follower_id = auth.uid());

CREATE POLICY "Users can read follow relationships"
ON user_follows
FOR SELECT
TO authenticated
USING (true);

-- Function to get follower count
CREATE OR REPLACE FUNCTION get_follower_count(user_uuid uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  count_result integer;
BEGIN
  SELECT COUNT(*)::integer INTO count_result
  FROM user_follows
  WHERE following_id = user_uuid;
  
  RETURN COALESCE(count_result, 0);
END;
$$;

-- Function to get following count
CREATE OR REPLACE FUNCTION get_following_count(user_uuid uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  count_result integer;
BEGIN
  SELECT COUNT(*)::integer INTO count_result
  FROM user_follows
  WHERE follower_id = user_uuid;
  
  RETURN COALESCE(count_result, 0);
END;
$$;

-- Function to check if user is following another user
CREATE OR REPLACE FUNCTION is_following(follower_uuid uuid, following_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  is_following_result boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM user_follows
    WHERE follower_id = follower_uuid AND following_id = following_uuid
  ) INTO is_following_result;
  
  RETURN COALESCE(is_following_result, false);
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_follower_count TO authenticated;
GRANT EXECUTE ON FUNCTION get_following_count TO authenticated;
GRANT EXECUTE ON FUNCTION is_following TO authenticated;