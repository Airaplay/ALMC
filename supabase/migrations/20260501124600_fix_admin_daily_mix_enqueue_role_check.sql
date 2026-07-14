/*
  # Fix admin Daily Mix enqueue role check

  Problem:
  - `admin_enqueue_daily_mix_generation_now()` checks `public.user_roles`,
    but this project stores admin roles on `public.users.role`.
  - Result: admin dashboard "Generate Mixes Now" can fail with relation errors
    or reject valid admins.

  Fix:
  - Recreate the RPC to validate against `public.users.role`.
  - Keep support for SQL editor/service calls where `auth.uid()` is null.
*/

CREATE OR REPLACE FUNCTION public.admin_enqueue_daily_mix_generation_now(
  p_force_refresh boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := false;
  v_result jsonb;
BEGIN
  -- Allow service/sql-editor calls without an authenticated user context.
  IF auth.uid() IS NULL THEN
    v_is_admin := true;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'super_admin', 'manager', 'editor', 'account')
    ) INTO v_is_admin;
  END IF;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only admins can enqueue daily mix generation');
  END IF;

  v_result := public.enqueue_daily_mix_generation_jobs(p_force_refresh, 2000);
  RETURN jsonb_build_object(
    'ok', true,
    'enqueued_jobs', COALESCE((v_result->>'enqueued_jobs')::int, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_enqueue_daily_mix_generation_now(boolean) TO authenticated, service_role;
