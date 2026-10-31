-- When an ALMC org is created, mirror org.type into the creator's platform role
-- (unless they already have an elevated non-ALMC role like creator/admin).
-- Also harden ALMC role RPC grants (authenticated only).

REVOKE ALL ON FUNCTION public.almc_apply_signup_org_type(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.almc_apply_signup_org_type(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.almc_apply_signup_org_type(text) TO authenticated;

REVOKE ALL ON FUNCTION public.almc_set_platform_role(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.almc_set_platform_role(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.almc_set_platform_role(uuid, text) TO authenticated;

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
SET search_path TO public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_slug text;
  v_org_id uuid;
  v_suffix int := 0;
  v_current_role text;
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
    business_registration_number, description, verification_status, verified_at, created_by
  ) VALUES (
    p_type, trim(p_name), v_slug, p_logo_url, trim(p_email), p_phone, p_country, p_website,
    p_business_registration_number, p_description, 'approved', now(), v_user_id
  )
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role_key, joined_at, status)
  VALUES (v_org_id, v_user_id, 'owner', now(), 'active');

  SELECT role INTO v_current_role FROM public.users WHERE id = v_user_id;

  IF v_current_role IS NULL
     OR v_current_role IN ('listener', 'label', 'management', 'distributor', 'entertainment') THEN
    UPDATE public.users
    SET role = p_type,
        updated_at = now()
    WHERE id = v_user_id;

    UPDATE auth.users
    SET raw_user_meta_data =
          COALESCE(raw_user_meta_data, '{}'::jsonb)
          || jsonb_build_object(
               'almc_org_type', p_type,
               'signup_source', COALESCE(raw_user_meta_data->>'signup_source', 'almc')
             )
    WHERE id = v_user_id;
  END IF;

  PERFORM public.log_organization_activity(
    v_org_id,
    'organization_created',
    NULL,
    'organization',
    v_org_id,
    jsonb_build_object('type', p_type, 'name', p_name)
  );

  RETURN jsonb_build_object('success', true, 'organization_id', v_org_id, 'slug', v_slug);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text, text, text, text, text, text, text) TO authenticated;
