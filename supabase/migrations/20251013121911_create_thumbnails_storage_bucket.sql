/*
  # Create thumbnails storage bucket

  1. New Storage Bucket
    - `thumbnails` - for storing video thumbnails and cover images
      - Public access enabled for viewing
      - 10MB file size limit
      - Image MIME types only (JPEG, PNG, WebP)

  2. Security (RLS Policies)
    - Users can upload thumbnails to their own folders only
    - Public read access for all thumbnails
    - Users can update/delete only their own thumbnails
    - Proper authentication checks for write operations

  3. Notes
    - Thumbnails are used for video uploads and short clips
    - Folder structure: {user_id}/thumbnails/{filename}
*/

-- Drop any existing policies for thumbnails bucket (in case of re-runs)
DROP POLICY IF EXISTS "Users can upload own thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own thumbnails" ON storage.objects;

-- Create the thumbnails storage bucket
DO $$
BEGIN
  -- Check if bucket already exists
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'thumbnails'
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
      'thumbnails',
      'thumbnails',
      true,
      10485760, -- 10MB limit
      ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
      now(),
      now()
    );
  ELSE
    -- Update existing bucket to ensure correct settings
    UPDATE storage.buckets 
    SET 
      public = true,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
      updated_at = now()
    WHERE id = 'thumbnails';
  END IF;
END $$;

-- Policy for uploading thumbnails (INSERT)
CREATE POLICY "Users can upload own thumbnails"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'thumbnails' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy for reading thumbnails (SELECT)
-- Allow public read access to all thumbnails
CREATE POLICY "Public read access for thumbnails"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'thumbnails');

-- Policy for updating thumbnails (UPDATE)
CREATE POLICY "Users can update own thumbnails"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'thumbnails' 
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'thumbnails' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy for deleting thumbnails (DELETE)
CREATE POLICY "Users can delete own thumbnails"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'thumbnails' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);