/*
  # Admin storage upload for user content

  Allows admins and managers to upload cover art and thumbnails into a creator's
  storage folder when managing content from the admin dashboard.
*/

CREATE POLICY "Admins and managers can upload covers for any user"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'covers'
    AND public.is_admin_or_manager()
  );

CREATE POLICY "Admins and managers can update covers for any user"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'covers'
    AND public.is_admin_or_manager()
  )
  WITH CHECK (
    bucket_id = 'covers'
    AND public.is_admin_or_manager()
  );

CREATE POLICY "Admins and managers can upload thumbnails for any user"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'thumbnails'
    AND public.is_admin_or_manager()
  );

CREATE POLICY "Admins and managers can update thumbnails for any user"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'thumbnails'
    AND public.is_admin_or_manager()
  )
  WITH CHECK (
    bucket_id = 'thumbnails'
    AND public.is_admin_or_manager()
  );
