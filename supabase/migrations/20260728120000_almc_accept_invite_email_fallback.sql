-- ALMC: accept team invites even when public.users row is briefly missing,
-- and always persist the invitation's selected role_key on organization_members.

CREATE OR REPLACE FUNCTION public.accept_organization_member_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_org_type text;
  v_inv public.organization_member_invitations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT u.email INTO v_email FROM public.users u WHERE u.id = v_user_id;

  IF v_email IS NULL THEN
    SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_user_id;
  END IF;

  IF v_email IS NULL OR length(trim(v_email)) = 0 THEN
    RAISE EXCEPTION 'Account email not found';
  END IF;

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

  SELECT o.type INTO v_org_type
  FROM public.organizations o
  WHERE o.id = v_inv.organization_id;

  -- Ensure a public.users profile exists so membership/role queries work.
  INSERT INTO public.users (id, email, display_name, role, country_last_changed_at)
  SELECT
    au.id,
    au.email,
    COALESCE(au.raw_user_meta_data->>'display_name', au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
    COALESCE(v_org_type, 'listener'),
    now()
  FROM auth.users au
  WHERE au.id = v_user_id
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;

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

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_inv.organization_id,
    'role_key', v_inv.role_key
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_organization_member_invitation(text) TO authenticated;
