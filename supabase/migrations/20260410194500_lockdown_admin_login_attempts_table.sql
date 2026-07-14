/*
  # Lock down admin_login_attempts direct client writes

  Inserts must go through SECURITY DEFINER RPCs (record_admin_login_attempt, etc.),
  not arbitrary client INSERT policies.
*/

DROP POLICY IF EXISTS "Authenticated can insert own attempt" ON public.admin_login_attempts;

REVOKE INSERT ON TABLE public.admin_login_attempts FROM PUBLIC;
REVOKE INSERT ON TABLE public.admin_login_attempts FROM authenticated, anon;
