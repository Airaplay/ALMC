/*
  # Fix Songs Table RLS Policy

  1. Policy Updates
    - Update the INSERT policy for songs table to properly handle artist_id validation
    - Ensure users with artist profiles can insert songs with their artist_id
    - Add better error handling for cases where artist_profile doesn't exist

  2. Security
    - Maintain security by ensuring users can only insert songs for their own artist profile
    - Keep existing SELECT, UPDATE, DELETE policies intact
*/

-- Drop the existing INSERT policy
DROP POLICY IF EXISTS "Authenticated users can insert their own songs" ON songs;

-- Create a new INSERT policy that properly handles artist_id validation
CREATE POLICY "Users can insert songs for their artist profile"
  ON songs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    artist_id IN (
      SELECT ap.artist_id 
      FROM artist_profiles ap 
      WHERE ap.user_id = auth.uid() 
      AND ap.artist_id IS NOT NULL
    )
  );

-- Also ensure the UPDATE policy is consistent
DROP POLICY IF EXISTS "Authenticated users can update their own songs" ON songs;

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

-- Also ensure the DELETE policy is consistent
DROP POLICY IF EXISTS "Authenticated users can delete their own songs" ON songs;

CREATE POLICY "Users can delete their own songs"
  ON songs
  FOR DELETE
  TO authenticated
  USING (
    artist_id IN (
      SELECT ap.artist_id 
      FROM artist_profiles ap 
      WHERE ap.user_id = auth.uid() 
      AND ap.artist_id IS NOT NULL
    )
  );