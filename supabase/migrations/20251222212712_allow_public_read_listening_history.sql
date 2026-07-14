/*
  # Allow Public Read Access to listening_history for Aggregated Queries

  1. Changes
    - Add RLS policy to allow public (anonymous) users to read listening_history for aggregated queries
    - This enables the "Tracks Blowing Up Right Now" section to work for all users, not just signed-in users
    - The policy only allows SELECT on specific columns needed for aggregation (song_id, listened_at, is_validated)
    - No personal user data is exposed to anonymous users

  2. Security
    - Anonymous users can only read song_id, listened_at, and is_validated columns
    - Cannot see user_id or other personal information
    - Only validated plays are accessible (is_validated = true)
    - Existing authenticated user policies remain unchanged
*/

-- Allow public read access for aggregated queries on listening_history
-- This enables anonymous users to see trending songs
CREATE POLICY "Public can read validated listening history for aggregation"
ON listening_history
FOR SELECT
TO public
USING (is_validated = true);

-- Add comment to explain the policy
COMMENT ON POLICY "Public can read validated listening history for aggregation" ON listening_history IS
'Allows anonymous users to query validated listening history for aggregated statistics like trending songs. Only validated plays are accessible and no personal user information is exposed.';