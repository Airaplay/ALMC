/*
  # ALMC org-delegated cover/thumbnail storage uploads

  Org members with content.upload and an active artist link may upload
  into the linked artist's covers/thumbnails folder (same path pattern as
  admin delegated uploads).
*/

CREATE OR REPLACE FUNCTION public.org_can_upload_storage_for_user(p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    p_target_user_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organization_artist_links oal
        ON oal.organization_id = om.organization_id
       AND oal.user_id = p_target_user_id
       AND oal.status = 'active'
      WHERE om.user_id = auth.uid()
        AND om.status = 'active'
        AND public.org_member_has_permission(
          om.organization_id,
          'content.upload',
          om.user_id
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.org_can_upload_storage_for_folder(p_folder text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT CASE
    WHEN p_folder IS NULL OR p_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN false
    ELSE public.org_can_upload_storage_for_user(p_folder::uuid)
  END;
$$;

GRANT EXECUTE ON FUNCTION public.org_can_upload_storage_for_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_can_upload_storage_for_folder(text) TO authenticated;

DROP POLICY IF EXISTS "Org members can upload covers for linked artists"
  ON storage.objects;
CREATE POLICY "Org members can upload covers for linked artists"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'covers'
    AND public.org_can_upload_storage_for_folder((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS "Org members can update covers for linked artists"
  ON storage.objects;
CREATE POLICY "Org members can update covers for linked artists"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'covers'
    AND public.org_can_upload_storage_for_folder((storage.foldername(name))[1])
  )
  WITH CHECK (
    bucket_id = 'covers'
    AND public.org_can_upload_storage_for_folder((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS "Org members can upload thumbnails for linked artists"
  ON storage.objects;
CREATE POLICY "Org members can upload thumbnails for linked artists"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'thumbnails'
    AND public.org_can_upload_storage_for_folder((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS "Org members can update thumbnails for linked artists"
  ON storage.objects;
CREATE POLICY "Org members can update thumbnails for linked artists"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'thumbnails'
    AND public.org_can_upload_storage_for_folder((storage.foldername(name))[1])
  )
  WITH CHECK (
    bucket_id = 'thumbnails'
    AND public.org_can_upload_storage_for_folder((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS "Org members can upload content-covers for linked artists"
  ON storage.objects;
CREATE POLICY "Org members can upload content-covers for linked artists"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'content-covers'
    AND public.org_can_upload_storage_for_folder((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS "Org members can update content-covers for linked artists"
  ON storage.objects;
CREATE POLICY "Org members can update content-covers for linked artists"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'content-covers'
    AND public.org_can_upload_storage_for_folder((storage.foldername(name))[1])
  )
  WITH CHECK (
    bucket_id = 'content-covers'
    AND public.org_can_upload_storage_for_folder((storage.foldername(name))[1])
  );
