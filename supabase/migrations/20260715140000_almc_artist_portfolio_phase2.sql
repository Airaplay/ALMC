-- ALMC 5.3 Artist Portfolio: genre, monthly streams, filters, and sortable roster RPC.

DROP FUNCTION IF EXISTS public.list_organization_artists(uuid, text, text, int, int);

CREATE OR REPLACE FUNCTION public.list_organization_artists(
  p_org_id uuid,
  p_search text DEFAULT NULL,
  p_status text DEFAULT 'active',
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_genre text DEFAULT NULL,
  p_verified text DEFAULT 'all',
  p_sort text DEFAULT 'streams'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_items jsonb;
  v_total int;
  v_sort text := lower(COALESCE(p_sort, 'streams'));
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'artists.view', v_user_id) THEN
    RAISE EXCEPTION 'Missing artists.view permission';
  END IF;

  IF v_sort NOT IN ('streams', 'monthly_streams', 'followers', 'revenue', 'stage_name', 'linked_at') THEN
    v_sort := 'streams';
  END IF;

  WITH combined AS (
    SELECT
      oal.id AS link_id,
      oal.status AS link_status,
      oal.linked_at,
      false AS is_pending_invitation,
      NULL::uuid AS invitation_id,
      NULL::text AS invitation_type,
      ap.id AS artist_profile_id,
      ap.stage_name,
      ap.profile_photo_url,
      ap.is_verified,
      ap.country,
      ap.artist_id,
      u.id AS user_id,
      u.email,
      u.display_name,
      COALESCE(g.name, '') AS genre,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.user_follows uf
        WHERE uf.following_id = u.id
      ), 0) AS followers,
      (
        COALESCE((
          SELECT SUM(s.play_count)::bigint
          FROM public.artists a
          LEFT JOIN public.songs s ON s.artist_id = a.id
          WHERE a.id = ap.artist_id
        ), 0)
        + COALESCE((
          SELECT SUM(cu.play_count)::bigint
          FROM public.content_uploads cu
          WHERE cu.user_id = u.id
        ), 0)
      ) AS streams,
      (
        COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          WHERE lh.listened_at >= now() - interval '30 days'
            AND (
              lh.song_id IN (
                SELECT s.id
                FROM public.songs s
                WHERE s.artist_id = ap.artist_id
              )
              OR lh.content_upload_id IN (
                SELECT cu.id
                FROM public.content_uploads cu
                WHERE cu.user_id = u.id
              )
            )
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.video_playback_history vph
          WHERE vph.watched_at >= now() - interval '30 days'
            AND vph.content_id IN (
              SELECT cu.id
              FROM public.content_uploads cu
              WHERE cu.user_id = u.id
            )
        ), 0)
      ) AS monthly_streams,
      COALESCE(u.total_earnings, 0)::numeric AS revenue,
      (
        SELECT jsonb_build_object(
          'title', latest.title,
          'type', latest.content_type,
          'created_at', latest.created_at
        )
        FROM (
          SELECT s.title, 'single'::text AS content_type, s.created_at
          FROM public.artists a
          JOIN public.songs s ON s.artist_id = a.id
          WHERE a.id = ap.artist_id
          UNION ALL
          SELECT cu.title, cu.content_type, cu.created_at
          FROM public.content_uploads cu
          WHERE cu.user_id = u.id
        ) latest
        ORDER BY latest.created_at DESC NULLS LAST
        LIMIT 1
      ) AS latest_release
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    JOIN public.users u ON u.id = oal.user_id
    LEFT JOIN public.genres g ON g.id = ap.genre_id
    WHERE oal.organization_id = p_org_id
      AND (p_status = 'all' OR oal.status = p_status)
      AND (
        p_search IS NULL OR trim(p_search) = ''
        OR ap.stage_name ILIKE '%' || trim(p_search) || '%'
        OR u.email ILIKE '%' || trim(p_search) || '%'
        OR u.display_name ILIKE '%' || trim(p_search) || '%'
      )

    UNION ALL

    SELECT
      oai.id AS link_id,
      'pending_invite'::text AS link_status,
      NULL::timestamptz AS linked_at,
      true AS is_pending_invitation,
      oai.id AS invitation_id,
      oai.invitation_type,
      oai.artist_profile_id,
      COALESCE(
        ap.stage_name,
        NULLIF(trim(oai.artist_metadata->>'stage_name'), ''),
        split_part(oai.invitee_email, '@', 1)
      ) AS stage_name,
      ap.profile_photo_url,
      ap.is_verified,
      COALESCE(ap.country, NULLIF(trim(oai.artist_metadata->>'country'), '')) AS country,
      ap.artist_id,
      oai.invitee_user_id AS user_id,
      oai.invitee_email AS email,
      u.display_name,
      COALESCE(g.name, NULLIF(trim(oai.artist_metadata->>'genre'), ''), '') AS genre,
      0::bigint AS followers,
      0::bigint AS streams,
      0::bigint AS monthly_streams,
      0::numeric AS revenue,
      NULL::jsonb AS latest_release
    FROM public.organization_artist_invitations oai
    LEFT JOIN public.artist_profiles ap ON ap.id = oai.artist_profile_id
    LEFT JOIN public.users u ON u.id = oai.invitee_user_id
    LEFT JOIN public.genres g ON g.id = ap.genre_id
    WHERE oai.organization_id = p_org_id
      AND oai.status = 'pending'
      AND oai.expires_at > now()
      AND (p_status = 'all' OR p_status = 'pending_invite')
      AND NOT EXISTS (
        SELECT 1
        FROM public.organization_artist_links oal2
        WHERE oal2.organization_id = p_org_id
          AND (
            (oai.artist_profile_id IS NOT NULL AND oal2.artist_profile_id = oai.artist_profile_id)
            OR (oai.invitee_user_id IS NOT NULL AND oal2.user_id = oai.invitee_user_id)
          )
          AND oal2.status IN ('active', 'pending_invite')
      )
      AND (
        p_search IS NULL OR trim(p_search) = ''
        OR COALESCE(ap.stage_name, oai.artist_metadata->>'stage_name', oai.invitee_email)
          ILIKE '%' || trim(p_search) || '%'
        OR oai.invitee_email ILIKE '%' || trim(p_search) || '%'
        OR u.display_name ILIKE '%' || trim(p_search) || '%'
      )
  ),
  filtered AS (
    SELECT *
    FROM combined
    WHERE (
      COALESCE(p_verified, 'all') = 'all'
      OR (p_verified = 'verified' AND COALESCE(is_verified, false) = true)
      OR (p_verified = 'unverified' AND COALESCE(is_verified, false) = false)
    )
    AND (
      p_genre IS NULL OR trim(p_genre) = ''
      OR COALESCE(genre, '') ILIKE '%' || trim(p_genre) || '%'
    )
  ),
  totals AS (
    SELECT COUNT(*)::int AS total FROM filtered
  ),
  paged AS (
    SELECT *
    FROM filtered
    ORDER BY
      CASE WHEN v_sort = 'stage_name' THEN stage_name END ASC NULLS LAST,
      CASE WHEN v_sort = 'linked_at' THEN linked_at END DESC NULLS LAST,
      CASE WHEN v_sort = 'followers' THEN followers END DESC NULLS LAST,
      CASE WHEN v_sort = 'revenue' THEN revenue END DESC NULLS LAST,
      CASE WHEN v_sort = 'monthly_streams' THEN monthly_streams END DESC NULLS LAST,
      CASE WHEN v_sort = 'streams' THEN streams END DESC NULLS LAST,
      streams DESC NULLS LAST,
      stage_name ASC NULLS LAST
    LIMIT GREATEST(p_limit, 1)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT
    totals.total,
    COALESCE(
      (SELECT jsonb_agg(row_to_json(paged_row)::jsonb)
       FROM paged AS paged_row),
      '[]'::jsonb
    )
  INTO v_total, v_items
  FROM totals;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_organization_artists(uuid, text, text, int, int, text, text, text) TO authenticated;
