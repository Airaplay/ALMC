/*
  # Create Genre Images Storage Bucket

  1. Storage Bucket Setup
    - Create 'genre-images' bucket for storing genre cover images
    - Set public access for reading images
    - Configure file size limits and allowed file types
    - Set up RLS policies for admin-only uploads

  2. Security
    - Public read access for all users (authenticated and anonymous)
    - Insert/upload only allowed for admin users
    - Update/delete only allowed for admin users
    - File size limit: 5MB per image
    - Allowed types: image/jpeg, image/png, image/webp

  3. Storage Structure
    - Path format: {genre_id}/{timestamp}.{ext}
    - Example: genre-images/123e4567-e89b-12d3-a456-426614174000/1701234567890.jpg
*/

-- Create the genre-images storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'genre-images',
  'genre-images',
  true,
  5242880, -- 5MB in bytes
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

-- Policy: Allow public read access to genre images
DROP POLICY IF EXISTS "Public read access for genre images" ON storage.objects;
CREATE POLICY "Public read access for genre images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'genre-images');

-- Policy: Allow authenticated admin users to upload genre images
DROP POLICY IF EXISTS "Admin can upload genre images" ON storage.objects;
CREATE POLICY "Admin can upload genre images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'genre-images' AND
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Policy: Allow authenticated admin users to update genre images
DROP POLICY IF EXISTS "Admin can update genre images" ON storage.objects;
CREATE POLICY "Admin can update genre images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'genre-images' AND
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
)
WITH CHECK (
  bucket_id = 'genre-images' AND
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Policy: Allow authenticated admin users to delete genre images
DROP POLICY IF EXISTS "Admin can delete genre images" ON storage.objects;
CREATE POLICY "Admin can delete genre images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'genre-images' AND
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);
