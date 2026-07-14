/*
  # Fix comment likes function access for anonymous users

  1. Changes
    - Grant execute permission on `is_comment_liked_by_user` function to anonymous users
    - This allows non-authenticated users to check if a comment is liked (will always return false for them)

  2. Security
    - The function already has built-in security - it returns false if user_uuid is NULL
    - This is safe to grant to anon users
*/

-- Grant execute permissions to anon users
GRANT EXECUTE ON FUNCTION is_comment_liked_by_user(uuid, uuid) TO anon;
