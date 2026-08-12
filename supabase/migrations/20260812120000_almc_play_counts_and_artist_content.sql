-- ALMC: correct lifetime play counts (no double-count) and list all linked-artist content.

-- Backfill uploads that belong to a linked creator but lack artist_profile_id.
UPDATE public.content_uploads cu
SET artist_profile_id = ap.id
FROM public.artist_profiles ap
WHERE cu.artist_profile_id IS NULL
  AND cu.user_id = ap.user_id
  AND EXISTS (
    SELECT 1
    FROM public.organization_artist_links oal
    WHERE oal.artist_profile_id = ap.id
      AND oal.status = 'active'
  );

-- ---------------------------------------------------------------------------
-- Content catalog for org / per-artist: uploads + orphan songs/albums
-- Plays for singles come from songs.play_count when metadata.song_id is set.
-- ---------------------------------------------------------------------------
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
    -- Content uploads owned by linked profile or linked user (incl. legacy null profile)
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

    -- Standalone songs in catalog with no matching content_uploads row
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

    -- Albums in catalog with no matching content_uploads row
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
  SELECT COUNT(*)::int INTO v_total FROM filtered;

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
    SELECT *
    FROM filtered
    ORDER BY created_at DESC
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

-- ---------------------------------------------------------------------------
-- Artist roster: lifetime streams = songs.play_count + video/short_clip plays
-- (do not add single/album upload play_count - those mirror songs)
-- ---------------------------------------------------------------------------
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
  v_default_org_split_pct numeric := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'artists.view', v_user_id) THEN
    RAISE EXCEPTION 'Missing artists.view permission';
  END IF;

  SELECT COALESCE((o.settings->>'almc_org_split_org_pct')::numeric, 0)
  INTO v_default_org_split_pct
  FROM public.organizations o
  WHERE o.id = p_org_id;

  v_default_org_split_pct := GREATEST(LEAST(COALESCE(v_default_org_split_pct, 0), 100), 0);

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
          FROM public.songs s
          WHERE s.artist_id = ap.artist_id
        ), 0)
        + COALESCE((
          SELECT SUM(cu.play_count)::bigint
          FROM public.content_uploads cu
          WHERE cu.content_type IN ('video', 'short_clip')
            AND (
              cu.artist_profile_id = ap.id
              OR (cu.user_id = u.id AND (cu.artist_profile_id IS NULL OR cu.artist_profile_id = ap.id))
            )
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
                WHERE cu.artist_profile_id = ap.id
                   OR cu.user_id = u.id
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
              WHERE cu.artist_profile_id = ap.id
                 OR cu.user_id = u.id
            )
        ), 0)
      ) AS monthly_streams,
      COALESCE(u.total_earnings, 0)::numeric AS revenue,
      oal.org_split_pct_override,
      COALESCE(oal.org_split_pct_override, v_default_org_split_pct) AS org_split_pct,
      100 - COALESCE(oal.org_split_pct_override, v_default_org_split_pct) AS artist_split_pct,
      (
        SELECT jsonb_build_object(
          'title', latest.title,
          'type', latest.content_type,
          'created_at', latest.created_at
        )
        FROM (
          SELECT s.title, 'single'::text AS content_type, s.created_at
          FROM public.songs s
          WHERE s.artist_id = ap.artist_id
          UNION ALL
          SELECT cu.title, cu.content_type, cu.created_at
          FROM public.content_uploads cu
          WHERE cu.artist_profile_id = ap.id
             OR cu.user_id = u.id
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
      AND public.org_member_can_access_artist(p_org_id, ap.id, v_user_id)
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
      NULL::numeric AS org_split_pct_override,
      v_default_org_split_pct AS org_split_pct,
      (100 - v_default_org_split_pct)::numeric AS artist_split_pct,
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

-- ---------------------------------------------------------------------------
-- Dashboard lifetime total_streams: same non-double-count formula
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_organization_dashboard(
  p_org_id uuid,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_days int := GREATEST(LEAST(COALESCE(p_days, 30), 365), 1);
  v_period_end timestamptz := now();
  v_period_start timestamptz := v_period_end - make_interval(days => v_days);
  v_prev_start timestamptz := v_period_start - make_interval(days => v_days);
  v_total_artists int := 0;
  v_artists_added int := 0;
  v_total_streams bigint := 0;
  v_period_streams bigint := 0;
  v_prev_streams bigint := 0;
  v_period_listeners bigint := 0;
  v_prev_listeners bigint := 0;
  v_total_followers bigint := 0;
  v_total_songs int := 0;
  v_total_albums int := 0;
  v_total_videos int := 0;
  v_total_releases int := 0;
  v_total_revenue numeric := 0;
  v_period_revenue numeric := 0;
  v_prev_revenue numeric := 0;
  v_top_artists jsonb := '[]'::jsonb;
  v_fastest_artist jsonb := NULL;
  v_growth_chart jsonb := '[]'::jsonb;
  v_recent_activity jsonb := '[]'::jsonb;
  v_song_ids uuid[];
  v_content_ids uuid[];
  v_artist_ids uuid[];
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'analytics.view', v_user_id) THEN
    RAISE EXCEPTION 'Missing analytics.view permission';
  END IF;

  SELECT
    COALESCE(array_agg(DISTINCT s.id) FILTER (WHERE s.id IS NOT NULL), ARRAY[]::uuid[]),
    COALESCE(array_agg(DISTINCT cu.id) FILTER (WHERE cu.id IS NOT NULL), ARRAY[]::uuid[]),
    COALESCE(array_agg(DISTINCT ap.artist_id) FILTER (WHERE ap.artist_id IS NOT NULL), ARRAY[]::uuid[])
  INTO v_song_ids, v_content_ids, v_artist_ids
  FROM public.organization_artist_links oal
  JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
  LEFT JOIN public.artists a ON a.id = ap.artist_id
  LEFT JOIN public.songs s ON s.artist_id = a.id
  LEFT JOIN public.content_uploads cu ON (
    cu.user_id = oal.user_id
    OR cu.artist_profile_id = oal.artist_profile_id
  )
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active';

  SELECT COUNT(*)::int INTO v_total_artists
  FROM public.organization_artist_links oal
  WHERE oal.organization_id = p_org_id AND oal.status = 'active';

  SELECT COUNT(*)::int INTO v_artists_added
  FROM public.organization_artist_links oal
  WHERE oal.organization_id = p_org_id AND oal.status = 'active'
    AND COALESCE(oal.linked_at, oal.created_at) >= v_period_start
    AND COALESCE(oal.linked_at, oal.created_at) < v_period_end;

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
          LEFT JOIN public.songs s ON s.artist_id = ap.artist_id
          WHERE ap.id = oal.artist_profile_id
        ), 0)
        + COALESCE((
          SELECT SUM(cu.play_count)::bigint
          FROM public.content_uploads cu
          WHERE cu.content_type IN ('video', 'short_clip')
            AND (
              cu.artist_profile_id = oal.artist_profile_id
              OR (cu.user_id = oal.user_id AND (cu.artist_profile_id IS NULL OR cu.artist_profile_id = oal.artist_profile_id))
            )
        ), 0)
      ) AS streams,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.artist_profiles ap
        LEFT JOIN public.songs s ON s.artist_id = ap.artist_id
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
        WHERE cu.content_type IN ('video', 'short_clip')
          AND (
            cu.artist_profile_id = oal.artist_profile_id
            OR cu.user_id = oal.user_id
          )
      ), 0) AS videos,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.user_follows uf
        WHERE uf.following_id = oal.user_id
      ), 0) AS followers,
      COALESCE(u.total_earnings, 0)::numeric AS revenue
    FROM public.organization_artist_links oal
    JOIN public.users u ON u.id = oal.user_id
    WHERE oal.organization_id = p_org_id AND oal.status = 'active'
  ) stream_stats;

  v_total_releases := v_total_songs + v_total_albums + v_total_videos;

  SELECT
    COALESCE((
      SELECT COUNT(*)::bigint
      FROM public.listening_history lh
      WHERE (
        (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
        OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
      )
      AND lh.listened_at >= v_period_start
      AND lh.listened_at < v_period_end
    ), 0)
    + COALESCE((
      SELECT COUNT(*)::bigint
      FROM public.video_playback_history vph
      WHERE cardinality(v_content_ids) > 0
        AND vph.content_id = ANY(v_content_ids)
        AND vph.watched_at >= v_period_start
        AND vph.watched_at < v_period_end
    ), 0)
  INTO v_period_streams;

  SELECT
    COALESCE((
      SELECT COUNT(*)::bigint
      FROM public.listening_history lh
      WHERE (
        (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
        OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
      )
      AND lh.listened_at >= v_prev_start
      AND lh.listened_at < v_period_start
    ), 0)
    + COALESCE((
      SELECT COUNT(*)::bigint
      FROM public.video_playback_history vph
      WHERE cardinality(v_content_ids) > 0
        AND vph.content_id = ANY(v_content_ids)
        AND vph.watched_at >= v_prev_start
        AND vph.watched_at < v_period_start
    ), 0)
  INTO v_prev_streams;

  SELECT COUNT(*)::bigint INTO v_period_listeners FROM (
    SELECT lh.user_id
    FROM public.listening_history lh
    WHERE lh.user_id IS NOT NULL
      AND (
        (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
        OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
      )
      AND lh.listened_at >= v_period_start
      AND lh.listened_at < v_period_end
    UNION
    SELECT vph.user_id
    FROM public.video_playback_history vph
    WHERE vph.user_id IS NOT NULL
      AND cardinality(v_content_ids) > 0
      AND vph.content_id = ANY(v_content_ids)
      AND vph.watched_at >= v_period_start
      AND vph.watched_at < v_period_end
  ) listeners;

  SELECT COUNT(*)::bigint INTO v_prev_listeners FROM (
    SELECT lh.user_id
    FROM public.listening_history lh
    WHERE lh.user_id IS NOT NULL
      AND (
        (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
        OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
      )
      AND lh.listened_at >= v_prev_start
      AND lh.listened_at < v_period_start
    UNION
    SELECT vph.user_id
    FROM public.video_playback_history vph
    WHERE vph.user_id IS NOT NULL
      AND cardinality(v_content_ids) > 0
      AND vph.content_id = ANY(v_content_ids)
      AND vph.watched_at >= v_prev_start
      AND vph.watched_at < v_period_start
  ) listeners;

  SELECT COALESCE(SUM(acdp.payout_usd), 0) INTO v_period_revenue
  FROM public.ad_creator_daily_payouts acdp
  JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
  JOIN public.organization_artist_links oal
    ON oal.artist_profile_id = ap.id
   AND oal.organization_id = p_org_id
   AND oal.status = 'active'
  WHERE acdp.revenue_date >= v_period_start::date
    AND acdp.revenue_date < v_period_end::date;

  SELECT COALESCE(SUM(acdp.payout_usd), 0) INTO v_prev_revenue
  FROM public.ad_creator_daily_payouts acdp
  JOIN public.artist_profiles ap ON ap.artist_id = acdp.artist_id
  JOIN public.organization_artist_links oal
    ON oal.artist_profile_id = ap.id
   AND oal.organization_id = p_org_id
   AND oal.status = 'active'
  WHERE acdp.revenue_date >= v_prev_start::date
    AND acdp.revenue_date < v_period_start::date;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', day_bucket.day::text,
      'streams', day_bucket.streams,
      'listeners', day_bucket.listeners
    )
    ORDER BY day_bucket.day
  ), '[]'::jsonb)
  INTO v_growth_chart
  FROM (
    SELECT
      gs.day::date AS day,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.listening_history lh
        WHERE (
          (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
          OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
        )
        AND lh.listened_at >= gs.day
        AND lh.listened_at < gs.day + interval '1 day'
      ), 0)
      + COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.video_playback_history vph
        WHERE cardinality(v_content_ids) > 0
          AND vph.content_id = ANY(v_content_ids)
          AND vph.watched_at >= gs.day
          AND vph.watched_at < gs.day + interval '1 day'
      ), 0) AS streams,
      (
        SELECT COUNT(*)::bigint
        FROM (
          SELECT lh.user_id
          FROM public.listening_history lh
          WHERE lh.user_id IS NOT NULL
            AND (
              (cardinality(v_song_ids) > 0 AND lh.song_id = ANY(v_song_ids))
              OR (cardinality(v_content_ids) > 0 AND lh.content_upload_id = ANY(v_content_ids))
            )
            AND lh.listened_at >= gs.day
            AND lh.listened_at < gs.day + interval '1 day'
          UNION
          SELECT vph.user_id
          FROM public.video_playback_history vph
          WHERE vph.user_id IS NOT NULL
            AND cardinality(v_content_ids) > 0
            AND vph.content_id = ANY(v_content_ids)
            AND vph.watched_at >= gs.day
            AND vph.watched_at < gs.day + interval '1 day'
        ) daily_listeners
      ) AS listeners
    FROM generate_series(v_period_start, v_period_end - interval '1 day', interval '1 day') AS gs(day)
  ) day_bucket;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'artist_profile_id', ranked.artist_profile_id,
      'stage_name', ranked.stage_name,
      'streams', ranked.period_streams
    )
    ORDER BY ranked.period_streams DESC
  ), '[]'::jsonb)
  INTO v_top_artists
  FROM (
    SELECT
      ap.id AS artist_profile_id,
      ap.stage_name,
      COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.listening_history lh
        JOIN public.songs s ON s.id = lh.song_id
        WHERE s.artist_id = ap.artist_id
          AND lh.listened_at >= v_period_start
          AND lh.listened_at < v_period_end
      ), 0)
      + COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.listening_history lh
        JOIN public.content_uploads cu ON cu.id = lh.content_upload_id
        WHERE (cu.user_id = oal.user_id OR cu.artist_profile_id = ap.id)
          AND lh.listened_at >= v_period_start
          AND lh.listened_at < v_period_end
      ), 0)
      + COALESCE((
        SELECT COUNT(*)::bigint
        FROM public.video_playback_history vph
        JOIN public.content_uploads cu ON cu.id = vph.content_id
        WHERE (cu.user_id = oal.user_id OR cu.artist_profile_id = ap.id)
          AND vph.watched_at >= v_period_start
          AND vph.watched_at < v_period_end
      ), 0) AS period_streams
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    WHERE oal.organization_id = p_org_id AND oal.status = 'active'
    ORDER BY period_streams DESC
    LIMIT 3
  ) ranked;

  SELECT jsonb_build_object(
    'artist_profile_id', growth.artist_profile_id,
    'stage_name', growth.stage_name,
    'streams', growth.current_streams,
    'growth_pct', growth.growth_pct
  )
  INTO v_fastest_artist
  FROM (
    SELECT
      ap.id AS artist_profile_id,
      ap.stage_name,
      curr.current_streams,
      CASE
        WHEN COALESCE(prev.previous_streams, 0) = 0 AND curr.current_streams > 0 THEN 100
        WHEN COALESCE(prev.previous_streams, 0) = 0 THEN 0
        ELSE ROUND(((curr.current_streams - prev.previous_streams)::numeric / prev.previous_streams) * 100, 1)
      END AS growth_pct
    FROM public.organization_artist_links oal
    JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
    CROSS JOIN LATERAL (
      SELECT
        COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          JOIN public.songs s ON s.id = lh.song_id
          WHERE s.artist_id = ap.artist_id
            AND lh.listened_at >= v_period_start
            AND lh.listened_at < v_period_end
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          JOIN public.content_uploads cu ON cu.id = lh.content_upload_id
          WHERE (cu.user_id = oal.user_id OR cu.artist_profile_id = ap.id)
            AND lh.listened_at >= v_period_start
            AND lh.listened_at < v_period_end
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.video_playback_history vph
          JOIN public.content_uploads cu ON cu.id = vph.content_id
          WHERE (cu.user_id = oal.user_id OR cu.artist_profile_id = ap.id)
            AND vph.watched_at >= v_period_start
            AND vph.watched_at < v_period_end
        ), 0) AS current_streams
    ) curr
    CROSS JOIN LATERAL (
      SELECT
        COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          JOIN public.songs s ON s.id = lh.song_id
          WHERE s.artist_id = ap.artist_id
            AND lh.listened_at >= v_prev_start
            AND lh.listened_at < v_period_start
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.listening_history lh
          JOIN public.content_uploads cu ON cu.id = lh.content_upload_id
          WHERE (cu.user_id = oal.user_id OR cu.artist_profile_id = ap.id)
            AND lh.listened_at >= v_prev_start
            AND lh.listened_at < v_period_start
        ), 0)
        + COALESCE((
          SELECT COUNT(*)::bigint
          FROM public.video_playback_history vph
          JOIN public.content_uploads cu ON cu.id = vph.content_id
          WHERE (cu.user_id = oal.user_id OR cu.artist_profile_id = ap.id)
            AND vph.watched_at >= v_prev_start
            AND vph.watched_at < v_period_start
        ), 0) AS previous_streams
    ) prev
    WHERE oal.organization_id = p_org_id
      AND oal.status = 'active'
      AND curr.current_streams > 0
    ORDER BY growth_pct DESC, curr.current_streams DESC
    LIMIT 1
  ) growth;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', al.id,
      'action', al.action,
      'artist_profile_id', al.artist_profile_id,
      'metadata', al.metadata,
      'created_at', al.created_at
    )
    ORDER BY al.created_at DESC
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
    'period_days', v_days,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'total_artists', v_total_artists,
    'artists_added', v_artists_added,
    'total_streams', v_total_streams,
    'period_streams', v_period_streams,
    'previous_period_streams', v_prev_streams,
    'period_listeners', v_period_listeners,
    'previous_period_listeners', v_prev_listeners,
    'total_followers', v_total_followers,
    'total_revenue', v_total_revenue,
    'period_revenue', v_period_revenue,
    'previous_period_revenue', v_prev_revenue,
    'total_songs', v_total_songs,
    'total_albums', v_total_albums,
    'total_videos', v_total_videos,
    'total_releases', v_total_releases,
    'top_performing_artists', v_top_artists,
    'top_performing_artist', CASE WHEN jsonb_array_length(v_top_artists) > 0 THEN v_top_artists->0 ELSE NULL END,
    'fastest_growing_artist', v_fastest_artist,
    'growth_chart', v_growth_chart,
    'recent_activity', v_recent_activity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_organization_dashboard(uuid, integer) TO authenticated;
