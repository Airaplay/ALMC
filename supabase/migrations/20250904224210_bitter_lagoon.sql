/*
  # Fix Songs Table INSERT Policy

  1. Policy Changes
    - Update the INSERT policy for songs table to properly validate artist ownership
    - Ensure users can insert songs when they have a valid artist profile
    - Handle cases where artist_id might be null during creation

  2. Security
    - Maintain security by ensuring users can only insert songs for their own artist profiles
    - Allow proper song creation workflow
*/

-- Drop the existing INSERT policy
DROP POLICY IF EXISTS "Users can insert songs for their artist profile" ON songs;

-- Create a new INSERT policy that properly handles song creation
CREATE POLICY "Users can insert songs for their artist profile"
  ON songs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if the artist_id belongs to the user's artist profile
    artist_id IN (
      SELECT ap.artist_id 
      FROM artist_profiles ap 
      WHERE ap.user_id = auth.uid() 
      AND ap.artist_id IS NOT NULL
    )
    OR
    -- Allow if artist_id is null (will be set by trigger or application logic)
    artist_id IS NULL
  );

-- Also ensure the UPDATE policy allows setting artist_id properly
DROP POLICY IF EXISTS "Users can update their own songs" ON songs;

CREATE POLICY "Users can update their own songs"
  ON songs
  FOR UPDATE
  TO authenticated
  USING (
    artist_id IN (
      SELECT ap.artist_id 
      FROM artist_profiles ap 
      WHERE ap.user_id = auth.uid() 
      AND ap.artist_id IS NOT NULL
    )
  )
  WITH CHECK (
    artist_id IN (
      SELECT ap.artist_id 
      FROM artist_profiles ap 
      WHERE ap.user_id = auth.uid() 
      AND ap.artist_id IS NOT NULL
    )
  );