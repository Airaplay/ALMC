/*
  Auto-distribute external revenue entries when an admin locks them.
  Finance staff (manager/account) can still lock only; an admin distributes later.
  If auto-distribute fails, the lock is rolled back so the entry stays editable.
*/

DROP FUNCTION IF EXISTS public.admin_lock_external_revenue_entry(uuid);

CREATE OR REPLACE FUNCTION public.admin_lock_external_revenue_entry(
  p_entry_id uuid,
  p_auto_distribute boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_entry record;
  v_dist jsonb;
BEGIN
  v_uid := auth.uid();
  IF NOT public.admin_external_revenue_is_finance_role() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_entry FROM public.external_revenue_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry not found');
  END IF;

  IF v_entry.is_locked THEN
    IF COALESCE(p_auto_distribute, true)
       AND public.admin_external_revenue_is_admin()
       AND NOT EXISTS (
         SELECT 1 FROM public.external_revenue_distributions d WHERE d.entry_id = p_entry_id
       ) THEN
      v_dist := public.admin_distribute_external_revenue_entry(p_entry_id);
      RETURN v_dist || jsonb_build_object(
        'lock_status', 'already_locked',
        'auto_distributed', COALESCE((v_dist->>'success')::boolean, false)
      );
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'already_locked', 'entry_id', p_entry_id);
  END IF;

  UPDATE public.external_revenue_entries
  SET is_locked = true,
      locked_at = now(),
      locked_by = v_uid
  WHERE id = p_entry_id;

  IF NOT COALESCE(p_auto_distribute, true) OR NOT public.admin_external_revenue_is_admin() THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'locked',
      'entry_id', p_entry_id,
      'auto_distributed', false,
      'message', CASE
        WHEN NOT public.admin_external_revenue_is_admin() THEN
          'Entry locked. An admin must distribute this entry.'
        ELSE
          'Entry locked without auto-distribution.'
      END
    );
  END IF;

  v_dist := public.admin_distribute_external_revenue_entry(p_entry_id);

  IF COALESCE((v_dist->>'success')::boolean, false) THEN
    RETURN v_dist || jsonb_build_object(
      'lock_status', 'locked',
      'auto_distributed', true,
      'entry_id', p_entry_id
    );
  END IF;

  -- Roll back lock so admin can fix eligibility / settings and retry
  UPDATE public.external_revenue_entries
  SET is_locked = false,
      locked_at = NULL,
      locked_by = NULL
  WHERE id = p_entry_id;

  RETURN v_dist || jsonb_build_object(
    'lock_status', 'rolled_back',
    'auto_distributed', false,
    'entry_id', p_entry_id,
    'error', COALESCE(v_dist->>'error', 'Distribution failed; entry remains unlocked.')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_lock_external_revenue_entry(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_lock_external_revenue_entry(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_lock_external_revenue_entry(uuid, boolean) IS
  'Lock an external revenue entry. Admins auto-distribute immediately (default). Rolls back lock if distribution fails. Finance roles lock only.';
