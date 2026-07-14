/*
  # Grant follower count functions to anonymous users

  1. Changes
    - Grant EXECUTE permission on get_follower_count to anon role
    - Grant EXECUTE permission on get_following_count to anon role
    - Grant EXECUTE permission on is_following to anon role
    
  2. Security
    - These functions use SECURITY DEFINER to bypass RLS
    - They only read public follower/following counts
    - Safe to expose to anonymous users for viewing creator profiles
*/

-- Grant execute permissions to anonymous users
GRANT EXECUTE ON FUNCTION get_follower_count TO anon;
GRANT EXECUTE ON FUNCTION get_following_count TO anon;
GRANT EXECUTE ON FUNCTION is_following TO anon;
