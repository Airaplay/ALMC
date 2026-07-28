-- ALMC: mirror org type into platform profile role safely
--
-- Users can pick / change their organization type during onboarding.
-- We want `public.users.role` to match the selected organization type, but
-- role updates are restricted by RLS for normal clients.
--
-- This SECURITY DEFINER RPC validates the caller is a member of the org,
-- and that `public.organizations.type` matches the requested role.

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

  -- Validate org membership + that the requested role matches the org's type.
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
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true, 'role', p_role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.almc_set_platform_role(uuid, text) TO authenticated;

