/*
  # Create content-media storage bucket

  1. Storage Setup
    - Creates 'content-media' bucket for full-length audio and video files
    - Sets up proper file size limits and MIME type restrictions
    - Configures public access for content viewing

  2. Security
    - Users can only upload content to their own folder
    - Public read access for all content media
    - Authenticated users have full control over their own content

  3. File Organization
    - Content stored in user-specific folders: {user_id}/{content_type}/filename
    - Supports audio formats (MP3, WAV, FLAC) and video formats (MP4, MOV)
    - 500MB file size limit per upload for full-length content
*/

-- Create the content-media bucket
DO $$
BEGIN
  -- Check if bucket already exists
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'content-media'
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
      'content-media',
      'content-media',
      true,
      524288000, -- 500MB limit for full-length content
      ARRAY[
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/flac', 'audio/aac',
        'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'
      ],
      now(),
      now()
    );
  END IF;
END $$;

-- Policy for uploading content media (INSERT)
-- Users can only upload to their own folder (path starts with their user ID)
CREATE POLICY "Users can upload own content media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'content-media' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy for reading content media (SELECT)
-- Allow public read access to all content media
CREATE POLICY "Public read access for content media"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'content-media');

-- Policy for updating content media (UPDATE)
-- Users can only update their own files
CREATE POLICY "Users can update own content media"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'content-media' 
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'content-media' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy for deleting content media (DELETE)
-- Users can only delete their own files
CREATE POLICY "Users can delete own content media"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'content-media' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);