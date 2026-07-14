/*
  # Fix Albums Table RLS Policy

  1. Security Updates
    - Update RLS policy for albums table to allow authenticated users to insert albums
    - Ensure users can create albums linked to their artist profile
    - Fix the policy check condition to properly validate artist ownership

  2. Policy Changes
    - Update INSERT policy to use proper artist_id validation
    - Ensure the policy works with the current database schema
*/

-- Drop existing policies that might be causing issues
DROP POLICY IF EXISTS "Authenticated users can insert their own albums" ON albums;

-- Create new INSERT policy for albums
CREATE POLICY "Users can create albums for their artist profile"
  ON albums
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

-- Ensure the SELECT policy allows reading albums
DROP POLICY IF EXISTS "Anyone can read albums" ON albums;
CREATE POLICY "Anyone can read albums"
  ON albums
  FOR SELECT
  TO public
  USING (true);

-- Ensure UPDATE policy exists for album owners
DROP POLICY IF EXISTS "Authenticated users can update their own albums" ON albums;
CREATE POLICY "Users can update their own albums"
  ON albums
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

-- Ensure DELETE policy exists for album owners
DROP POLICY IF EXISTS "Authenticated users can delete their own albums" ON albums;
CREATE POLICY "Users can delete their own albums"
  ON albums
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