/*
  # ALMC 5.9 Team Management

  - Member artist scopes (All vs selected roster)
  - Finance Manager system role
  - Enriched members list (artists label, last active, pending invites)
  - List / create custom roles
  - Update / remove members
*/

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS artist_scope text NOT NULL DEFAULT 'all';

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_members_artist_scope_check'
  ) THEN
    ALTER TABLE public.organization_members
      ADD CONSTRAINT organization_members_artist_scope_check
      CHECK (artist_scope IN ('all', 'selected'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.organization_member_artist_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.organization_members(id) ON DELETE CASCADE,
  artist_profile_id uuid NOT NULL REFERENCES public.artist_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, artist_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_org_member_artist_scopes_org
  ON public.organization_member_artist_scopes(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_member_artist_scopes_member
  ON public.organization_member_artist_scopes(member_id);

ALTER TABLE public.organization_member_artist_scopes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organization_member_artist_scopes FROM PUBLIC;
GRANT SELECT ON public.organization_member_artist_scopes TO authenticated;

DROP POLICY IF EXISTS "Org members can view member artist scopes"
  ON public.organization_member_artist_scopes;
CREATE POLICY "Org members can view member artist scopes"
  ON public.organization_member_artist_scopes FOR SELECT TO authenticated
  USING (public.is_active_org_member(organization_id));

-- Finance Manager (analytics/revenue view, no uploads/team)
INSERT INTO public.organization_roles (key, name, description, is_system, permissions) VALUES
  (
    'finance_manager',
    'Finance Manager',
    'View analytics and revenue across the roster (no uploads or team admin)',
    true,
    ARRAY['artists.view', 'content.view', 'analytics.view']
  )
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  permissions = EXCLUDED.permissions,
  is_system = true;

UPDATE public.organization_roles
SET description = CASE key
  WHEN 'owner' THEN 'Full access — billing, team, roster, content, and analytics'
  WHEN 'admin' THEN 'Full operational access — team, roster, content, and analytics'
  WHEN 'content_manager' THEN 'Upload, calendar, and drafts (no finance or team admin)'
  WHEN 'viewer' THEN 'Read-only roster and analytics'
  WHEN 'finance_manager' THEN 'View analytics and revenue (no uploads or team admin)'
  ELSE description
END
WHERE is_system = true;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.format_org_relative_activity(p_at timestamptz)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_days int;
BEGIN
  IF p_at IS NULL THEN
    RETURN '—';
  END IF;
  v_days := GREATEST(0, (CURRENT_DATE - p_at::date));
  IF v_days = 0 THEN
    RETURN 'Today';
  ELSIF v_days = 1 THEN
    RETURN 'Yesterday';
  ELSIF v_days < 7 THEN
    RETURN v_days::text || ' days ago';
  ELSIF v_days < 30 THEN
    RETURN (v_days / 7)::text || ' weeks ago';
  ELSE
    RETURN to_char(p_at, 'Mon DD, YYYY');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_organization_members (enriched)
-- ---------------------------------------------------------------------------

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
  v_pending jsonb;
  v_total_artists int := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*)::int
  INTO v_total_artists
  FROM public.organization_artist_links oal
  WHERE oal.organization_id = p_org_id
    AND oal.status = 'active';

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'user_id', m.user_id,
      'email', m.email,
      'display_name', m.display_name,
      'avatar_url', m.avatar_url,
      'role_key', m.role_key,
      'role_name', m.role_name,
      'status', m.status,
      'joined_at', m.joined_at,
      'artist_scope', m.artist_scope,
      'artists_label', m.artists_label,
      'artist_count', m.artist_count,
      'last_active_at', m.last_active_at,
      'last_active_label', m.last_active_label
    )
    ORDER BY m.sort_role, m.display_name NULLS LAST, m.email
  ), '[]'::jsonb)
  INTO v_members
  FROM (
    SELECT
      om.id,
      om.user_id,
      u.email,
      u.display_name,
      u.avatar_url,
      om.role_key,
      r.name AS role_name,
      om.status,
      om.joined_at,
      om.artist_scope,
      CASE
        WHEN om.artist_scope = 'all' OR om.role_key IN ('owner', 'admin') THEN 'All'
        WHEN scoped.cnt IS NULL OR scoped.cnt = 0 THEN '0 artists'
        WHEN scoped.cnt = 1 THEN '1 artist'
        ELSE scoped.cnt::text || ' artists'
      END AS artists_label,
      CASE
        WHEN om.artist_scope = 'all' OR om.role_key IN ('owner', 'admin') THEN v_total_artists
        ELSE COALESCE(scoped.cnt, 0)
      END AS artist_count,
      COALESCE(
        om.last_active_at,
        act.last_at,
        auth_u.last_sign_in_at,
        om.joined_at,
        om.created_at
      ) AS last_active_at,
      public.format_org_relative_activity(
        COALESCE(
          om.last_active_at,
          act.last_at,
          auth_u.last_sign_in_at,
          om.joined_at,
          om.created_at
        )
      ) AS last_active_label,
      CASE om.role_key
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        ELSE 2
      END AS sort_role
    FROM public.organization_members om
    JOIN public.users u ON u.id = om.user_id
    JOIN public.organization_roles r ON r.key = om.role_key
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
      FROM public.organization_member_artist_scopes s
      WHERE s.member_id = om.id
    ) scoped ON true
    LEFT JOIN LATERAL (
      SELECT MAX(al.created_at) AS last_at
      FROM public.organization_activity_logs al
      WHERE al.organization_id = p_org_id
        AND al.actor_user_id = om.user_id
    ) act ON true
    LEFT JOIN auth.users auth_u ON auth_u.id = om.user_id
    WHERE om.organization_id = p_org_id
      AND om.status IN ('active', 'pending', 'suspended')
  ) m;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'email', i.invitee_email,
      'role_key', i.role_key,
      'role_name', r.name,
      'status', 'pending_invite',
      'expires_at', i.expires_at,
      'created_at', i.created_at,
      'artists_label', '—',
      'artist_count', 0,
      'last_active_label', 'Invited'
    ) ORDER BY i.created_at DESC
  ), '[]'::jsonb)
  INTO v_pending
  FROM public.organization_member_invitations i
  JOIN public.organization_roles r ON r.key = i.role_key
  WHERE i.organization_id = p_org_id
    AND i.status = 'pending'
    AND i.expires_at > now();

  RETURN jsonb_build_object(
    'members', v_members,
    'pending_invitations', v_pending,
    'member_count', jsonb_array_length(v_members)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Roles list + custom role create
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_organization_roles(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_roles jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'key', r.key,
      'name', r.name,
      'description', COALESCE(r.description, ''),
      'is_system', r.is_system,
      'organization_id', r.organization_id,
      'permissions', to_jsonb(r.permissions),
      'permission_summary', CASE
        WHEN r.key = 'owner' THEN 'full access'
        WHEN r.key = 'admin' THEN 'full operational access'
        WHEN r.key = 'content_manager' THEN 'upload, calendar, drafts (no finance)'
        WHEN r.key = 'finance_manager' THEN 'analytics & revenue (no uploads)'
        WHEN r.key = 'viewer' THEN 'read-only roster & analytics'
        ELSE array_to_string(r.permissions, ', ')
      END,
      'member_count', (
        SELECT COUNT(*)::int
        FROM public.organization_members om
        WHERE om.organization_id = p_org_id
          AND om.role_key = r.key
          AND om.status = 'active'
      )
    )
    ORDER BY
      CASE WHEN r.is_system THEN 0 ELSE 1 END,
      CASE r.key
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'content_manager' THEN 2
        WHEN 'finance_manager' THEN 3
        WHEN 'viewer' THEN 4
        ELSE 5
      END,
      r.name
  ), '[]'::jsonb)
  INTO v_roles
  FROM public.organization_roles r
  WHERE r.is_system = true
     OR r.organization_id = p_org_id;

  RETURN jsonb_build_object('roles', v_roles);
END;
$$;

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
    'content.view', 'content.upload', 'analytics.view'
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

  -- Custom roles cannot grant org.manage (owner-only)
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
-- Update / remove members
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_organization_member(
  p_org_id uuid,
  p_member_id uuid,
  p_role_key text DEFAULT NULL,
  p_artist_scope text DEFAULT NULL,
  p_artist_profile_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_member public.organization_members%ROWTYPE;
  v_role public.organization_roles%ROWTYPE;
  v_scope text;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'team.manage', v_user_id) THEN
    RAISE EXCEPTION 'Missing team.manage permission';
  END IF;

  SELECT * INTO v_member
  FROM public.organization_members
  WHERE id = p_member_id
    AND organization_id = p_org_id;

  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF v_member.role_key = 'owner' THEN
    RAISE EXCEPTION 'Cannot modify the owner membership this way';
  END IF;

  IF p_role_key IS NOT NULL THEN
    SELECT * INTO v_role
    FROM public.organization_roles r
    WHERE r.key = p_role_key
      AND (r.is_system = true OR r.organization_id = p_org_id);

    IF v_role.key IS NULL THEN
      RAISE EXCEPTION 'Invalid role';
    END IF;

    IF p_role_key = 'owner' THEN
      RAISE EXCEPTION 'Cannot assign owner via update';
    END IF;

    UPDATE public.organization_members
    SET role_key = p_role_key, updated_at = now()
    WHERE id = p_member_id;
  END IF;

  v_scope := COALESCE(p_artist_scope, v_member.artist_scope, 'all');
  IF v_scope NOT IN ('all', 'selected') THEN
    RAISE EXCEPTION 'Invalid artist scope';
  END IF;

  IF p_artist_scope IS NOT NULL OR p_artist_profile_ids IS NOT NULL THEN
    UPDATE public.organization_members
    SET artist_scope = v_scope, updated_at = now()
    WHERE id = p_member_id;

    DELETE FROM public.organization_member_artist_scopes
    WHERE member_id = p_member_id;

    IF v_scope = 'selected' AND p_artist_profile_ids IS NOT NULL THEN
      INSERT INTO public.organization_member_artist_scopes (
        organization_id, member_id, artist_profile_id
      )
      SELECT p_org_id, p_member_id, ap.id
      FROM unnest(p_artist_profile_ids) AS ap(id)
      JOIN public.organization_artist_links oal
        ON oal.artist_profile_id = ap.id
       AND oal.organization_id = p_org_id
       AND oal.status = 'active'
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  PERFORM public.log_organization_activity(
    p_org_id,
    'team_member_updated',
    NULL,
    'member',
    v_member.user_id,
    jsonb_build_object(
      'member_id', p_member_id,
      'role_key', COALESCE(p_role_key, v_member.role_key),
      'artist_scope', v_scope
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_organization_member(
  p_org_id uuid,
  p_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_member public.organization_members%ROWTYPE;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_org_member(p_org_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT public.org_member_has_permission(p_org_id, 'team.manage', v_user_id) THEN
    RAISE EXCEPTION 'Missing team.manage permission';
  END IF;

  SELECT * INTO v_member
  FROM public.organization_members
  WHERE id = p_member_id
    AND organization_id = p_org_id;

  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF v_member.role_key = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the owner';
  END IF;

  IF v_member.user_id = v_user_id THEN
    RAISE EXCEPTION 'Cannot remove yourself';
  END IF;

  UPDATE public.organization_members
  SET status = 'removed', updated_at = now()
  WHERE id = p_member_id;

  DELETE FROM public.organization_member_artist_scopes
  WHERE member_id = p_member_id;

  PERFORM public.log_organization_activity(
    p_org_id,
    'team_member_removed',
    NULL,
    'member',
    v_member.user_id,
    jsonb_build_object('member_id', p_member_id, 'role_key', v_member.role_key)
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Validate custom / finance roles on invite
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
  v_role public.organization_roles%ROWTYPE;
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

  SELECT * INTO v_role
  FROM public.organization_roles r
  WHERE r.key = p_role_key
    AND (r.is_system = true OR r.organization_id = p_org_id);

  IF v_role.key IS NULL THEN
    RAISE EXCEPTION 'Invalid role';
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

GRANT EXECUTE ON FUNCTION public.list_organization_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_organization_roles(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_custom_role(uuid, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_organization_member(uuid, uuid, text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_organization_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_organization_member(uuid, text, text) TO authenticated;
