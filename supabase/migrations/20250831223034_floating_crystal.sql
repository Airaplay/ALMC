/*
  # Create banner storage bucket

  1. Storage
    - Create 'banners' storage bucket for banner images
    - Set up RLS policies for admin-only access
    - Configure public access for reading banner images

  2. Security
    - Only admins can upload/update/delete banner images
    - Public read access for displaying banners on the website
*/

-- Create the banners storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'banners',
  'banners',
  true,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- Enable RLS on the storage.objects table for the banners bucket
CREATE POLICY "Admins can upload banner images"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'banners' AND
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can update banner images"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'banners' AND
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  )
  WITH CHECK (
    bucket_id = 'banners' AND
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete banner images"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'banners' AND
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

CREATE POLICY "Public can view banner images"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'banners');