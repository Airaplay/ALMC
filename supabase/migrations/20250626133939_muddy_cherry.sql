/*
  # Create short-clips storage bucket

  1. Storage Setup
    - Creates 'short-clips' bucket for user short clip uploads
    - Sets up proper file size limits and MIME type restrictions
    - Configures public access for short clip viewing

  2. Security
    - Users can only upload clips to their own folder
    - Public read access for all short clips
    - Authenticated users have full control over their own clips

  3. File Organization
    - Clips stored in user-specific folders: {user_id}/filename
    - Supports audio and video formats
    - 50MB file size limit per upload
*/

-- Create the short-clips bucket
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
  END IF;
END $$;

-- Policy for uploading short clips (INSERT)
-- Users can only upload to their own folder (path starts with their user ID)
CREATE POLICY "Users can upload own short clips"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'short-clips' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy for reading short clips (SELECT)
-- Allow public read access to all short clips
CREATE POLICY "Public read access for short clips"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'short-clips');

-- Policy for updating short clips (UPDATE)
-- Users can only update their own files
CREATE POLICY "Users can update own short clips"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'short-clips' 
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'short-clips' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy for deleting short clips (DELETE)
-- Users can only delete their own files
CREATE POLICY "Users can delete own short clips"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'short-clips' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);