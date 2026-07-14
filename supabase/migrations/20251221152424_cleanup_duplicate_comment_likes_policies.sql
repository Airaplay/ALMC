/*
  # Cleanup duplicate RLS policies on comment_likes

  1. Changes
    - Remove duplicate SELECT policies
    - Keep only one clean set of policies
    - Ensure proper access for authenticated and anonymous users

  2. Security
    - Everyone can read comment likes (needed for displaying counts)
    - Only authenticated users can add/remove their own likes
*/

-- Drop all existing policies
DROP POLICY IF EXISTS "Anyone can read comment likes" ON comment_likes;
DROP POLICY IF EXISTS "Public can view comment likes" ON comment_likes;
DROP POLICY IF EXISTS "Users can like comments" ON comment_likes;
DROP POLICY IF EXISTS "Users can unlike comments" ON comment_likes;

-- Create clean, consolidated policies
CREATE POLICY "Anyone can view comment likes"
  ON comment_likes FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can like comments"
  ON comment_likes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can unlike their comments"
  ON comment_likes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
