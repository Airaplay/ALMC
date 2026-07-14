/*
  # ALMC — Org-side artist verification by code

  - Invite RPC no longer returns the code to console callers
  - Org member enters code from artist to confirm/add to roster
  - Pending roster rows no longer expose invitation codes
*/

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
      RAISE EXCEPTION 'This account does not have an artist profile yet. Use Invite new artist instead.';
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
    COALESCE(p_artist_metadata, '{}'::jsonb),
    v_code,
    v_code,
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
    jsonb_build_object('email', v_email, 'invitation_type', v_type)
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
    created_by
  ) VALUES (
    p_org_id,
    v_artist_profile_id,
    v_invitee_user_id,
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

-- Hide codes from org roster; pending invites await verification only
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
  )
  SELECT COUNT(*)::int INTO v_total FROM combined;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.stage_name), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT * FROM combined
    ORDER BY stage_name
    LIMIT GREATEST(p_limit, 1)
    OFFSET GREATEST(p_offset, 0)
  ) t;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$$;

UPDATE public.email_templates
SET
  html_content = replace(
    html_content,
    'open the ALMC accept invitation page, and enter the code above.',
    'share this verification code with your organization contact so they can confirm your invitation in ALMC.'
  ),
  updated_at = now()
WHERE template_type = 'almc_artist_invitation'
  AND html_content LIKE '%open the ALMC accept invitation page%';

GRANT EXECUTE ON FUNCTION public.confirm_artist_organization_invitation(uuid, text, text) TO authenticated;
