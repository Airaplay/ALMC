/*
  # Create content-covers storage bucket

  1. Storage Setup
    - Creates 'content-covers' bucket for cover images and thumbnails
    - Sets up proper file size limits and MIME type restrictions
    - Configures public access for cover image viewing

  2. Security
    - Users can only upload covers to their own folder
    - Public read access for all cover images
    - Authenticated users have full control over their own covers

  3. File Organization
    - Covers stored in user-specific folders: {user_id}/{content_type}/filename
    - Supports image formats (JPEG, PNG, WebP)
    - 10MB file size limit per upload for cover images
*/

-- Create the content-covers bucket
DO $$
BEGIN
  -- Check if bucket already exists
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'content-covers'
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
      'content-covers',
      'content-covers',
      true,
      10485760, -- 10MB limit for cover images
      ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
      now(),
      now()
    );
  END IF;
END $$;

-- Policy for uploading content covers (INSERT)
-- Users can only upload to their own folder (path starts with their user ID)
CREATE POLICY "Users can upload own content covers"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'content-covers' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy for reading content covers (SELECT)
-- Allow public read access to all content covers
CREATE POLICY "Public read access for content covers"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'content-covers');

-- Policy for updating content covers (UPDATE)
-- Users can only update their own files
CREATE POLICY "Users can update own content covers"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'content-covers' 
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'content-covers' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy for deleting content covers (DELETE)
-- Users can only delete their own files
CREATE POLICY "Users can delete own content covers"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'content-covers' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);