-- Fix list_organization_content: CTE "filtered" was referenced across two SQL statements.

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

  IF p_artist_profile_id IS NOT NULL
     AND NOT public.org_member_can_access_artist(p_org_id, p_artist_profile_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied for this artist';
  END IF;

  WITH owned AS (
    SELECT
      oal.artist_profile_id,
      oal.user_id,
      ap.artist_id,
      ap.stage_name,
      ap.profile_photo_url
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
      AND (p_artist_profile_id IS NULL OR oal.artist_profile_id = p_artist_profile_id)
      AND public.org_member_can_access_artist(p_org_id, oal.artist_profile_id, v_user_id)
  ),
  catalog AS (
    SELECT
      cu.id,
      cu.title,
      CASE
        WHEN cu.content_type IN ('single', 'song') THEN 'single'
        ELSE cu.content_type
      END AS content_type,
      cu.status,
      COALESCE(
        CASE
          WHEN cu.content_type IN ('single', 'song')
            AND NULLIF(trim(cu.metadata->>'song_id'), '') IS NOT NULL
          THEN (
            SELECT s.play_count
            FROM public.songs s
            WHERE s.id = (NULLIF(trim(cu.metadata->>'song_id'), ''))::uuid
          )
        END,
        cu.play_count,
        0
      )::bigint AS play_count,
      cu.created_at,
      COALESCE(cu.updated_at, cu.created_at) AS updated_at,
      o.artist_profile_id,
      o.stage_name,
      o.profile_photo_url,
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
    JOIN owned o ON (
      cu.artist_profile_id = o.artist_profile_id
      OR (
        cu.user_id = o.user_id
        AND (cu.artist_profile_id IS NULL OR cu.artist_profile_id = o.artist_profile_id)
      )
    )
    WHERE cu.content_type IN ('single', 'song', 'album', 'video', 'short_clip')

    UNION ALL

    SELECT
      s.id,
      s.title,
      'single'::text AS content_type,
      'published'::text AS status,
      COALESCE(s.play_count, 0)::bigint AS play_count,
      s.created_at,
      COALESCE(s.updated_at, s.created_at) AS updated_at,
      o.artist_profile_id,
      o.stage_name,
      o.profile_photo_url,
      s.cover_image_url AS cover_url,
      'published'::text AS release_status,
      COALESCE(s.release_date::timestamptz, s.created_at) AS release_at
    FROM public.songs s
    JOIN owned o ON o.artist_id = s.artist_id
    WHERE s.album_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.content_uploads cu
        WHERE cu.metadata->>'song_id' = s.id::text
          OR (
            cu.user_id = o.user_id
            AND cu.content_type IN ('single', 'song')
            AND lower(cu.title) = lower(s.title)
          )
      )

    UNION ALL

    SELECT
      a.id,
      a.title,
      'album'::text AS content_type,
      'published'::text AS status,
      COALESCE((
        SELECT SUM(s.play_count)::bigint
        FROM public.songs s
        WHERE s.album_id = a.id
      ), 0) AS play_count,
      a.created_at,
      COALESCE(a.updated_at, a.created_at) AS updated_at,
      o.artist_profile_id,
      o.stage_name,
      o.profile_photo_url,
      a.cover_image_url AS cover_url,
      'published'::text AS release_status,
      COALESCE(a.release_date::timestamptz, a.created_at) AS release_at
    FROM public.albums a
    JOIN owned o ON o.artist_id = a.artist_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.content_uploads cu
      WHERE cu.metadata->>'album_id' = a.id::text
        OR (
          cu.user_id = o.user_id
          AND cu.content_type = 'album'
          AND lower(cu.title) = lower(a.title)
        )
    )
  ),
  filtered AS (
    SELECT *
    FROM catalog
    WHERE (v_type IS NULL OR content_type = v_type)
      AND (
        v_search IS NULL
        OR title ILIKE '%' || v_search || '%'
      )
  )
  SELECT
    (SELECT COUNT(*)::int FROM filtered),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'title', p.title,
          'content_type', p.content_type,
          'status', p.status,
          'play_count', p.play_count,
          'created_at', p.created_at,
          'updated_at', p.updated_at,
          'artist_profile_id', p.artist_profile_id,
          'stage_name', p.stage_name,
          'profile_photo_url', p.profile_photo_url,
          'cover_url', p.cover_url,
          'release_status', p.release_status,
          'release_at', p.release_at
        )
        ORDER BY p.created_at DESC
      )
      FROM (
        SELECT *
        FROM filtered
        ORDER BY created_at DESC
        LIMIT v_limit
        OFFSET v_offset
      ) p
    ), '[]'::jsonb)
  INTO v_total, v_items;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_organization_content(uuid, uuid, text, text, int, int) TO authenticated;
