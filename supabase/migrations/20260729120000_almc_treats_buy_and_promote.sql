/*
  ALMC: allow org members to buy treats and promote linked artists
  they are scoped to (artist_scope + content.promote / treats.buy).
*/

-- ---------------------------------------------------------------------------
-- System role permissions
-- ---------------------------------------------------------------------------
UPDATE public.organization_roles
SET permissions = ARRAY[
  'org.manage', 'org.settings', 'team.manage', 'team.invite',
  'artists.view', 'artists.create', 'artists.invite', 'artists.revoke',
  'content.view', 'content.upload', 'content.promote', 'treats.buy', 'analytics.view'
]
WHERE key = 'owner' AND is_system = true;

UPDATE public.organization_roles
SET permissions = ARRAY[
  'org.settings', 'team.manage', 'team.invite',
  'artists.view', 'artists.create', 'artists.invite', 'artists.revoke',
  'content.view', 'content.upload', 'content.promote', 'treats.buy', 'analytics.view'
]
WHERE key = 'admin' AND is_system = true;

UPDATE public.organization_roles
SET permissions = ARRAY[
  'artists.view', 'artists.create', 'artists.invite',
  'content.view', 'content.upload', 'content.promote', 'treats.buy', 'analytics.view'
]
WHERE key = 'content_manager' AND is_system = true;

-- ---------------------------------------------------------------------------
-- Artist-link permission presets (full management includes promote + treats)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_artist_permissions_for_preset(p_preset text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO public
AS $$
  SELECT CASE COALESCE(NULLIF(lower(trim(p_preset)), ''), 'full_management')
    WHEN 'upload_only' THEN ARRAY['content.view', 'content.upload']::text[]
    WHEN 'view_only' THEN ARRAY['content.view']::text[]
    ELSE ARRAY[
      'content.view',
      'content.upload',
      'content.promote',
      'treats.buy'
    ]::text[]
  END;
$$;

-- ---------------------------------------------------------------------------
-- Custom role allow-list
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_organization_custom_role(
  p_org_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_permissions text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_key text;
  v_name text := trim(p_name);
  v_allowed text[] := ARRAY[
    'org.settings', 'team.manage', 'team.invite',
    'artists.view', 'artists.create', 'artists.invite', 'artists.revoke',
    'content.view', 'content.upload', 'content.promote', 'treats.buy', 'analytics.view'
  ];
  v_perms text[];
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'team.manage', v_user_id) THEN
    RAISE EXCEPTION 'Missing team.manage permission';
  END IF;

  IF v_name IS NULL OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'Role name is required';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT p), ARRAY[]::text[])
  INTO v_perms
  FROM unnest(COALESCE(p_permissions, ARRAY[]::text[])) AS p
  WHERE p = ANY (v_allowed)
    AND p <> 'org.manage';

  IF cardinality(v_perms) = 0 THEN
    RAISE EXCEPTION 'Select at least one permission';
  END IF;

  v_key := 'c_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.organization_roles (
    key, name, description, is_system, organization_id, permissions
  ) VALUES (
    v_key,
    v_name,
    NULLIF(trim(COALESCE(p_description, '')), ''),
    false,
    p_org_id,
    v_perms
  );

  PERFORM public.log_organization_activity(
    p_org_id,
    'custom_role_created',
    NULL,
    'role',
    NULL,
    jsonb_build_object('role_key', v_key, 'name', v_name, 'permissions', to_jsonb(v_perms))
  );

  RETURN jsonb_build_object(
    'success', true,
    'key', v_key,
    'name', v_name,
    'permissions', to_jsonb(v_perms)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Member ↔ artist access (respects artist_scope)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_member_can_access_artist(
  p_org_id uuid,
  p_artist_profile_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    INNER JOIN public.organization_artist_links oal
      ON oal.organization_id = om.organization_id
     AND oal.artist_profile_id = p_artist_profile_id
     AND oal.status = 'active'
    WHERE om.organization_id = p_org_id
      AND om.user_id = p_user_id
      AND om.status = 'active'
      AND (
        om.artist_scope = 'all'
        OR om.role_key IN ('owner', 'admin')
        OR EXISTS (
          SELECT 1
          FROM public.organization_member_artist_scopes s
          WHERE s.member_id = om.id
            AND s.organization_id = p_org_id
            AND s.artist_profile_id = p_artist_profile_id
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.org_member_can_promote_artist(
  p_org_id uuid,
  p_artist_profile_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    public.org_member_has_permission(p_org_id, 'content.promote', p_user_id)
    AND public.org_member_can_access_artist(p_org_id, p_artist_profile_id, p_user_id);
$$;

CREATE OR REPLACE FUNCTION public.org_user_can_promote_artist_profile(
  p_user_id uuid,
  p_artist_profile_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_artist_links oal
    WHERE oal.artist_profile_id = p_artist_profile_id
      AND oal.status = 'active'
      AND public.org_member_can_promote_artist(oal.organization_id, p_artist_profile_id, p_user_id)
  );
$$;

-- Resolve artist_profile_id for a promotion target
CREATE OR REPLACE FUNCTION public.resolve_promotion_target_artist_profile(
  p_promotion_type text,
  p_target_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_artist_profile_id uuid;
BEGIN
  IF p_promotion_type = 'profile' THEN
    SELECT ap.id INTO v_artist_profile_id
    FROM public.artist_profiles ap
    WHERE ap.user_id = p_target_id
    LIMIT 1;
    RETURN v_artist_profile_id;
  END IF;

  IF p_promotion_type = 'song' THEN
    SELECT ap.id INTO v_artist_profile_id
    FROM public.songs s
    JOIN public.artist_profiles ap ON ap.artist_id = s.artist_id
    WHERE s.id = p_target_id
    LIMIT 1;
    IF v_artist_profile_id IS NOT NULL THEN
      RETURN v_artist_profile_id;
    END IF;
    -- Fallback: singles stored as content_uploads
    SELECT cu.artist_profile_id INTO v_artist_profile_id
    FROM public.content_uploads cu
    WHERE cu.id = p_target_id
      AND cu.content_type IN ('single', 'song')
    LIMIT 1;
    RETURN v_artist_profile_id;
  END IF;

  IF p_promotion_type = 'album' THEN
    SELECT ap.id INTO v_artist_profile_id
    FROM public.albums a
    JOIN public.artist_profiles ap ON ap.artist_id = a.artist_id
    WHERE a.id = p_target_id
    LIMIT 1;
    IF v_artist_profile_id IS NOT NULL THEN
      RETURN v_artist_profile_id;
    END IF;
    SELECT cu.artist_profile_id INTO v_artist_profile_id
    FROM public.content_uploads cu
    WHERE cu.id = p_target_id
      AND cu.content_type = 'album'
    LIMIT 1;
    RETURN v_artist_profile_id;
  END IF;

  IF p_promotion_type IN ('video', 'short_clip') THEN
    SELECT COALESCE(
      cu.artist_profile_id,
      (
        SELECT ap.id
        FROM public.artist_profiles ap
        WHERE ap.user_id = cu.user_id
        LIMIT 1
      )
    )
    INTO v_artist_profile_id
    FROM public.content_uploads cu
    WHERE cu.id = p_target_id
      AND cu.content_type IN ('video', 'short_clip')
    LIMIT 1;
    RETURN v_artist_profile_id;
  END IF;

  IF p_promotion_type = 'playlist' THEN
    SELECT ap.id INTO v_artist_profile_id
    FROM public.playlists p
    JOIN public.artist_profiles ap ON ap.user_id = p.user_id
    WHERE p.id = p_target_id
    LIMIT 1;
    RETURN v_artist_profile_id;
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.org_member_can_access_artist(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_member_can_promote_artist(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_user_can_promote_artist_profile(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_promotion_target_artist_profile(text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Promotion ownership: creators OR ALMC members with promote permission
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS validate_content_ownership_trigger ON public.promotions;
DROP FUNCTION IF EXISTS public.validate_content_ownership();

CREATE OR REPLACE FUNCTION public.validate_content_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner boolean := false;
  v_user_artist_id uuid;
  v_target_artist_profile_id uuid;
BEGIN
  SELECT artist_id INTO v_user_artist_id
  FROM public.artist_profiles
  WHERE user_id = NEW.user_id
  LIMIT 1;

  v_target_artist_profile_id := public.resolve_promotion_target_artist_profile(
    NEW.promotion_type,
    NEW.target_id
  );

  -- ALMC path: org member may promote linked artists in their scope
  IF v_target_artist_profile_id IS NOT NULL
     AND public.org_user_can_promote_artist_profile(NEW.user_id, v_target_artist_profile_id) THEN
    RETURN NEW;
  END IF;

  -- Creator path (self-owned content)
  IF v_user_artist_id IS NULL THEN
    RAISE EXCEPTION 'You must be a creator to promote content, or an organization member with promote permission for this artist.';
  END IF;

  IF NEW.promotion_type = 'profile' THEN
    IF NEW.target_id::text = NEW.user_id::text THEN
      v_is_owner := true;
    ELSE
      RAISE EXCEPTION 'Profile promotions must be for your own profile or a managed artist';
    END IF;

  ELSIF NEW.promotion_type = 'song' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.songs
      WHERE id = NEW.target_id
        AND artist_id = v_user_artist_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      SELECT EXISTS (
        SELECT 1 FROM public.content_uploads
        WHERE id = NEW.target_id
          AND content_type IN ('single', 'song')
          AND user_id = NEW.user_id
      ) INTO v_is_owner;
    END IF;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote songs that you created or manage';
    END IF;

  ELSIF NEW.promotion_type = 'video' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.content_uploads
      WHERE id = NEW.target_id
        AND content_type = 'video'
        AND user_id = NEW.user_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote videos that you created or manage';
    END IF;

  ELSIF NEW.promotion_type = 'album' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.albums
      WHERE id = NEW.target_id
        AND artist_id = v_user_artist_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote albums that you created or manage';
    END IF;

  ELSIF NEW.promotion_type = 'playlist' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.playlists
      WHERE id = NEW.target_id
        AND user_id = NEW.user_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote playlists that you created or manage';
    END IF;

  ELSIF NEW.promotion_type = 'short_clip' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.content_uploads
      WHERE id = NEW.target_id
        AND content_type IN ('video', 'short_clip')
        AND user_id = NEW.user_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote short clips that you created or manage';
    END IF;

  ELSE
    RAISE EXCEPTION 'Unknown promotion type';
  END IF;

  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'You do not own the content being promoted';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_content_ownership_trigger
BEFORE INSERT ON public.promotions
FOR EACH ROW
EXECUTE FUNCTION public.validate_content_ownership();

COMMENT ON FUNCTION public.validate_content_ownership() IS
'Validates promotion targets: self-owned creator content, or ALMC-managed artists with content.promote + artist scope.';

GRANT EXECUTE ON FUNCTION public.validate_content_ownership() TO authenticated;

-- ---------------------------------------------------------------------------
-- Promotable catalog for a linked artist (ALMC console)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_org_artist_promotable_content(
  p_org_id uuid,
  p_artist_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_artist_id uuid;
  v_artist_user_id uuid;
  v_stage_name text;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_can_promote_artist(p_org_id, p_artist_profile_id, v_user_id) THEN
    RAISE EXCEPTION 'Missing promote permission for this artist';
  END IF;

  SELECT ap.artist_id, ap.user_id, ap.stage_name
  INTO v_artist_id, v_artist_user_id, v_stage_name
  FROM public.artist_profiles ap
  WHERE ap.id = p_artist_profile_id;

  IF v_artist_user_id IS NULL THEN
    RAISE EXCEPTION 'Artist not found';
  END IF;

  -- Profile card
  v_items := v_items || jsonb_build_array(
    jsonb_build_object(
      'id', v_artist_user_id,
      'title', COALESCE(v_stage_name, 'Artist profile'),
      'promotion_type', 'profile',
      'cover_url', (
        SELECT ap.profile_photo_url
        FROM public.artist_profiles ap
        WHERE ap.id = p_artist_profile_id
      )
    )
  );

  IF v_artist_id IS NOT NULL THEN
    SELECT COALESCE(v_items, '[]'::jsonb) || COALESCE(jsonb_agg(x.obj), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'promotion_type', 'song',
        'cover_url', s.cover_image_url
      ) AS obj
      FROM public.songs s
      WHERE s.artist_id = v_artist_id
        AND s.video_url IS NULL
      ORDER BY s.created_at DESC
      LIMIT 100
    ) x;

    SELECT COALESCE(v_items, '[]'::jsonb) || COALESCE(jsonb_agg(x.obj), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT jsonb_build_object(
        'id', a.id,
        'title', a.title,
        'promotion_type', 'album',
        'cover_url', a.cover_image_url
      ) AS obj
      FROM public.albums a
      WHERE a.artist_id = v_artist_id
      ORDER BY a.created_at DESC
      LIMIT 50
    ) x;
  END IF;

  SELECT COALESCE(v_items, '[]'::jsonb) || COALESCE(jsonb_agg(x.obj), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT jsonb_build_object(
      'id', cu.id,
      'title', cu.title,
      'promotion_type', CASE
        WHEN cu.content_type = 'short_clip' THEN 'short_clip'
        WHEN cu.content_type = 'album' THEN 'album'
        WHEN cu.content_type IN ('single', 'song') THEN 'song'
        ELSE 'video'
      END,
      'cover_url', COALESCE(
        NULLIF(trim(cu.metadata->>'cover_url'), ''),
        NULLIF(trim(cu.metadata->>'thumbnail_url'), ''),
        NULLIF(trim(cu.metadata->>'artwork_url'), '')
      )
    ) AS obj
    FROM public.content_uploads cu
    WHERE cu.artist_profile_id = p_artist_profile_id
      AND cu.content_type IN ('video', 'short_clip', 'single', 'song', 'album')
      AND cu.status IN ('approved', 'pending', 'published')
    ORDER BY cu.created_at DESC
    LIMIT 100
  ) x;

  RETURN jsonb_build_object('items', COALESCE(v_items, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_org_artist_promotable_content(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Scope filter on artist roster + content list
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

  SELECT COUNT(*)::int
  INTO v_total
  FROM public.content_uploads cu
  INNER JOIN public.organization_artist_links oal
    ON oal.artist_profile_id = cu.artist_profile_id
   AND oal.organization_id = p_org_id
   AND oal.status = 'active'
  WHERE (p_artist_profile_id IS NULL OR cu.artist_profile_id = p_artist_profile_id)
    AND public.org_member_can_access_artist(p_org_id, cu.artist_profile_id, v_user_id)
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
      AND public.org_member_can_access_artist(p_org_id, cu.artist_profile_id, v_user_id)
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
