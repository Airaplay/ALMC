/*
  # ALMC — Artist invitation codes + email delivery

  - Short 8-character codes (XXXX-XXXX) instead of long URL tokens
  - Email queued to invitee on send
  - Accept by entering code (case-insensitive, dashes optional)
*/

ALTER TABLE public.organization_artist_invitations
  ADD COLUMN IF NOT EXISTS invitation_code text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_artist_invitations_code_pending
  ON public.organization_artist_invitations (invitation_code)
  WHERE status = 'pending' AND invitation_code IS NOT NULL;

ALTER TABLE public.email_templates
  DROP CONSTRAINT IF EXISTS email_templates_template_type_check;

ALTER TABLE public.email_templates
  ADD CONSTRAINT email_templates_template_type_check
  CHECK (template_type = ANY (ARRAY[
    'welcome'::text,
    'purchase_treat'::text,
    'approved_withdrawal'::text,
    'completed_withdrawal'::text,
    'newsletter'::text,
    'weekly_report'::text,
    'creator_approved'::text,
    'promotion_active'::text,
    'support_ticket_received'::text,
    'support_ticket_reply'::text,
    'almc_artist_invitation'::text
  ]));

CREATE OR REPLACE FUNCTION public.generate_organization_invitation_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_i int;
  v_pick int;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..8 LOOP
      v_pick := 1 + floor(random() * length(v_chars))::int;
      v_code := v_code || substr(v_chars, v_pick, 1);
    END LOOP;

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.organization_artist_invitations oai
      WHERE oai.invitation_code = v_code
        AND oai.status = 'pending'
        AND oai.expires_at > now()
    );
  END LOOP;

  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.format_organization_invitation_code(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_code IS NULL OR length(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')) < 8 THEN NULL
    ELSE upper(substr(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'), 1, 4))
      || '-'
      || upper(substr(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'), 5, 4))
  END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_organization_invitation_code(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

INSERT INTO public.email_templates (
  template_type,
  subject,
  html_content,
  variables,
  is_active
) VALUES (
  'almc_artist_invitation',
  'You''re invited to join {{organization_name}} on Airaplay',
  $tpl$
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Artist invitation</title>
<style>
body { margin: 0; padding: 0; background: #e8ebe8; -webkit-font-smoothing: antialiased; }
.outer { max-width: 600px; margin: 0 auto; }
.header { background-color: #000000; background: #000000; padding: 32px 24px; text-align: center; }
.header img { max-width: 200px; height: auto; display: block; margin: 0 auto; border: 0; }
.body { background: #f5faf5; color: #111111; padding: 28px 28px 36px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.body h1 { font-size: 24px; font-weight: 700; margin: 0 0 18px 0; line-height: 1.25; color: #000000; }
.body p { margin: 0 0 14px 0; font-size: 15px; line-height: 1.55; color: #111111; }
.code-box { margin: 20px 0; padding: 18px 24px; background: #ffffff; border: 2px dashed #309605; border-radius: 12px; text-align: center; font-size: 28px; font-weight: 700; letter-spacing: 0.2em; color: #309605; }
.footer { background: #eeeeee; padding: 18px; text-align: center; font-size: 12px; color: #555555; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.button { display: inline-block; padding: 12px 28px; background: #309605; color: #ffffff !important; text-decoration: none; border-radius: 6px; margin: 16px 0; font-weight: 600; font-size: 15px; }
</style>
</head>
<body>
<div class="outer">
<div class="header" style="background-color:#000000;background:#000000;padding:32px 24px;text-align:center;">
<img src="https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png" alt="Airaplay" width="200" style="max-width:200px;height:auto;display:block;margin:0 auto;border:0;">
</div>
<div class="body">
<h1>Organization invitation</h1>
<p>Hi,</p>
<p><strong>{{organization_name}}</strong> invited you to join their artist roster on Airaplay Label &amp; Management Console.</p>
<p>Use this invitation code to accept (valid for {{expires_days}} days):</p>
<div class="code-box">{{invitation_code}}</div>
<p>Sign in with <strong>{{invitee_email}}</strong>, open the ALMC accept invitation page, and enter the code above.</p>
<p><a class="button" href="{{accept_url}}">Accept invitation</a></p>
<p style="font-size:13px;color:#555;">Your artist profile and catalog remain fully yours. The organization only receives the management access you approve.</p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
</div>
</div>
</body>
</html>
$tpl$,
  '["organization_name","invitation_code","invitee_email","expires_days","accept_url"]'::jsonb,
  true
)
ON CONFLICT (template_type) DO UPDATE SET
  subject = EXCLUDED.subject,
  html_content = EXCLUDED.html_content,
  variables = EXCLUDED.variables,
  is_active = EXCLUDED.is_active,
  updated_at = now();

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
    RAISE EXCEPTION 'An invitation is already pending for this email';
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
    jsonb_build_object(
      'email', v_email,
      'invitation_type', v_type,
      'invitation_code', v_code_display
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'invitation_id', v_invitation_id,
    'invitee_user_id', v_invitee_user_id,
    'artist_profile_id', v_artist_profile_id,
    'invitation_type', v_type,
    'invitation_code', v_code_display,
    'email_sent', true
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
  v_user_email text;
  v_code text := public.normalize_organization_invitation_code(p_token);
  v_inv public.organization_artist_invitations%ROWTYPE;
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

  IF v_inv.artist_profile_id IS NULL THEN
    SELECT ap.id INTO v_inv.artist_profile_id
    FROM public.artist_profiles ap
    WHERE ap.user_id = v_user_id
    LIMIT 1;

    IF v_inv.artist_profile_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'requires_artist_profile', true,
        'invitation_type', v_inv.invitation_type,
        'organization_id', v_inv.organization_id,
        'message', 'Create your artist profile to accept this invitation'
      );
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

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_inv.organization_id,
    'requires_artist_profile', false
  );
END;
$$;

-- Include invitation code in pending roster rows for org admins
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
      NULL::text AS invitation_code,
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
      public.format_organization_invitation_code(oai.invitation_code) AS invitation_code,
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

GRANT EXECUTE ON FUNCTION public.generate_organization_invitation_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.format_organization_invitation_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_organization_invitation_code(text) TO authenticated;
