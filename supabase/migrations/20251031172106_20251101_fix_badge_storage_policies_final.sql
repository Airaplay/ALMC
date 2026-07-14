-- Fix Verified Badge Storage Policies - Final Authority
-- Problem: Badge upload shows success but doesn't persist due to conflicting storage policies
-- Solution: Drop all conflicting policies and create unified policies for users and admins

DROP POLICY IF EXISTS "Users can upload own thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload badges" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update badges" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete badges" ON storage.objects;

-- SELECT Policy: Public read access for all thumbnails
CREATE POLICY "thumbnails_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'thumbnails');

-- INSERT Policy: Users and admins can upload to their respective folders
CREATE POLICY "thumbnails_upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'thumbnails'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR
      (
        (storage.foldername(name))[1] = 'badges'
        AND EXISTS (
          SELECT 1 FROM public.users
          WHERE public.users.id = auth.uid()
            AND public.users.role = 'admin'
            AND public.users.is_active = true
        )
      )
    )
  );

-- UPDATE Policy: Users and admins can update their respective files
CREATE POLICY "thumbnails_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'thumbnails'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR
      (
        (storage.foldername(name))[1] = 'badges'
        AND EXISTS (
          SELECT 1 FROM public.users
          WHERE public.users.id = auth.uid()
            AND public.users.role = 'admin'
            AND public.users.is_active = true
        )
      )
    )
  )
  WITH CHECK (
    bucket_id = 'thumbnails'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR
      (
        (storage.foldername(name))[1] = 'badges'
        AND EXISTS (
          SELECT 1 FROM public.users
          WHERE public.users.id = auth.uid()
            AND public.users.role = 'admin'
            AND public.users.is_active = true
        )
      )
    )
  );

-- DELETE Policy: Users and admins can delete their respective files
CREATE POLICY "thumbnails_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'thumbnails'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR
      (
        (storage.foldername(name))[1] = 'badges'
        AND EXISTS (
          SELECT 1 FROM public.users
          WHERE public.users.id = auth.uid()
            AND public.users.role = 'admin'
            AND public.users.is_active = true
        )
      )
    )
  );

-- Fix verified_badge_config table policies
ALTER TABLE verified_badge_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "badge_public_select" ON verified_badge_config;
DROP POLICY IF EXISTS "badge_admin_insert" ON verified_badge_config;
DROP POLICY IF EXISTS "badge_admin_update" ON verified_badge_config;
DROP POLICY IF EXISTS "badge_admin_delete" ON verified_badge_config;
DROP POLICY IF EXISTS "Anyone can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can update verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can insert verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "vbc_select_public" ON verified_badge_config;
DROP POLICY IF EXISTS "vbc_insert_admin" ON verified_badge_config;
DROP POLICY IF EXISTS "vbc_update_admin" ON verified_badge_config;
DROP POLICY IF EXISTS "vbc_delete_admin" ON verified_badge_config;

-- SELECT: Anyone can read badge config
CREATE POLICY "vbc_select_public"
  ON verified_badge_config
  FOR SELECT
  USING (true);

-- INSERT: Only active admins can insert
CREATE POLICY "vbc_insert_admin"
  ON verified_badge_config
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role = 'admin'
        AND is_active = true
    )
  );

-- UPDATE: Only active admins can update
CREATE POLICY "vbc_update_admin"
  ON verified_badge_config
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role = 'admin'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role = 'admin'
        AND is_active = true
    )
  );

-- DELETE: Only active admins can delete
CREATE POLICY "vbc_delete_admin"
  ON verified_badge_config
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role = 'admin'
        AND is_active = true
    )
  );

-- Ensure default badge exists
INSERT INTO verified_badge_config (badge_url, updated_at)
VALUES ('https://via.placeholder.com/24x24.png?text=V', now())
ON CONFLICT DO NOTHING;
