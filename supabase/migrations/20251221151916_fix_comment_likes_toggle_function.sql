/*
  # Fix comment likes with toggle function

  1. New Function
    - `toggle_comment_like` - Server-side function to handle like/unlike operations
    - Uses `auth.uid()` directly to avoid frontend/backend session mismatches
    - Returns the new like status (true if liked, false if unliked)
    - Handles all the logic server-side for better reliability

  2. Security
    - SECURITY INVOKER - runs with the permissions of the calling user
    - Requires authentication (returns error if not authenticated)
    - Respects existing RLS policies

  3. Benefits
    - Eliminates frontend/backend user ID mismatches
    - Better error handling
    - Single source of truth for auth state
    - Atomic operation (no race conditions)
*/

-- Create toggle function
CREATE OR REPLACE FUNCTION toggle_comment_like(comment_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  current_user_id uuid;
  is_currently_liked boolean;
BEGIN
  -- Get the current user ID from auth
  current_user_id := auth.uid();
  
  -- Check if user is authenticated
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated to like comments';
  END IF;

  -- Check if the comment is already liked by this user
  SELECT EXISTS(
    SELECT 1 FROM comment_likes
    WHERE comment_id = comment_uuid AND user_id = current_user_id
  ) INTO is_currently_liked;

  IF is_currently_liked THEN
    -- Unlike: Remove the like
    DELETE FROM comment_likes
    WHERE comment_id = comment_uuid AND user_id = current_user_id;
    
    RETURN false; -- Not liked anymore
  ELSE
    -- Like: Add the like
    INSERT INTO comment_likes (comment_id, user_id)
    VALUES (comment_uuid, current_user_id)
    ON CONFLICT (user_id, comment_id) DO NOTHING; -- Handle race conditions
    
    RETURN true; -- Now liked
  END IF;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION toggle_comment_like(uuid) TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION toggle_comment_like(uuid) IS 'Toggle like status for a comment. Returns true if liked, false if unliked. Requires authentication.';
