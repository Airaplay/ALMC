/*
  # Add Storage Policies for Covers Bucket

  1. Problem
    - The 'covers' bucket exists but has NO storage.objects INSERT policies
    - Users cannot upload to it due to RLS violations
    - Only 'content-covers' bucket has policies, not 'covers'

  2. Solution
    - Add INSERT, SELECT, UPDATE, DELETE policies for 'covers' bucket
    - Follow same pattern as other buckets (user folder structure)

  3. Security
    - Users can only upload to their own folder (userId as first folder)
    - Public read access for all covers
    - Users can update/delete their own covers
*/

-- INSERT policy for covers bucket
CREATE POLICY "Users can upload to covers bucket"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'covers' 
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- SELECT policy for covers bucket
CREATE POLICY "Public read access for covers"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'covers');

-- UPDATE policy for covers bucket
CREATE POLICY "Users can update own covers"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'covers' 
    AND (storage.foldername(name))[1] = (auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'covers' 
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- DELETE policy for covers bucket
CREATE POLICY "Users can delete own covers"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'covers' 
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );
