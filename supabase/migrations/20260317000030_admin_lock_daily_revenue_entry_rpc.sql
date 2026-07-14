/*
  # Admin RPC: Lock Daily Revenue Entry

  Why:
  - Client-side update can fail silently due to RLS edge cases (admin role lookup blocked, etc.).
  - This SECURITY DEFINER RPC performs an explicit admin check and locks the row reliably.
*/

CREATE OR REPLACE FUNCTION public.admin_lock_daily_revenue_entry(p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_row record;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can lock daily revenue entries';
  END IF;

  SELECT * INTO v_row
  FROM public.ad_daily_revenue_input
  WHERE id = p_entry_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_found');
  END IF;

  IF COALESCE(v_row.is_locked, false) THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_locked', 'revenue_date', v_row.revenue_date);
  END IF;

  UPDATE public.ad_daily_revenue_input
  SET
    is_locked = true,
    locked_at = now(),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = p_entry_id
    AND is_locked = false;

  RETURN jsonb_build_object('ok', true, 'status', 'locked', 'revenue_date', v_row.revenue_date);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_lock_daily_revenue_entry(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_lock_daily_revenue_entry(uuid) IS
  'Admin-only. Locks a row in ad_daily_revenue_input (is_locked=true). Uses SECURITY DEFINER to avoid client-side RLS edge cases.';

