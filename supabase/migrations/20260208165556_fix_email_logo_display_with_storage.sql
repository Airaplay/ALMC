/*
  # Fix Email Logo Display with Supabase Storage
  
  1. Creates a public storage bucket for app assets (logos, banners, etc.)
  2. Sets up proper storage policies for public read access
  3. Updates email templates to use Supabase Storage URL for logo
  
  ## Changes
  - Creates `app-assets` storage bucket (public)
  - Adds storage policies for public read, authenticated upload
  - Updates all email templates with correct logo URL format
  
  ## Logo URL Format
  The logo will be accessible at:
  https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png
*/

-- Create public storage bucket for app assets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'app-assets',
  'app-assets',
  true,
  5242880, -- 5MB limit
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public read access for app assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload to app assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update app assets" ON storage.objects;

-- Allow public read access to app-assets
CREATE POLICY "Public read access for app assets"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'app-assets');

-- Allow authenticated users to upload to app-assets
CREATE POLICY "Authenticated upload to app assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'app-assets');

-- Allow authenticated users to update app assets
CREATE POLICY "Authenticated update app assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'app-assets')
WITH CHECK (bucket_id = 'app-assets');

-- Update email templates with correct Supabase Storage logo URL
DO $$
DECLARE
  v_logo_url TEXT := 'https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png';
BEGIN
  -- Update all email templates to use Supabase Storage logo URL
  UPDATE email_templates
  SET html_content = REPLACE(
    html_content,
    'https://airaplay.com/official_airaplay_logo.png',
    v_logo_url
  )
  WHERE html_content LIKE '%https://airaplay.com/official_airaplay_logo.png%';
  
  RAISE NOTICE 'Updated % email templates with new logo URL', (
    SELECT COUNT(*) FROM email_templates 
    WHERE html_content LIKE '%' || v_logo_url || '%'
  );
END $$;