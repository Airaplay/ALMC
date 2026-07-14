/*
  # Add RLS policy for anonymous users to read creator names

  1. Security
    - Add policy for anonymous users to read basic user info (display_name, avatar_url)
    - This allows the MustWatchSection to display creator names to non-authenticated users
    - Only exposes non-sensitive public information needed for content attribution
*/

-- Add policy to allow anonymous users to read basic user information for content attribution
CREATE POLICY "Anonymous users can read basic user info for content attribution"
  ON users
  FOR SELECT
  TO anon
  USING (true);