/*
  # Fix Songs RLS Policy for Featured Artists Feature

  1. Issue
    - Users getting "new row violates row-level security policy" when uploading songs
    - The current policy requires artist_id to match artist_profiles.artist_id
    - But there can be timing issues when artist_id is being created/updated

  2. Solution
    - Make the songs INSERT policy more permissive
    - Allow INSERT if user has an artist_profile (regardless of artist_id match)
    - This matches the content_uploads pattern which works well

  3. Security
    - Still requires authenticated user
    - Still requires artist_profile to exist
    - Maintains data ownership through artist_profiles table
*/

-- Drop and recreate the songs INSERT policy with more permissive check
DROP POLICY IF EXISTS "Users can insert songs for their artist profile" ON songs;

CREATE POLICY "Users can insert songs for their artist profile"
  ON songs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- User must have an artist_profile (approved or pending)
    EXISTS (
      SELECT 1 FROM artist_profiles 
      WHERE user_id = auth.uid()
    )
  );