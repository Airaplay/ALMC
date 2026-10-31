-- ALMC signup: register users as their selected organization type
--
-- Root causes fixed:
-- 1) users_role_valid CHECK blocked label/management/distributor/entertainment
-- 2) handle_new_auth_user always inserted role='listener' and ignored almc_org_type metadata
-- 3) Client could not UPDATE role due to RLS; duplicate profile insert was a no-op

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_valid;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_valid
  CHECK (
    role IS NULL
    OR role = ANY (
      ARRAY[
        'listener'::text,
        'creator'::text,
        'admin'::text,
        'manager'::text,
        'editor'::text,
        'account'::text,
        'waitlist_admin'::text,
        'label'::text,
        'management'::text,
        'distributor'::text,
        'entertainment'::text
      ]
    )
  );

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_email text;
  v_display_name text;
  v_country text;
  v_gender text;
  v_dob date;
  v_meta_org_type text;
  v_role text;
BEGIN
  v_email := COALESCE(NEW.email, '');
  v_display_name := NULLIF(
    btrim(
      COALESCE(
        NEW.raw_user_meta_data->>'display_name',
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        NEW.raw_user_meta_data->>'preferred_username',
        split_part(v_email, '@', 1)
      )
    ),
    ''
  );
  IF v_display_name IS NULL THEN
    v_display_name := 'User';
  END IF;

  v_country := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'country', '')), '');
  v_gender := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'gender', '')), '');
  BEGIN
    v_dob := (NEW.raw_user_meta_data->>'date_of_birth')::date;
  EXCEPTION
    WHEN OTHERS THEN
      v_dob := NULL;
  END;

  v_meta_org_type := lower(NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'almc_org_type', '')), ''));
  IF v_meta_org_type IN ('label', 'management', 'distributor', 'entertainment') THEN
    v_role := v_meta_org_type;
  ELSE
    v_role := 'listener';
  END IF;

  INSERT INTO public.users (
    id,
    email,
    display_name,
    role,
    country,
    gender,
    date_of_birth
  )
  VALUES (
    NEW.id,
    v_email,
    v_display_name,
    v_role,
    v_country,
    COALESCE(v_gender, 'prefer_not_to_say'),
    v_dob
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(NULLIF(EXCLUDED.email, ''), public.users.email),
    display_name = COALESCE(NULLIF(public.users.display_name, ''), EXCLUDED.display_name),
    role = CASE
      WHEN EXCLUDED.role IN ('label', 'management', 'distributor', 'entertainment')
        AND (
          public.users.role IS NULL
          OR public.users.role = 'listener'
          OR public.users.role IN ('label', 'management', 'distributor', 'entertainment')
        )
      THEN EXCLUDED.role
      ELSE public.users.role
    END,
    country = COALESCE(public.users.country, EXCLUDED.country),
    gender = COALESCE(public.users.gender, EXCLUDED.gender),
    date_of_birth = COALESCE(public.users.date_of_birth, EXCLUDED.date_of_birth),
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.almc_apply_signup_org_type(
  p_org_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_meta_org_type text;
  v_current_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT lower(NULLIF(btrim(COALESCE(raw_user_meta_data->>'almc_org_type', '')), ''))
  INTO v_meta_org_type
  FROM auth.users
  WHERE id = v_user_id;

  v_role := lower(NULLIF(btrim(COALESCE(p_org_type, v_meta_org_type, '')), ''));

  IF v_role IS NULL OR v_role NOT IN ('label', 'management', 'distributor', 'entertainment') THEN
    RAISE EXCEPTION 'Invalid ALMC organization type';
  END IF;

  UPDATE auth.users
  SET raw_user_meta_data =
        COALESCE(raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object(
             'almc_org_type', v_role,
             'signup_source', 'almc'
           )
  WHERE id = v_user_id;

  SELECT role INTO v_current_role
  FROM public.users
  WHERE id = v_user_id;

  IF v_current_role IS NULL THEN
    INSERT INTO public.users (id, email, display_name, role, country_last_changed_at)
    SELECT
      au.id,
      COALESCE(au.email, ''),
      COALESCE(
        NULLIF(btrim(au.raw_user_meta_data->>'display_name'), ''),
        split_part(COALESCE(au.email, 'user'), '@', 1)
      ),
      v_role,
      now()
    FROM auth.users au
    WHERE au.id = v_user_id;
  ELSIF v_current_role IN ('listener', 'label', 'management', 'distributor', 'entertainment') THEN
    UPDATE public.users
    SET role = v_role,
        updated_at = now()
    WHERE id = v_user_id;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'role', v_current_role,
      'reason', 'existing_role_preserved'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'role', v_role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.almc_apply_signup_org_type(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.almc_set_platform_role(
  p_org_id uuid,
  p_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_type text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_role NOT IN ('label', 'management', 'distributor', 'entertainment') THEN
    RAISE EXCEPTION 'Invalid ALMC org-type role';
  END IF;

  SELECT o.type
  INTO v_org_type
  FROM public.organizations o
  JOIN public.organization_members om
    ON om.organization_id = o.id
  WHERE o.id = p_org_id
    AND om.user_id = v_user_id
  LIMIT 1;

  IF v_org_type IS NULL THEN
    RAISE EXCEPTION 'Access denied (not a member of this org)';
  END IF;

  IF v_org_type <> p_role THEN
    RAISE EXCEPTION 'Requested role does not match organization type';
  END IF;

  UPDATE public.users
  SET role = p_role,
      updated_at = now()
  WHERE id = v_user_id
    AND (
      role IS NULL
      OR role IN ('listener', 'label', 'management', 'distributor', 'entertainment')
    );

  RETURN jsonb_build_object('success', true, 'role', p_role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.almc_set_platform_role(uuid, text) TO authenticated;

UPDATE public.users u
SET role = lower(au.raw_user_meta_data->>'almc_org_type'),
    updated_at = now()
FROM auth.users au
WHERE au.id = u.id
  AND lower(COALESCE(au.raw_user_meta_data->>'almc_org_type', ''))
      IN ('label', 'management', 'distributor', 'entertainment')
  AND (
    u.role IS NULL
    OR u.role = 'listener'
    OR u.role IN ('label', 'management', 'distributor', 'entertainment')
  )
  AND u.role IS DISTINCT FROM lower(au.raw_user_meta_data->>'almc_org_type');
