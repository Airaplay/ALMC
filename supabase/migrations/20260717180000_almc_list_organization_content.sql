/*
  # ALMC — list organization content per artist

  Paginated catalog of content_uploads for linked artists.
*/

CREATE OR REPLACE FUNCTION public.list_organization_content(
  p_org_id uuid,
  p_artist_profile_id uuid DEFAULT NULL,
  p_content_type text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_limit int := GREATEST(LEAST(COALESCE(p_limit, 50), 200), 1);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_type text := NULLIF(lower(trim(COALESCE(p_content_type, ''))), '');
  v_items jsonb;
  v_total int := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'content.view', v_user_id) THEN
    RAISE EXCEPTION 'Missing content.view permission';
  END IF;

  IF v_type IS NOT NULL AND v_type NOT IN ('single', 'album', 'video', 'short_clip') THEN
    RAISE EXCEPTION 'Invalid content type';
  END IF;

  SELECT COUNT(*)::int
  INTO v_total
  FROM public.content_uploads cu
  INNER JOIN public.organization_artist_links oal
    ON oal.artist_profile_id = cu.artist_profile_id
   AND oal.organization_id = p_org_id
   AND oal.status = 'active'
  WHERE (p_artist_profile_id IS NULL OR cu.artist_profile_id = p_artist_profile_id)
    AND (v_type IS NULL OR cu.content_type = v_type)
    AND (
      v_search IS NULL
      OR cu.title ILIKE '%' || v_search || '%'
    );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'content_type', t.content_type,
      'status', t.status,
      'play_count', t.play_count,
      'created_at', t.created_at,
      'updated_at', t.updated_at,
      'artist_profile_id', t.artist_profile_id,
      'stage_name', t.stage_name,
      'profile_photo_url', t.profile_photo_url,
      'cover_url', t.cover_url,
      'release_status', t.release_status,
      'release_at', t.release_at
    )
    ORDER BY t.created_at DESC
  ), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      cu.id,
      cu.title,
      cu.content_type,
      cu.status,
      cu.play_count,
      cu.created_at,
      cu.updated_at,
      cu.artist_profile_id,
      ap.stage_name,
      ap.profile_photo_url,
      COALESCE(
        NULLIF(trim(cu.metadata->>'cover_url'), ''),
        NULLIF(trim(cu.metadata->>'thumbnail_url'), ''),
        NULLIF(trim(cu.metadata->>'artwork_url'), '')
      ) AS cover_url,
      CASE
        WHEN cu.status = 'rejected' THEN 'cancelled'
        WHEN cu.status = 'approved' THEN 'published'
        WHEN COALESCE(cu.metadata->>'release_action', '') = 'draft' THEN 'draft'
        WHEN cu.status = 'pending' AND (
          COALESCE(cu.metadata->>'release_action', '') = 'schedule'
          OR COALESCE(cu.metadata->>'scheduled', 'false') = 'true'
        ) THEN 'scheduled'
        WHEN cu.status = 'pending' THEN 'draft'
        ELSE 'published'
      END AS release_status,
      COALESCE(
        NULLIF(trim(cu.metadata->>'release_date'), '')::timestamptz,
        cu.created_at
      ) AS release_at
    FROM public.content_uploads cu
    INNER JOIN public.organization_artist_links oal
      ON oal.artist_profile_id = cu.artist_profile_id
     AND oal.organization_id = p_org_id
     AND oal.status = 'active'
    INNER JOIN public.artist_profiles ap
      ON ap.id = cu.artist_profile_id
    WHERE (p_artist_profile_id IS NULL OR cu.artist_profile_id = p_artist_profile_id)
      AND (v_type IS NULL OR cu.content_type = v_type)
      AND (
        v_search IS NULL
        OR cu.title ILIKE '%' || v_search || '%'
      )
    ORDER BY cu.created_at DESC
    LIMIT v_limit
    OFFSET v_offset
  ) t;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_organization_content(uuid, uuid, text, text, int, int) TO authenticated;
