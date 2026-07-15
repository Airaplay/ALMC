-- ALMC 5.4 Create Artist modal — permission presets from invite metadata.

CREATE OR REPLACE FUNCTION public.org_artist_permissions_for_preset(p_preset text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO public
AS $$
  SELECT CASE COALESCE(NULLIF(lower(trim(p_preset)), ''), 'full_management')
    WHEN 'upload_only' THEN ARRAY['content.view', 'content.upload']::text[]
    WHEN 'view_only' THEN ARRAY['content.view']::text[]
    ELSE ARRAY['content.view', 'content.upload']::text[]
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
  v_code text;
  v_code_display text;
  v_invitation_id uuid;
  v_type text := COALESCE(p_invitation_type, 'link_existing');
  v_org_name text;
  v_permission_preset text := COALESCE(NULLIF(trim(p_artist_metadata->>'permission_preset'), ''), 'full_management');
  v_permissions text[] := public.org_artist_permissions_for_preset(v_permission_preset);
  v_accept_url text := COALESCE(
    current_setting('app.almc_accept_url', true),
    'https://almc.airaplay.com/accept-artist'
  );
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

  IF EXISTS (
    SELECT 1
    FROM public.organization_artist_invitations oai
    WHERE oai.organization_id = p_org_id
      AND lower(oai.invitee_email) = v_email
      AND oai.status = 'pending'
      AND oai.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'An invitation is already pending for this email. Enter the verification code from the artist.';
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

    IF v_type = 'link_existing' AND v_artist_profile_id IS NULL THEN
      RAISE EXCEPTION 'This account does not have an artist profile yet. Use Create New instead.';
    END IF;
  END IF;

  IF v_type = 'create_new' AND v_artist_profile_id IS NOT NULL THEN
    v_type := 'link_existing';
  END IF;

  v_code := public.generate_organization_invitation_code();
  v_code_display := public.format_organization_invitation_code(v_code);

  SELECT o.name INTO v_org_name
  FROM public.organizations o
  WHERE o.id = p_org_id
  LIMIT 1;

  INSERT INTO public.organization_artist_invitations (
    organization_id,
    invitee_email,
    invitee_user_id,
    artist_profile_id,
    invitation_type,
    artist_metadata,
    invitation_code,
    token_hash,
    permissions,
    expires_at,
    created_by
  ) VALUES (
    p_org_id,
    v_email,
    v_invitee_user_id,
    v_artist_profile_id,
    v_type,
    COALESCE(p_artist_metadata, '{}'::jsonb) || jsonb_build_object('permission_preset', v_permission_preset),
    v_code,
    v_code,
    v_permissions,
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
      permission_preset,
      custom_permissions,
      created_by
    ) VALUES (
      p_org_id,
      v_artist_profile_id,
      v_invitee_user_id,
      'pending_invite',
      v_permission_preset,
      v_permissions,
      v_user_id
    )
    ON CONFLICT (organization_id, artist_profile_id) DO UPDATE
      SET status = 'pending_invite',
          permission_preset = EXCLUDED.permission_preset,
          custom_permissions = EXCLUDED.custom_permissions,
          updated_at = now();
  END IF;

  BEGIN
    PERFORM public.queue_email(
      'almc_artist_invitation',
      v_email,
      v_invitee_user_id,
      jsonb_build_object(
        'organization_name', COALESCE(v_org_name, 'An organization'),
        'invitation_code', v_code_display,
        'invitee_email', v_email,
        'expires_days', '7',
        'accept_url', v_accept_url
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM public.log_organization_activity(
    p_org_id,
    'artist_invited',
    v_artist_profile_id,
    'invitation',
    v_invitation_id,
    jsonb_build_object('email', v_email, 'invitation_type', v_type, 'permission_preset', v_permission_preset)
  );

  RETURN jsonb_build_object(
    'success', true,
    'invitation_id', v_invitation_id,
    'invitee_user_id', v_invitee_user_id,
    'artist_profile_id', v_artist_profile_id,
    'invitation_type', v_type,
    'email_sent', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_artist_organization_invitation(
  p_org_id uuid,
  p_email text,
  p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text := lower(trim(p_email));
  v_code text := public.normalize_organization_invitation_code(p_code);
  v_inv public.organization_artist_invitations%ROWTYPE;
  v_artist_profile_id uuid;
  v_invitee_user_id uuid;
  v_permission_preset text;
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

  IF v_code = '' THEN
    RAISE EXCEPTION 'Verification code is required';
  END IF;

  SELECT *
  INTO v_inv
  FROM public.organization_artist_invitations
  WHERE organization_id = p_org_id
    AND lower(invitee_email) = v_email
    AND status = 'pending'
    AND expires_at > now()
    AND (
      invitation_code = v_code
      OR token_hash = v_code
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Verification code does not match this invitation';
  END IF;

  v_artist_profile_id := v_inv.artist_profile_id;
  v_invitee_user_id := v_inv.invitee_user_id;
  v_permission_preset := COALESCE(
    NULLIF(trim(v_inv.artist_metadata->>'permission_preset'), ''),
    'full_management'
  );

  IF v_invitee_user_id IS NULL THEN
    SELECT u.id INTO v_invitee_user_id
    FROM public.users u
    WHERE lower(u.email) = v_email
    LIMIT 1;
  END IF;

  IF v_artist_profile_id IS NULL AND v_invitee_user_id IS NOT NULL THEN
    SELECT ap.id INTO v_artist_profile_id
    FROM public.artist_profiles ap
    WHERE ap.user_id = v_invitee_user_id
    LIMIT 1;
  END IF;

  IF v_inv.invitation_type = 'link_existing' AND v_artist_profile_id IS NULL THEN
    RAISE EXCEPTION 'This artist does not have an Airaplay artist profile on this email yet';
  END IF;

  IF v_artist_profile_id IS NULL THEN
    RAISE EXCEPTION 'Artist must create their Airaplay profile before you can confirm this invitation';
  END IF;

  IF v_invitee_user_id IS NULL THEN
    SELECT ap.user_id INTO v_invitee_user_id
    FROM public.artist_profiles ap
    WHERE ap.id = v_artist_profile_id
    LIMIT 1;
  END IF;

  UPDATE public.organization_artist_invitations
  SET status = 'accepted',
      responded_at = now(),
      invitee_user_id = v_invitee_user_id,
      artist_profile_id = v_artist_profile_id
  WHERE id = v_inv.id;

  INSERT INTO public.organization_artist_links (
    organization_id,
    artist_profile_id,
    user_id,
    status,
    linked_at,
    permission_preset,
    custom_permissions,
    created_by
  ) VALUES (
    p_org_id,
    v_artist_profile_id,
    v_invitee_user_id,
    'active',
    now(),
    v_permission_preset,
    COALESCE(v_inv.permissions, public.org_artist_permissions_for_preset(v_permission_preset)),
    v_inv.created_by
  )
  ON CONFLICT (organization_id, artist_profile_id) DO UPDATE
    SET status = 'active',
        linked_at = now(),
        permission_preset = EXCLUDED.permission_preset,
        custom_permissions = EXCLUDED.custom_permissions,
        revoked_at = NULL,
        revoked_by = NULL,
        updated_at = now();

  PERFORM public.log_organization_activity(
    p_org_id,
    'artist_invitation_confirmed',
    v_artist_profile_id,
    'invitation',
    v_inv.id,
    jsonb_build_object('email', v_email, 'confirmed_by', v_user_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', p_org_id,
    'artist_profile_id', v_artist_profile_id,
    'invitation_id', v_inv.id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.org_artist_permissions_for_preset(text) TO authenticated;
