-- ALMC Create Artist: provisioned artists must be creators, not listeners.

CREATE OR REPLACE FUNCTION public.create_artist_profile_from_invite_metadata(
  p_user_id uuid,
  p_metadata jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_profile_id uuid;
  v_stage_name text := NULLIF(trim(COALESCE(p_metadata->>'stage_name', '')), '');
  v_bio text := NULLIF(trim(COALESCE(p_metadata->>'biography', p_metadata->>'bio', '')), '');
  v_country text := NULLIF(trim(COALESCE(p_metadata->>'country', '')), '');
  v_genre_name text := NULLIF(trim(COALESCE(p_metadata->>'genre', '')), '');
  v_genre_id uuid;
  v_profile_photo text := NULLIF(trim(COALESCE(
    p_metadata->>'profile_photo_url',
    p_metadata->>'profile_image_url',
    ''
  )), '');
  v_cover_photo text := NULLIF(trim(COALESCE(
    p_metadata->>'cover_photo_url',
    p_metadata->>'cover_image_url',
    ''
  )), '');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Artist account is required before creating a profile';
  END IF;

  -- Creating an artist profile implies creator role (do not demote portal roles).
  UPDATE public.users
  SET
    role = 'creator',
    updated_at = now()
  WHERE id = p_user_id
    AND lower(COALESCE(role, '')) NOT IN ('admin', 'manager', 'editor', 'account', 'creator');

  SELECT ap.id INTO v_profile_id
  FROM public.artist_profiles ap
  WHERE ap.user_id = p_user_id
  LIMIT 1;

  IF v_profile_id IS NOT NULL THEN
    RETURN v_profile_id;
  END IF;

  IF v_stage_name IS NULL THEN
    SELECT COALESCE(
      NULLIF(trim(u.display_name), ''),
      split_part(u.email, '@', 1),
      'Artist'
    )
    INTO v_stage_name
    FROM public.users u
    WHERE u.id = p_user_id
    LIMIT 1;

    v_stage_name := COALESCE(NULLIF(trim(v_stage_name), ''), 'Artist');
  END IF;

  IF v_genre_name IS NOT NULL THEN
    SELECT g.id INTO v_genre_id
    FROM public.genres g
    WHERE lower(g.name) = lower(v_genre_name)
    LIMIT 1;
  END IF;

  -- artist_profiles has no cover column; keep cover URL on the user background if present.
  IF v_cover_photo IS NOT NULL THEN
    BEGIN
      UPDATE public.users
      SET background_image_url = COALESCE(background_image_url, v_cover_photo),
          updated_at = now()
      WHERE id = p_user_id;
    EXCEPTION WHEN undefined_column THEN
      NULL;
    END;
  END IF;

  INSERT INTO public.artist_profiles (
    user_id,
    stage_name,
    bio,
    country,
    genre_id,
    profile_photo_url,
    is_verified
  ) VALUES (
    p_user_id,
    v_stage_name,
    v_bio,
    v_country,
    v_genre_id,
    v_profile_photo,
    false
  )
  ON CONFLICT (user_id) DO UPDATE
    SET
      stage_name = COALESCE(NULLIF(trim(artist_profiles.stage_name), ''), EXCLUDED.stage_name),
      bio = COALESCE(artist_profiles.bio, EXCLUDED.bio),
      country = COALESCE(artist_profiles.country, EXCLUDED.country),
      genre_id = COALESCE(artist_profiles.genre_id, EXCLUDED.genre_id),
      profile_photo_url = COALESCE(artist_profiles.profile_photo_url, EXCLUDED.profile_photo_url),
      updated_at = now()
  RETURNING id INTO v_profile_id;

  RETURN v_profile_id;
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
  v_user_email text;
  v_code text := public.normalize_organization_invitation_code(p_token);
  v_inv public.organization_artist_invitations%ROWTYPE;
  v_artist_profile_id uuid;
  v_permission_preset text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_code = '' AND COALESCE(trim(p_token), '') = '' THEN
    RAISE EXCEPTION 'Invitation code is required';
  END IF;

  SELECT lower(u.email)
  INTO v_user_email
  FROM public.users u
  WHERE u.id = v_user_id
  LIMIT 1;

  IF v_user_email IS NULL THEN
    SELECT lower(au.email)
    INTO v_user_email
    FROM auth.users au
    WHERE au.id = v_user_id
    LIMIT 1;

    IF v_user_email IS NOT NULL THEN
      INSERT INTO public.users (id, email, display_name, role, country_last_changed_at)
      SELECT
        au.id,
        au.email,
        COALESCE(
          au.raw_user_meta_data->>'display_name',
          au.raw_user_meta_data->>'full_name',
          split_part(au.email, '@', 1)
        ),
        'creator',
        now()
      FROM auth.users au
      WHERE au.id = v_user_id
      ON CONFLICT (id) DO UPDATE
        SET
          email = EXCLUDED.email,
          role = CASE
            WHEN lower(COALESCE(public.users.role, '')) IN ('admin', 'manager', 'editor', 'account', 'creator')
              THEN public.users.role
            ELSE 'creator'
          END;
    END IF;
  ELSE
    UPDATE public.users
    SET
      role = 'creator',
      updated_at = now()
    WHERE id = v_user_id
      AND lower(COALESCE(role, '')) NOT IN ('admin', 'manager', 'editor', 'account', 'creator');
  END IF;

  SELECT *
  INTO v_inv
  FROM public.organization_artist_invitations
  WHERE status = 'pending'
    AND expires_at > now()
    AND (
      (v_code <> '' AND invitation_code = v_code)
      OR (v_code <> '' AND token_hash = v_code)
      OR (COALESCE(trim(p_token), '') <> '' AND token_hash = trim(p_token))
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invitation code';
  END IF;

  IF v_inv.invitee_user_id IS NOT NULL AND v_inv.invitee_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Invitation does not belong to this account';
  END IF;

  IF v_user_email IS NULL OR v_user_email <> lower(v_inv.invitee_email) THEN
    RAISE EXCEPTION 'Sign in with the email address that received this invitation';
  END IF;

  v_artist_profile_id := v_inv.artist_profile_id;
  v_permission_preset := COALESCE(
    NULLIF(trim(v_inv.artist_metadata->>'permission_preset'), ''),
    'full_management'
  );

  IF v_artist_profile_id IS NULL THEN
    SELECT ap.id INTO v_artist_profile_id
    FROM public.artist_profiles ap
    WHERE ap.user_id = v_user_id
    LIMIT 1;
  END IF;

  IF v_artist_profile_id IS NULL
     AND COALESCE(v_inv.invitation_type, 'link_existing') = 'create_new'
  THEN
    v_artist_profile_id := public.create_artist_profile_from_invite_metadata(
      v_user_id,
      COALESCE(v_inv.artist_metadata, '{}'::jsonb)
    );
  END IF;

  IF v_artist_profile_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'requires_artist_profile', true,
      'invitation_type', v_inv.invitation_type,
      'organization_id', v_inv.organization_id,
      'message', 'Create your artist profile to accept this invitation'
    );
  END IF;

  UPDATE public.organization_artist_invitations
  SET status = 'accepted',
      responded_at = now(),
      invitee_user_id = v_user_id,
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
    v_inv.organization_id,
    v_artist_profile_id,
    v_user_id,
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
    v_inv.organization_id,
    'artist_invitation_accepted',
    v_artist_profile_id,
    'invitation',
    v_inv.id,
    jsonb_build_object('user_id', v_user_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_inv.organization_id,
    'artist_profile_id', v_artist_profile_id,
    'requires_artist_profile', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_artist_profile_from_invite_metadata(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_artist_profile_from_invite_metadata(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_artist_organization_invitation(text) TO authenticated;
