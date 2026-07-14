/*
  # ALMC — Airaplay Label & Management Console (Phase 1 MVP)

  Organization accounts, team roles, artist delegation links,
  invitations, dashboard RPCs, and content-upload RLS for org members.
*/

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('label', 'management', 'distributor', 'entertainment')),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  email text NOT NULL,
  phone text,
  country text NOT NULL,
  website text,
  business_registration_number text,
  description text,
  verification_status text NOT NULL DEFAULT 'approved'
    CHECK (verification_status IN ('pending', 'approved', 'rejected', 'suspended')),
  verified_at timestamptz,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_verification_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_type text NOT NULL DEFAULT 'business_registration',
  file_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_roles (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  permissions text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_key text NOT NULL REFERENCES public.organization_roles(key) ON DELETE RESTRICT,
  custom_permissions text[] NOT NULL DEFAULT '{}'::text[],
  invited_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  joined_at timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.organization_artist_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  artist_profile_id uuid NOT NULL REFERENCES public.artist_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending_invite', 'active', 'suspended', 'revoked')),
  permission_preset text NOT NULL DEFAULT 'full_management',
  custom_permissions text[] NOT NULL DEFAULT '{}'::text[],
  linked_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  revocation_reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, artist_profile_id)
);

CREATE TABLE IF NOT EXISTS public.organization_artist_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invitee_email text NOT NULL,
  invitee_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  artist_profile_id uuid REFERENCES public.artist_profiles(id) ON DELETE SET NULL,
  invitation_type text NOT NULL DEFAULT 'link_existing'
    CHECK (invitation_type IN ('link_existing', 'create_new')),
  artist_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_hash text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}'::text[],
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.organization_member_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invitee_email text NOT NULL,
  role_key text NOT NULL REFERENCES public.organization_roles(key) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  invited_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.organization_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  artist_profile_id uuid REFERENCES public.artist_profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text,
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations(slug);
CREATE INDEX IF NOT EXISTS idx_org_members_user_active
  ON public.organization_members(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_org_members_org_active
  ON public.organization_members(organization_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_org_artist_links_org_status
  ON public.organization_artist_links(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_org_artist_links_user
  ON public.organization_artist_links(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_org_artist_invitations_email
  ON public.organization_artist_invitations(invitee_email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_org_activity_org_created
  ON public.organization_activity_logs(organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Seed system roles
-- ---------------------------------------------------------------------------

INSERT INTO public.organization_roles (key, name, description, is_system, permissions) VALUES
  ('owner', 'Owner', 'Full workspace access including billing and team management', true, ARRAY[
    'org.manage', 'org.settings', 'team.manage', 'team.invite',
    'artists.view', 'artists.create', 'artists.invite', 'artists.revoke',
    'content.view', 'content.upload', 'analytics.view'
  ]),
  ('admin', 'Administrator', 'Full operational access', true, ARRAY[
    'org.settings', 'team.manage', 'team.invite',
    'artists.view', 'artists.create', 'artists.invite', 'artists.revoke',
    'content.view', 'content.upload', 'analytics.view'
  ]),
  ('content_manager', 'Content Manager', 'Manage roster content and releases', true, ARRAY[
    'artists.view', 'artists.create', 'artists.invite',
    'content.view', 'content.upload', 'analytics.view'
  ]),
  ('viewer', 'Viewer', 'Read-only access to roster and analytics', true, ARRAY[
    'artists.view', 'content.view', 'analytics.view'
  ])
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  permissions = EXCLUDED.permissions;

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.slugify_org_name(input_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' from lower(regexp_replace(coalesce(input_name, 'org'), '[^a-zA-Z0-9]+', '-', 'g')));
$$;

CREATE OR REPLACE FUNCTION public.is_active_org_member(p_org_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_org_id
      AND om.user_id = p_user_id
      AND om.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_org_member_permissions(p_org_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT COALESCE(
    (
      SELECT om.custom_permissions || r.permissions
      FROM public.organization_members om
      JOIN public.organization_roles r ON r.key = om.role_key
      WHERE om.organization_id = p_org_id
        AND om.user_id = p_user_id
        AND om.status = 'active'
      LIMIT 1
    ),
    ARRAY[]::text[]
  );
$$;

CREATE OR REPLACE FUNCTION public.org_member_has_permission(
  p_org_id uuid,
  p_permission text,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT p_permission = ANY (public.get_org_member_permissions(p_org_id, p_user_id));
$$;

CREATE OR REPLACE FUNCTION public.org_can_manage_artist_user(p_target_user_id uuid, p_org_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_artist_links oal
    JOIN public.organization_members om
      ON om.organization_id = oal.organization_id
     AND om.user_id = auth.uid()
     AND om.status = 'active'
    WHERE oal.user_id = p_target_user_id
      AND oal.status = 'active'
      AND (p_org_id IS NULL OR oal.organization_id = p_org_id)
      AND (
        public.org_member_has_permission(oal.organization_id, 'content.upload', auth.uid())
        OR public.org_member_has_permission(oal.organization_id, 'artists.create', auth.uid())
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.log_organization_activity(
  p_org_id uuid,
  p_action text,
  p_artist_profile_id uuid DEFAULT NULL,
  p_resource_type text DEFAULT NULL,
  p_resource_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  INSERT INTO public.organization_activity_logs (
    organization_id,
    actor_user_id,
    artist_profile_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    p_org_id,
    auth.uid(),
    p_artist_profile_id,
    p_action,
    p_resource_type,
    p_resource_id,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_active_org_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_member_permissions(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_member_has_permission(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_can_manage_artist_user(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_organization_activity(uuid, text, uuid, text, uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_organization(
  p_type text,
  p_name text,
  p_email text,
  p_country text,
  p_phone text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_business_registration_number text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_logo_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_slug text;
  v_org_id uuid;
  v_suffix int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_type NOT IN ('label', 'management', 'distributor', 'entertainment') THEN
    RAISE EXCEPTION 'Invalid organization type';
  END IF;

  IF length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Organization name is too short';
  END IF;

  v_slug := public.slugify_org_name(p_name);
  WHILE EXISTS (SELECT 1 FROM public.organizations o WHERE o.slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug := public.slugify_org_name(p_name) || '-' || v_suffix::text;
  END LOOP;

  INSERT INTO public.organizations (
    type, name, slug, logo_url, email, phone, country, website,
    business_registration_number, description, verification_status,
    verified_at, created_by
  ) VALUES (
    p_type, trim(p_name), v_slug, p_logo_url, trim(p_email), p_phone, p_country, p_website,
    p_business_registration_number, p_description, 'approved', now(), v_user_id
  )
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_members (
    organization_id, user_id, role_key, joined_at, status
  ) VALUES (
    v_org_id, v_user_id, 'owner', now(), 'active'
  );

  PERFORM public.log_organization_activity(v_org_id, 'organization_created', NULL, 'organization', v_org_id,
    jsonb_build_object('type', p_type, 'name', p_name));

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_org_id,
    'slug', v_slug
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_organizations()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_orgs jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('organizations', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'type', o.type,
      'name', o.name,
      'slug', o.slug,
      'logo_url', o.logo_url,
      'role_key', om.role_key,
      'role_name', r.name,
      'permissions', public.get_org_member_permissions(o.id, v_user_id)
    ) ORDER BY o.name
  ), '[]'::jsonb)
  INTO v_orgs
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  JOIN public.organization_roles r ON r.key = om.role_key
  WHERE om.user_id = v_user_id
    AND om.status = 'active';

  RETURN jsonb_build_object('organizations', v_orgs);
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
  v_fastest_artist jsonb := NULL;
  v_recent_activity jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'analytics.view', v_user_id) THEN
    RAISE EXCEPTION 'Missing analytics permission';
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
      oal.artist_profile_id,
      COALESCE((
        SELECT SUM(s.play_count)
        FROM public.artist_profiles ap
        LEFT JOIN public.artists a ON a.id = ap.artist_id
        LEFT JOIN public.songs s ON s.artist_id = a.id
        WHERE ap.id = oal.artist_profile_id
      ), 0)
      + COALESCE((
        SELECT SUM(cu.play_count)
        FROM public.content_uploads cu
        WHERE cu.user_id = oal.user_id
      ), 0) AS streams,
      COALESCE((
        SELECT COUNT(*)
        FROM public.artist_profiles ap
        LEFT JOIN public.artists a ON a.id = ap.artist_id
        LEFT JOIN public.songs s ON s.artist_id = a.id
        WHERE ap.id = oal.artist_profile_id
      ), 0)::bigint AS songs,
      COALESCE((
        SELECT COUNT(*)
        FROM public.albums al
        JOIN public.artist_profiles ap ON ap.artist_id = al.artist_id
        WHERE ap.id = oal.artist_profile_id
      ), 0)::bigint AS albums,
      COALESCE((
        SELECT COUNT(*)
        FROM public.content_uploads cu
        WHERE cu.user_id = oal.user_id
          AND cu.content_type IN ('video', 'short_clip')
      ), 0)::bigint AS videos,
      COALESCE((
        SELECT COUNT(*)
        FROM public.user_follows uf
        WHERE uf.following_id = oal.user_id
      ), 0)::bigint AS followers,
      COALESCE((
        SELECT tw.balance + tw.promo_balance
        FROM public.treat_wallets tw
        WHERE tw.user_id = oal.user_id
      ), 0)::numeric AS revenue
    FROM public.organization_artist_links oal
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
        SELECT SUM(s.play_count)
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
    'fastest_growing_artist', v_fastest_artist,
    'recent_activity', v_recent_activity
  );
END;
$$;

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

  SELECT COUNT(*)::int
  INTO v_total
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
    );

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      oal.id AS link_id,
      oal.status AS link_status,
      oal.linked_at,
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
        SELECT COUNT(*)
        FROM public.user_follows uf
        WHERE uf.following_id = u.id
      ), 0) AS followers,
      COALESCE((
        SELECT SUM(s.play_count)
        FROM public.artists a
        LEFT JOIN public.songs s ON s.artist_id = a.id
        WHERE a.id = ap.artist_id
      ), 0)
      + COALESCE((
        SELECT SUM(cu.play_count)
        FROM public.content_uploads cu
        WHERE cu.user_id = u.id
      ), 0) AS streams,
      COALESCE((
        SELECT tw.balance + tw.promo_balance
        FROM public.treat_wallets tw
        WHERE tw.user_id = u.id
      ), 0) AS revenue,
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
    ORDER BY ap.stage_name
    LIMIT GREATEST(p_limit, 1)
    OFFSET GREATEST(p_offset, 0)
  ) t;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_artist_to_organization(
  p_org_id uuid,
  p_email text,
  p_invitation_type text DEFAULT 'link_existing',
  p_artist_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text := lower(trim(p_email));
  v_invitee_user_id uuid;
  v_artist_profile_id uuid;
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_invitation_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'artists.invite', v_user_id) THEN
    RAISE EXCEPTION 'Missing artists.invite permission';
  END IF;

  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;

  SELECT u.id INTO v_invitee_user_id
  FROM public.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;

  IF v_invitee_user_id IS NOT NULL THEN
    SELECT ap.id INTO v_artist_profile_id
    FROM public.artist_profiles ap
    WHERE ap.user_id = v_invitee_user_id
    LIMIT 1;

    IF v_artist_profile_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.organization_artist_links oal
      WHERE oal.organization_id = p_org_id
        AND oal.artist_profile_id = v_artist_profile_id
        AND oal.status IN ('active', 'pending_invite')
    ) THEN
      RAISE EXCEPTION 'Artist is already linked or invited';
    END IF;
  END IF;

  INSERT INTO public.organization_artist_invitations (
    organization_id,
    invitee_email,
    invitee_user_id,
    artist_profile_id,
    invitation_type,
    artist_metadata,
    token_hash,
    permissions,
    expires_at,
    created_by
  ) VALUES (
    p_org_id,
    v_email,
    v_invitee_user_id,
    v_artist_profile_id,
    COALESCE(p_invitation_type, 'link_existing'),
    COALESCE(p_artist_metadata, '{}'::jsonb),
    v_token,
    ARRAY['content.upload', 'content.view'],
    now() + interval '7 days',
    v_user_id
  )
  RETURNING id INTO v_invitation_id;

  IF v_invitee_user_id IS NOT NULL AND v_artist_profile_id IS NOT NULL THEN
    INSERT INTO public.organization_artist_links (
      organization_id,
      artist_profile_id,
      user_id,
      status,
      created_by
    ) VALUES (
      p_org_id,
      v_artist_profile_id,
      v_invitee_user_id,
      'pending_invite',
      v_user_id
    )
    ON CONFLICT (organization_id, artist_profile_id) DO UPDATE
      SET status = 'pending_invite',
          updated_at = now();
  END IF;

  PERFORM public.log_organization_activity(
    p_org_id,
    'artist_invited',
    v_artist_profile_id,
    'invitation',
    v_invitation_id,
    jsonb_build_object('email', v_email, 'invitation_type', p_invitation_type)
  );

  RETURN jsonb_build_object(
    'success', true,
    'invitation_id', v_invitation_id,
    'invitee_user_id', v_invitee_user_id,
    'artist_profile_id', v_artist_profile_id,
    'token', v_token
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_artist_organization_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_inv public.organization_artist_invitations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_inv
  FROM public.organization_artist_invitations
  WHERE token_hash = p_token
    AND status = 'pending'
    AND expires_at > now()
  LIMIT 1;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invitation';
  END IF;

  IF v_inv.invitee_user_id IS NOT NULL AND v_inv.invitee_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Invitation does not belong to this account';
  END IF;

  IF v_inv.artist_profile_id IS NULL THEN
    SELECT ap.id INTO v_inv.artist_profile_id
    FROM public.artist_profiles ap
    WHERE ap.user_id = v_user_id
    LIMIT 1;

    IF v_inv.artist_profile_id IS NULL THEN
      RAISE EXCEPTION 'You need an approved artist profile before accepting this invitation';
    END IF;
  END IF;

  UPDATE public.organization_artist_invitations
  SET status = 'accepted',
      responded_at = now(),
      invitee_user_id = v_user_id,
      artist_profile_id = v_inv.artist_profile_id
  WHERE id = v_inv.id;

  INSERT INTO public.organization_artist_links (
    organization_id,
    artist_profile_id,
    user_id,
    status,
    linked_at,
    created_by
  ) VALUES (
    v_inv.organization_id,
    v_inv.artist_profile_id,
    v_user_id,
    'active',
    now(),
    v_inv.created_by
  )
  ON CONFLICT (organization_id, artist_profile_id) DO UPDATE
    SET status = 'active',
        linked_at = now(),
        revoked_at = NULL,
        revoked_by = NULL,
        updated_at = now();

  PERFORM public.log_organization_activity(
    v_inv.organization_id,
    'artist_invitation_accepted',
    v_inv.artist_profile_id,
    'invitation',
    v_inv.id,
    jsonb_build_object('user_id', v_user_id)
  );

  RETURN jsonb_build_object('success', true, 'organization_id', v_inv.organization_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_organization_artist_access(
  p_org_id uuid,
  p_artist_profile_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_active_org_member(p_org_id, v_user_id)
     AND NOT EXISTS (
       SELECT 1
       FROM public.artist_profiles ap
       WHERE ap.id = p_artist_profile_id
         AND ap.user_id = v_user_id
     ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF public.is_active_org_member(p_org_id, v_user_id)
     AND NOT public.org_member_has_permission(p_org_id, 'artists.revoke', v_user_id) THEN
    RAISE EXCEPTION 'Missing artists.revoke permission';
  END IF;

  UPDATE public.organization_artist_links
  SET status = 'revoked',
      revoked_at = now(),
      revoked_by = v_user_id,
      revocation_reason = p_reason,
      updated_at = now()
  WHERE organization_id = p_org_id
    AND artist_profile_id = p_artist_profile_id
    AND status IN ('active', 'pending_invite', 'suspended');

  PERFORM public.log_organization_activity(
    p_org_id,
    'artist_access_revoked',
    p_artist_profile_id,
    'artist_link',
    p_artist_profile_id,
    jsonb_build_object('reason', p_reason, 'revoked_by', v_user_id)
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_organization_member(
  p_org_id uuid,
  p_email text,
  p_role_key text DEFAULT 'viewer'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text := lower(trim(p_email));
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_invitation_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'team.invite', v_user_id) THEN
    RAISE EXCEPTION 'Missing team.invite permission';
  END IF;

  IF p_role_key = 'owner' THEN
    RAISE EXCEPTION 'Cannot invite as owner';
  END IF;

  INSERT INTO public.organization_member_invitations (
    organization_id,
    invitee_email,
    role_key,
    token_hash,
    expires_at,
    invited_by
  ) VALUES (
    p_org_id,
    v_email,
    p_role_key,
    v_token,
    now() + interval '7 days',
    v_user_id
  )
  RETURNING id INTO v_invitation_id;

  PERFORM public.log_organization_activity(
    p_org_id,
    'team_member_invited',
    NULL,
    'member_invitation',
    v_invitation_id,
    jsonb_build_object('email', v_email, 'role_key', p_role_key)
  );

  RETURN jsonb_build_object('success', true, 'invitation_id', v_invitation_id, 'token', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_organization_member_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_inv public.organization_member_invitations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT u.email INTO v_email FROM public.users u WHERE u.id = v_user_id;

  SELECT *
  INTO v_inv
  FROM public.organization_member_invitations
  WHERE token_hash = p_token
    AND status = 'pending'
    AND expires_at > now()
  LIMIT 1;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invitation';
  END IF;

  IF lower(v_inv.invitee_email) <> lower(v_email) THEN
    RAISE EXCEPTION 'Invitation email does not match your account';
  END IF;

  UPDATE public.organization_member_invitations
  SET status = 'accepted', responded_at = now()
  WHERE id = v_inv.id;

  INSERT INTO public.organization_members (
    organization_id, user_id, role_key, invited_by, joined_at, status
  ) VALUES (
    v_inv.organization_id, v_user_id, v_inv.role_key, v_inv.invited_by, now(), 'active'
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role_key = EXCLUDED.role_key,
        status = 'active',
        joined_at = now(),
        updated_at = now();

  PERFORM public.log_organization_activity(
    v_inv.organization_id,
    'team_member_joined',
    NULL,
    'member',
    v_user_id,
    jsonb_build_object('role_key', v_inv.role_key)
  );

  RETURN jsonb_build_object('success', true, 'organization_id', v_inv.organization_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_organization_members(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_members jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', om.id,
      'user_id', om.user_id,
      'email', u.email,
      'display_name', u.display_name,
      'avatar_url', u.avatar_url,
      'role_key', om.role_key,
      'role_name', r.name,
      'status', om.status,
      'joined_at', om.joined_at
    ) ORDER BY r.name, u.display_name
  ), '[]'::jsonb)
  INTO v_members
  FROM public.organization_members om
  JOIN public.users u ON u.id = om.user_id
  JOIN public.organization_roles r ON r.key = om.role_key
  WHERE om.organization_id = p_org_id
    AND om.status IN ('active', 'pending');

  RETURN jsonb_build_object('members', v_members);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_organizations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_dashboard(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_organization_artists(uuid, text, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_artist_to_organization(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_artist_organization_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_organization_artist_access(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_organization_member(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_organization_member_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_organization_members(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_artist_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_artist_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_member_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_activity_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organizations FROM PUBLIC;
REVOKE ALL ON public.organization_verification_documents FROM PUBLIC;
REVOKE ALL ON public.organization_roles FROM PUBLIC;
REVOKE ALL ON public.organization_members FROM PUBLIC;
REVOKE ALL ON public.organization_artist_links FROM PUBLIC;
REVOKE ALL ON public.organization_artist_invitations FROM PUBLIC;
REVOKE ALL ON public.organization_member_invitations FROM PUBLIC;
REVOKE ALL ON public.organization_activity_logs FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON public.organizations TO authenticated;
GRANT SELECT, INSERT ON public.organization_verification_documents TO authenticated;
GRANT SELECT ON public.organization_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.organization_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.organization_artist_links TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.organization_artist_invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.organization_member_invitations TO authenticated;
GRANT SELECT ON public.organization_activity_logs TO authenticated;

CREATE POLICY "Org members can view their organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.is_active_org_member(id));

CREATE POLICY "Org members can update organization profile"
  ON public.organizations FOR UPDATE TO authenticated
  USING (public.org_member_has_permission(id, 'org.settings'))
  WITH CHECK (public.org_member_has_permission(id, 'org.settings'));

CREATE POLICY "Authenticated users can create organizations via RPC"
  ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Org members can view roles"
  ON public.organization_roles FOR SELECT TO authenticated
  USING (is_system = true OR public.is_active_org_member(organization_id));

CREATE POLICY "Org members can view team"
  ON public.organization_members FOR SELECT TO authenticated
  USING (public.is_active_org_member(organization_id));

CREATE POLICY "Org members can view artist links"
  ON public.organization_artist_links FOR SELECT TO authenticated
  USING (
    public.is_active_org_member(organization_id)
    OR user_id = auth.uid()
  );

CREATE POLICY "Org members can view activity logs"
  ON public.organization_activity_logs FOR SELECT TO authenticated
  USING (public.is_active_org_member(organization_id));

CREATE POLICY "Org members can view artist invitations"
  ON public.organization_artist_invitations FOR SELECT TO authenticated
  USING (
    public.is_active_org_member(organization_id)
    OR invitee_user_id = auth.uid()
    OR lower(invitee_email) = lower((SELECT email FROM public.users WHERE id = auth.uid()))
  );

CREATE POLICY "Org members can view member invitations"
  ON public.organization_member_invitations FOR SELECT TO authenticated
  USING (
    public.is_active_org_member(organization_id)
    OR lower(invitee_email) = lower((SELECT email FROM public.users WHERE id = auth.uid()))
  );

-- Org content delegation (mirrors admin_manage_user_content)
CREATE POLICY "Org members can upload content for linked artists"
  ON public.content_uploads FOR INSERT TO authenticated
  WITH CHECK (public.org_can_manage_artist_user(user_id));

CREATE POLICY "Org members can update content for linked artists"
  ON public.content_uploads FOR UPDATE TO authenticated
  USING (public.org_can_manage_artist_user(user_id))
  WITH CHECK (public.org_can_manage_artist_user(user_id));

CREATE POLICY "Org members can insert songs for linked artists"
  ON public.songs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_artist_links oal
      JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
      WHERE oal.user_id = auth.uid() OR (
        oal.status = 'active'
        AND ap.artist_id = songs.artist_id
        AND public.org_can_manage_artist_user(oal.user_id)
      )
    )
    OR public.org_can_manage_artist_user(auth.uid())
  );

-- Simpler songs policy via artist_id lookup
DROP POLICY IF EXISTS "Org members can insert songs for linked artists" ON public.songs;

CREATE POLICY "Org members can insert songs for linked artists"
  ON public.songs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_artist_links oal
      JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
      WHERE oal.status = 'active'
        AND ap.artist_id = songs.artist_id
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  );

CREATE POLICY "Org members can update songs for linked artists"
  ON public.songs FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_artist_links oal
      JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
      WHERE oal.status = 'active'
        AND ap.artist_id = songs.artist_id
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_artist_links oal
      JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
      WHERE oal.status = 'active'
        AND ap.artist_id = songs.artist_id
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  );

CREATE POLICY "Org members can insert albums for linked artists"
  ON public.albums FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_artist_links oal
      JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
      WHERE oal.status = 'active'
        AND ap.artist_id = albums.artist_id
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  );

CREATE POLICY "Org members can update albums for linked artists"
  ON public.albums FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_artist_links oal
      JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
      WHERE oal.status = 'active'
        AND ap.artist_id = albums.artist_id
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_artist_links oal
      JOIN public.artist_profiles ap ON ap.id = oal.artist_profile_id
      WHERE oal.status = 'active'
        AND ap.artist_id = albums.artist_id
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  );

CREATE POLICY "Org members can update linked artist profiles"
  ON public.artist_profiles FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_artist_links oal
      WHERE oal.artist_profile_id = artist_profiles.id
        AND oal.status = 'active'
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_artist_links oal
      WHERE oal.artist_profile_id = artist_profiles.id
        AND oal.status = 'active'
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  );
