/*
  # Admin approve/reject promotion RPCs

  Promotion Manager manual approve/reject can fail due to RLS on promotions table.
  These SECURITY DEFINER RPCs run with elevated privileges and enforce admin/manager
  role inside the function, so manual approval works regardless of RLS.
*/

-- Admin approve: set status to active; keep the user's start_date and end_date (schedule is followed)
CREATE OR REPLACE FUNCTION public.admin_approve_promotion(p_promotion_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.role IN ('admin', 'manager')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied. Admin or manager required.');
  END IF;

  UPDATE promotions
  SET status = 'active', updated_at = now()
  WHERE id = p_promotion_id AND status IN ('pending_approval', 'pending');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Promotion not found or not pending approval.');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Promotion approved. It will run from the scheduled start to end date/time.');
END;
$$;

-- Admin reject: set status to rejected; optionally refund from promotion_global_settings
CREATE OR REPLACE FUNCTION public.admin_reject_promotion(p_promotion_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promotion record;
  v_refund_on_rejection boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.role IN ('admin', 'manager')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied. Admin or manager required.');
  END IF;

  SELECT user_id, target_title, treats_cost INTO v_promotion
  FROM promotions
  WHERE id = p_promotion_id AND status IN ('pending_approval', 'pending');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Promotion not found or not pending approval.');
  END IF;

  UPDATE promotions
  SET status = 'rejected', updated_at = now()
  WHERE id = p_promotion_id;

  SELECT COALESCE(refund_on_rejection, false) INTO v_refund_on_rejection
  FROM promotion_global_settings
  LIMIT 1;

  IF v_refund_on_rejection AND v_promotion.treats_cost > 0 THEN
    PERFORM add_treat_balance(
      v_promotion.user_id,
      (v_promotion.treats_cost)::integer,
      'promotion_refund',
      'Refund for rejected promotion: ' || COALESCE(v_promotion.target_title, ''),
      p_promotion_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', CASE WHEN v_refund_on_rejection THEN 'Promotion rejected and user refunded.' ELSE 'Promotion rejected.' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_promotion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_promotion(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_approve_promotion(uuid) IS 'Admin/manager approves a pending promotion. Keeps user-set start_date and end_date. Bypasses RLS.';
COMMENT ON FUNCTION public.admin_reject_promotion(uuid) IS 'Admin/manager rejects a pending promotion; refunds if promotion_global_settings.refund_on_rejection is true.';
