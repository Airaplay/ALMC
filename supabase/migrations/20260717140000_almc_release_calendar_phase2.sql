-- ALMC 5.6 Release Calendar — org-scoped releases from linked artist content.

CREATE OR REPLACE FUNCTION public.get_organization_release_calendar(
  p_org_id uuid,
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_artist_profile_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'content.view', v_user_id) THEN
    RAISE EXCEPTION 'Missing content.view permission';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(entry ORDER BY entry->>'scheduled_at')
    FROM (
      SELECT jsonb_build_object(
        'id', cu.id,
        'title', cu.title,
        'content_type', cu.content_type,
        'artist_profile_id', cu.artist_profile_id,
        'stage_name', ap.stage_name,
        'profile_photo_url', ap.profile_photo_url,
        'calendar_status', CASE
          WHEN cu.status = 'rejected' THEN 'cancelled'
          WHEN cu.status = 'approved' THEN 'published'
          WHEN COALESCE(cu.metadata->>'release_action', '') = 'draft' THEN 'draft'
          WHEN cu.status = 'pending' AND (
            COALESCE(cu.metadata->>'release_action', '') = 'schedule'
            OR COALESCE(cu.metadata->>'scheduled', 'false') = 'true'
          ) THEN 'scheduled'
          WHEN cu.status = 'pending' THEN 'draft'
          ELSE 'published'
        END,
        'scheduled_at', (
          COALESCE(
            NULLIF(trim(cu.metadata->>'release_date'), '')::timestamptz,
            cu.created_at
          )
        )::timestamptz,
        'cover_url', COALESCE(
          NULLIF(trim(cu.metadata->>'cover_url'), ''),
          NULLIF(trim(cu.metadata->>'thumbnail_url'), '')
        )
      ) AS entry,
      (
        COALESCE(
          NULLIF(trim(cu.metadata->>'release_date'), '')::timestamptz,
          cu.created_at
        )
      )::timestamptz AS sort_at,
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
      END AS status_key
      FROM public.content_uploads cu
      INNER JOIN public.organization_artist_links oal
        ON oal.artist_profile_id = cu.artist_profile_id
        AND oal.organization_id = p_org_id
        AND oal.status = 'active'
      INNER JOIN public.artist_profiles ap
        ON ap.id = cu.artist_profile_id
      WHERE (p_artist_profile_id IS NULL OR cu.artist_profile_id = p_artist_profile_id)
    ) rows
    WHERE (p_start IS NULL OR rows.sort_at >= p_start)
      AND (p_end IS NULL OR rows.sort_at < p_end)
      AND (COALESCE(p_status, 'all') = 'all' OR rows.status_key = p_status)
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_organization_release_calendar(uuid, timestamptz, timestamptz, text, uuid) TO authenticated;
