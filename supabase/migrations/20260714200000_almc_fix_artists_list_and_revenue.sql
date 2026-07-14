/*
  # ALMC fixes — artists list RPC + revenue

  - Fix list_organization_artists CTE scope (relation "combined" does not exist)
  - Use users.total_earnings (USD live balance) for org/artist revenue KPIs
*/

CREATE OR REPLACE FUNCTION public.list_organization_artists(
  p_org_id uuid,
  p_search text DEFAULT NULL,
  p_status text DEFAULT 'active',
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
  v_items jsonb;
  v_total int;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'artists.view', v_user_id) THEN
    RAISE EXCEPTION 'Missing artists.view permission';
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
      0::bigint AS followers,
      0::bigint AS streams,
      0::numeric AS revenue,
      NULL::jsonb AS latest_release
    FROM public.organization_artist_invitations oai
    LEFT JOIN public.artist_profiles ap ON ap.id = oai.artist_profile_id
    LEFT JOIN public.users u ON u.id = oai.invitee_user_id
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
  totals AS (
    SELECT COUNT(*)::int AS total FROM combined
  ),
  paged AS (
    SELECT *
    FROM combined
    ORDER BY stage_name NULLS LAST
    LIMIT GREATEST(p_limit, 1)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT
    totals.total,
    COALESCE(
      (SELECT jsonb_agg(row_to_json(paged_row)::jsonb ORDER BY paged_row.stage_name NULLS LAST)
       FROM paged AS paged_row),
      '[]'::jsonb
    )
  INTO v_total, v_items
  FROM totals;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_organization_dashboard(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_total_artists int := 0;
  v_total_streams bigint := 0;
  v_total_followers bigint := 0;
  v_total_songs int := 0;
  v_total_albums int := 0;
  v_total_videos int := 0;
  v_total_revenue numeric := 0;
  v_top_artist jsonb := NULL;
  v_recent_activity jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'analytics.view', v_user_id) THEN
    RAISE EXCEPTION 'Missing analytics.view permission';
  END IF;

  SELECT COUNT(*)::int
  INTO v_total_artists
  FROM public.organization_artist_links oal
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active';

  SELECT
    COALESCE(SUM(stream_stats.streams), 0),
    COALESCE(SUM(stream_stats.songs), 0),
    COALESCE(SUM(stream_stats.albums), 0),
    COALESCE(SUM(stream_stats.videos), 0),
    COALESCE(SUM(stream_stats.followers), 0),
    COALESCE(SUM(stream_stats.revenue), 0)
  INTO v_total_streams, v_total_songs, v_total_albums, v_total_videos, v_total_followers, v_total_revenue
  FROM (
    SELECT
      (
        COALESCE((
          SELECT SUM(s.play_count)::bigint
          FROM public.artist_profiles ap
          LEFT JOIN public.artists a ON a.id = ap.artist_id
          LEFT JOIN public.songs s ON s.artist_id = a.id
          WHERE ap.id = oal.artist_profile_id
        ), 0)
        + COALESCE((
          SELECT SUM(cu.play_count)::bigint
          FROM public.content_uploads cu
          WHERE cu.user_id = oal.user_id
        ), 0)
      ) AS streams,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.artist_profiles ap
        LEFT JOIN public.artists a ON a.id = ap.artist_id
        LEFT JOIN public.songs s ON s.artist_id = a.id
        WHERE ap.id = oal.artist_profile_id
      ), 0) AS songs,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.albums al
        JOIN public.artist_profiles ap ON ap.artist_id = al.artist_id
        WHERE ap.id = oal.artist_profile_id
      ), 0) AS albums,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.content_uploads cu
        WHERE cu.user_id = oal.user_id
          AND cu.content_type IN ('video', 'short_clip')
      ), 0) AS videos,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.user_follows uf
        WHERE uf.following_id = oal.user_id
      ), 0) AS followers,
      COALESCE(u.total_earnings, 0)::numeric AS revenue
    FROM public.organization_artist_links oal
    JOIN public.users u ON u.id = oal.user_id
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
  ) stream_stats;

  SELECT jsonb_build_object(
    'artist_profile_id', ranked.artist_profile_id,
    'stage_name', ranked.stage_name,
    'streams', ranked.streams
  )
  INTO v_top_artist
  FROM (
    SELECT
      ap.id AS artist_profile_id,
      ap.stage_name,
      COALESCE((
        SELECT SUM(s.play_count)::bigint
        FROM public.artists a
        LEFT JOIN public.songs s ON s.artist_id = a.id
        WHERE a.id = ap.artist_id
      ), 0) AS streams
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
    ORDER BY streams DESC
    LIMIT 1
  ) ranked;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', al.id,
      'action', al.action,
      'artist_profile_id', al.artist_profile_id,
      'metadata', al.metadata,
      'created_at', al.created_at
    ) ORDER BY al.created_at DESC
  ), '[]'::jsonb)
  INTO v_recent_activity
  FROM (
    SELECT *
    FROM public.organization_activity_logs
    WHERE organization_id = p_org_id
    ORDER BY created_at DESC
    LIMIT 10
  ) al;

  RETURN jsonb_build_object(
    'total_artists', v_total_artists,
    'total_streams', v_total_streams,
    'total_followers', v_total_followers,
    'total_revenue', v_total_revenue,
    'total_songs', v_total_songs,
    'total_albums', v_total_albums,
    'total_videos', v_total_videos,
    'top_performing_artist', v_top_artist,
    'fastest_growing_artist', NULL,
    'recent_activity', v_recent_activity
  );
END;
$$;
