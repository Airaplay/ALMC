/*
  # Fix storage RLS policies for profile photos and short clips

  1. Storage Policies
    - Create proper RLS policies for profile-photos bucket
    - Ensure users can upload to their own folders
    - Allow public read access for profile photos
    - Fix any existing policy conflicts

  2. Security
    - Users can only upload/update/delete files in their own folder
    - Public read access for viewing profile photos
    - Proper authentication checks
*/

-- First, drop any existing conflicting policies
DROP POLICY IF EXISTS "Users can upload own profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own profile photos" ON storage.objects;

-- Create comprehensive storage policies for profile-photos bucket

-- Policy for uploading profile photos (INSERT)
CREATE POLICY "Users can upload own profile photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-photos' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy for reading profile photos (SELECT)
-- Allow public read access to all profile photos
CREATE POLICY "Public read access for profile photos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'profile-photos');

-- Policy for updating profile photos (UPDATE)
CREATE POLICY "Users can update own profile photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-photos' 
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'profile-photos' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy for deleting profile photos (DELETE)
CREATE POLICY "Users can delete own profile photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-photos' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Ensure the profile-photos bucket exists with correct settings
DO $$
BEGIN
  -- Check if bucket already exists
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'profile-photos'
  ) THEN
    -- Insert the bucket
    INSERT INTO storage.buckets (
      id, 
      name, 
      public, 
      file_size_limit, 
      allowed_mime_types,
      created_at,
      updated_at
    ) VALUES (
      'profile-photos',
      'profile-photos',
      true,
      5242880, -- 5MB limit
      ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
      now(),
      now()
    );
  ELSE
    -- Update existing bucket to ensure correct settings
    UPDATE storage.buckets 
    SET 
      public = true,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
      updated_at = now()
    WHERE id = 'profile-photos';
  END IF;
END $$;

-- Also ensure the short-clips bucket has proper settings
DO $$
BEGIN
  -- Check if bucket already exists
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'short-clips'
  ) THEN
    -- Insert the bucket
    INSERT INTO storage.buckets (
      id, 
      name, 
      public, 
      file_size_limit, 
      allowed_mime_types,
      created_at,
      updated_at
    ) VALUES (
      'short-clips',
      'short-clips',
      true,
      52428800, -- 50MB limit
      ARRAY['audio/mpeg', 'audio/wav', 'audio/mp3', 'video/mp4', 'video/quicktime', 'video/x-msvideo'],
      now(),
      now()
    );
  ELSE
    -- Update existing bucket to ensure correct settings
    UPDATE storage.buckets 
    SET 
      public = true,
      file_size_limit = 52428800,
      allowed_mime_types = ARRAY['audio/mpeg', 'audio/wav', 'audio/mp3', 'video/mp4', 'video/quicktime', 'video/x-msvideo'],
      updated_at = now()
    WHERE id = 'short-clips';
  END IF;
END $$;