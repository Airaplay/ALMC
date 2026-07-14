/*
  # Referral milestone — per-referrer enable / disable

  Allows admins to exclude specific referrers from the ₦5K cash milestone
  without affecting referral links or the Treat referral program.
*/

ALTER TABLE public.referral_milestone_payouts
  ADD COLUMN IF NOT EXISTS milestone_eligible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS excluded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exclusion_reason text;

COMMENT ON COLUMN public.referral_milestone_payouts.milestone_eligible IS
  'When false, referrer is excluded from cash milestone payout (admin override).';

-- ============================================================================
-- Block Live Balance credit for excluded referrers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.credit_referral_milestone_live_balance(p_referrer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.referral_milestone_settings%ROWTYPE;
  v_payout public.referral_milestone_payouts%ROWTYPE;
  v_before numeric;
  v_after numeric;
  v_usd numeric;
  v_ngn integer;
BEGIN
  IF p_referrer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'referrer_id required');
  END IF;

  SELECT * INTO v_settings
  FROM public.referral_milestone_settings
  WHERE singleton_key = true
  LIMIT 1;

  IF NOT FOUND OR NOT v_settings.is_enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'program_disabled');
  END IF;

  SELECT * INTO v_payout
  FROM public.referral_milestone_payouts
  WHERE referrer_id = p_referrer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payout_row_not_found');
  END IF;

  IF NOT COALESCE(v_payout.milestone_eligible, true) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'referrer_excluded_from_milestone');
  END IF;

  IF v_payout.credited_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'already_credited',
      'referrer_id', p_referrer_id,
      'credited_at', v_payout.credited_at,
      'live_balance_after', v_payout.live_balance_after
    );
  END IF;

  IF v_payout.payout_status = 'rejected' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payout_rejected');
  END IF;

  IF v_payout.qualified_count < v_settings.required_qualified_referrals THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'milestone_not_reached',
      'qualified_count', v_payout.qualified_count,
      'required', v_settings.required_qualified_referrals
    );
  END IF;

  v_usd := COALESCE(v_settings.reward_amount_usd, 0);
  v_ngn := COALESCE(v_settings.reward_amount_ngn, 0);

  IF v_usd <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'zero_reward_amount');
  END IF;

  SELECT COALESCE(u.total_earnings, 0) INTO v_before
  FROM public.users u
  WHERE u.id = p_referrer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  UPDATE public.users
  SET
    total_earnings = COALESCE(total_earnings, 0) + v_usd,
    updated_at = now()
  WHERE id = p_referrer_id
  RETURNING COALESCE(total_earnings, 0) INTO v_after;

  UPDATE public.referral_milestone_payouts
  SET
    payout_status = 'paid',
    payout_amount_usd = v_usd,
    payout_amount_ngn = v_ngn,
    credited_at = now(),
    paid_at = COALESCE(paid_at, now()),
    live_balance_before = v_before,
    live_balance_after = v_after,
    reviewed_by = COALESCE(reviewed_by, auth.uid()),
    reviewed_at = COALESCE(reviewed_at, now()),
    updated_at = now()
  WHERE referrer_id = p_referrer_id;

  UPDATE public.referral_milestone_settings
  SET total_paid_out = total_paid_out + 1, updated_at = now()
  WHERE singleton_key = true;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notifications'
  ) THEN
    INSERT INTO public.notifications (
      user_id, type, category, title, message, metadata, is_read
    ) VALUES (
      p_referrer_id,
      'reward',
      'referral_milestone',
      'Referral milestone reward',
      format(
        'You earned $%s (%s) for inviting %s active users. Added to your Live Balance.',
        trim(to_char(v_usd, 'FM999999990.00')),
        v_ngn::text || ' NGN',
        v_settings.required_qualified_referrals::text
      ),
      jsonb_build_object(
        'source', 'referral_milestone_program',
        'amount_usd', v_usd,
        'amount_ngn', v_ngn,
        'qualified_count', v_payout.qualified_count,
        'live_balance_before', v_before,
        'live_balance_after', v_after
      ),
      false
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'credited',
    'referrer_id', p_referrer_id,
    'amount_usd', v_usd,
    'amount_ngn', v_ngn,
    'live_balance_before', v_before,
    'live_balance_after', v_after
  );
END;
$$;

-- ============================================================================
-- Refresh aggregates — excluded referrers never reach ready_for_review / auto-credit
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_referral_milestone_payout(p_referrer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.referral_milestone_settings%ROWTYPE;
  v_qualified integer;
  v_pending integer;
  v_disqualified integer;
  v_current_status text;
  v_new_status text;
  v_eligible boolean := true;
  v_credit_result jsonb;
BEGIN
  SELECT * INTO v_settings
  FROM public.referral_milestone_settings
  WHERE singleton_key = true
  LIMIT 1;

  IF NOT FOUND OR NOT v_settings.is_enabled THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE q.status = 'qualified'),
    COUNT(*) FILTER (WHERE q.status = 'pending'),
    COUNT(*) FILTER (WHERE q.status = 'disqualified')
  INTO v_qualified, v_pending, v_disqualified
  FROM public.referral_milestone_qualifications q
  INNER JOIN public.referrals r ON r.id = q.referral_id
  WHERE q.referrer_id = p_referrer_id
    AND r.status <> 'revoked'
    AND r.created_at >= v_settings.program_start_at;

  SELECT payout_status, COALESCE(milestone_eligible, true)
  INTO v_current_status, v_eligible
  FROM public.referral_milestone_payouts
  WHERE referrer_id = p_referrer_id;

  v_new_status := COALESCE(v_current_status, 'tracking');

  IF COALESCE(v_eligible, true) THEN
    IF v_new_status IN ('tracking', 'ready_for_review')
       AND v_qualified >= v_settings.required_qualified_referrals THEN
      v_new_status := 'ready_for_review';
    ELSIF v_new_status = 'tracking'
          AND v_qualified < v_settings.required_qualified_referrals THEN
      v_new_status := 'tracking';
    END IF;
  ELSIF v_new_status IN ('tracking', 'ready_for_review', 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM public.referral_milestone_payouts
          WHERE referrer_id = p_referrer_id AND credited_at IS NOT NULL
        ) THEN
    v_new_status := 'tracking';
  END IF;

  INSERT INTO public.referral_milestone_payouts (
    referrer_id,
    qualified_count,
    pending_count,
    disqualified_count,
    payout_status,
    milestone_eligible,
    updated_at
  ) VALUES (
    p_referrer_id,
    COALESCE(v_qualified, 0),
    COALESCE(v_pending, 0),
    COALESCE(v_disqualified, 0),
    v_new_status,
    true,
    now()
  )
  ON CONFLICT (referrer_id) DO UPDATE SET
    qualified_count = EXCLUDED.qualified_count,
    pending_count = EXCLUDED.pending_count,
    disqualified_count = EXCLUDED.disqualified_count,
    payout_status = CASE
      WHEN public.referral_milestone_payouts.payout_status IN ('approved', 'paid', 'rejected')
           OR public.referral_milestone_payouts.credited_at IS NOT NULL
      THEN public.referral_milestone_payouts.payout_status
      WHEN NOT COALESCE(public.referral_milestone_payouts.milestone_eligible, true)
           AND public.referral_milestone_payouts.credited_at IS NULL
      THEN 'tracking'
      ELSE EXCLUDED.payout_status
    END,
    updated_at = now();

  IF COALESCE(v_settings.auto_approve_payout, false) = true
     AND v_qualified >= v_settings.required_qualified_referrals
     AND COALESCE(v_eligible, true) THEN
    SELECT public.credit_referral_milestone_live_balance(p_referrer_id) INTO v_credit_result;
  END IF;
END;
$$;

-- ============================================================================
-- Admin: enable / disable a referrer for the cash milestone
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_referral_milestone_eligibility(
  p_referrer_id uuid,
  p_eligible boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.referral_milestone_is_admin() THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  IF p_referrer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'referrer_id required');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_referrer_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  IF COALESCE(p_eligible, true) THEN
    INSERT INTO public.referral_milestone_payouts (
      referrer_id,
      milestone_eligible,
      excluded_at,
      excluded_by,
      exclusion_reason,
      payout_status,
      updated_at
    ) VALUES (
      p_referrer_id,
      true,
      NULL,
      NULL,
      NULL,
      'tracking',
      now()
    )
    ON CONFLICT (referrer_id) DO UPDATE SET
      milestone_eligible = true,
      excluded_at = NULL,
      excluded_by = NULL,
      exclusion_reason = NULL,
      updated_at = now();

    PERFORM public.refresh_referral_milestone_payout(p_referrer_id);

    RETURN jsonb_build_object(
      'ok', true,
      'referrer_id', p_referrer_id,
      'milestone_eligible', true
    );
  END IF;

  INSERT INTO public.referral_milestone_payouts (
    referrer_id,
    milestone_eligible,
    excluded_at,
    excluded_by,
    exclusion_reason,
    payout_status,
    updated_at
  ) VALUES (
    p_referrer_id,
    false,
    now(),
    auth.uid(),
    NULLIF(trim(p_reason), ''),
    'tracking',
    now()
  )
  ON CONFLICT (referrer_id) DO UPDATE SET
    milestone_eligible = false,
    excluded_at = now(),
    excluded_by = auth.uid(),
    exclusion_reason = COALESCE(NULLIF(trim(p_reason), ''), public.referral_milestone_payouts.exclusion_reason),
    payout_status = CASE
      WHEN public.referral_milestone_payouts.credited_at IS NULL
           AND public.referral_milestone_payouts.payout_status IN ('tracking', 'ready_for_review', 'approved')
      THEN 'tracking'
      ELSE public.referral_milestone_payouts.payout_status
    END,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'referrer_id', p_referrer_id,
    'milestone_eligible', false,
    'exclusion_reason', NULLIF(trim(p_reason), '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_referral_milestone_eligibility(uuid, boolean, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_referral_milestone_eligibility(uuid, boolean, text) FROM PUBLIC, anon;

-- ============================================================================
-- Leaderboard + detail — expose eligibility fields
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_referral_milestone_leaderboard(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_milestone_reached boolean DEFAULT NULL,
  p_min_qualified integer DEFAULT NULL,
  p_sort text DEFAULT 'progress_desc'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.referral_milestone_settings%ROWTYPE;
  v_rows jsonb;
  v_total integer;
  v_target integer;
BEGIN
  IF NOT public.referral_milestone_is_admin() THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  SELECT * INTO v_settings FROM public.referral_milestone_settings WHERE singleton_key = true LIMIT 1;
  v_target := COALESCE(v_settings.required_qualified_referrals, 10);

  SELECT COUNT(*) INTO v_total
  FROM public.referral_milestone_payouts p
  LEFT JOIN public.users u ON u.id = p.referrer_id
  WHERE (p_search IS NULL OR p_search = '' OR (
      COALESCE(u.display_name, '') ILIKE '%' || p_search || '%'
      OR COALESCE(u.email, '') ILIKE '%' || p_search || '%'
    ))
    AND (p_status IS NULL OR p_status = '' OR p.payout_status = p_status
         OR (p_status = 'paid' AND p.credited_at IS NOT NULL))
    AND (p_milestone_reached IS NULL
         OR (p_milestone_reached = true AND p.qualified_count >= v_target)
         OR (p_milestone_reached = false AND p.qualified_count < v_target))
    AND (p_min_qualified IS NULL OR p.qualified_count >= p_min_qualified);

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      p.referrer_id,
      u.display_name,
      u.email,
      rc.code AS referral_code,
      p.qualified_count,
      p.pending_count,
      p.disqualified_count,
      v_target AS target_count,
      LEAST(100, ROUND((p.qualified_count::numeric / NULLIF(v_target, 0)) * 100, 1)) AS progress_percent,
      p.payout_status,
      (p.qualified_count >= v_target) AS milestone_reached,
      COALESCE(p.milestone_eligible, true) AS milestone_eligible,
      p.excluded_at,
      p.exclusion_reason,
      v_settings.reward_amount_ngn,
      v_settings.reward_amount_usd,
      p.payout_amount_usd,
      p.payout_amount_ngn,
      p.credited_at,
      p.live_balance_before,
      p.live_balance_after,
      COALESCE(u.total_earnings, 0) AS current_live_balance_usd,
      p.admin_notes,
      p.reviewed_at,
      p.paid_at,
      p.updated_at
    FROM public.referral_milestone_payouts p
    LEFT JOIN public.users u ON u.id = p.referrer_id
    LEFT JOIN public.referral_codes rc ON rc.user_id = p.referrer_id
    WHERE (p_search IS NULL OR p_search = '' OR (
        COALESCE(u.display_name, '') ILIKE '%' || p_search || '%'
        OR COALESCE(u.email, '') ILIKE '%' || p_search || '%'
      ))
      AND (p_status IS NULL OR p_status = '' OR p.payout_status = p_status
           OR (p_status = 'paid' AND p.credited_at IS NOT NULL))
      AND (p_milestone_reached IS NULL
           OR (p_milestone_reached = true AND p.qualified_count >= v_target)
           OR (p_milestone_reached = false AND p.qualified_count < v_target))
      AND (p_min_qualified IS NULL OR p.qualified_count >= p_min_qualified)
    ORDER BY
      CASE WHEN p_sort = 'progress_desc' THEN p.qualified_count END DESC,
      CASE WHEN p_sort = 'progress_asc' THEN p.qualified_count END ASC,
      CASE WHEN p_sort = 'updated_desc' THEN p.updated_at END DESC NULLS LAST,
      CASE WHEN p_sort = 'name_asc' THEN COALESCE(u.display_name, u.email, '') END ASC,
      p.updated_at DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0), 'target_count', v_target);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_referral_milestone_referrer_detail(p_referrer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.referral_milestone_settings%ROWTYPE;
  v_payout public.referral_milestone_payouts%ROWTYPE;
  v_user jsonb;
  v_qualifications jsonb;
  v_live_balance numeric;
BEGIN
  IF NOT public.referral_milestone_is_admin() THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  IF p_referrer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'referrer_id required');
  END IF;

  PERFORM public.refresh_referral_milestone_payout(p_referrer_id);

  SELECT * INTO v_settings FROM public.referral_milestone_settings WHERE singleton_key = true LIMIT 1;
  SELECT * INTO v_payout FROM public.referral_milestone_payouts WHERE referrer_id = p_referrer_id;

  SELECT COALESCE(u.total_earnings, 0) INTO v_live_balance
  FROM public.users u WHERE u.id = p_referrer_id;

  SELECT jsonb_build_object(
    'id', u.id,
    'display_name', u.display_name,
    'email', u.email,
    'referral_code', rc.code,
    'current_live_balance_usd', COALESCE(u.total_earnings, 0)
  ) INTO v_user
  FROM public.users u
  LEFT JOIN public.referral_codes rc ON rc.user_id = u.id
  WHERE u.id = p_referrer_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'referral_id', q.referral_id,
      'referred_id', q.referred_id,
      'referred_name', COALESCE(ru.display_name, ru.email, 'Unknown'),
      'referred_email', ru.email,
      'status', q.status,
      'active_days', q.active_days,
      'min_active_days_required', v_settings.min_active_days,
      'disqualified_reason', q.disqualified_reason,
      'fraud_flags', q.fraud_flags,
      'qualified_at', q.qualified_at,
      'referral_created_at', r.created_at,
      'referral_status', r.status,
      'flagged_for_abuse', COALESCE(r.flagged_for_abuse, false)
    ) ORDER BY r.created_at DESC
  ), '[]'::jsonb)
  INTO v_qualifications
  FROM public.referral_milestone_qualifications q
  INNER JOIN public.referrals r ON r.id = q.referral_id
  LEFT JOIN public.users ru ON ru.id = q.referred_id
  WHERE q.referrer_id = p_referrer_id;

  RETURN jsonb_build_object(
    'ok', true,
    'referrer', v_user,
    'payout', jsonb_build_object(
      'qualified_count', COALESCE(v_payout.qualified_count, 0),
      'pending_count', COALESCE(v_payout.pending_count, 0),
      'disqualified_count', COALESCE(v_payout.disqualified_count, 0),
      'target_count', COALESCE(v_settings.required_qualified_referrals, 10),
      'milestone_reached', COALESCE(v_payout.qualified_count, 0) >= COALESCE(v_settings.required_qualified_referrals, 10),
      'milestone_eligible', COALESCE(v_payout.milestone_eligible, true),
      'excluded_at', v_payout.excluded_at,
      'exclusion_reason', v_payout.exclusion_reason,
      'payout_status', COALESCE(v_payout.payout_status, 'tracking'),
      'reward_amount_ngn', COALESCE(v_settings.reward_amount_ngn, 5000),
      'reward_amount_usd', COALESCE(v_settings.reward_amount_usd, 4),
      'payout_amount_usd', v_payout.payout_amount_usd,
      'payout_amount_ngn', v_payout.payout_amount_ngn,
      'credited_at', v_payout.credited_at,
      'live_balance_before', v_payout.live_balance_before,
      'live_balance_after', v_payout.live_balance_after,
      'current_live_balance_usd', v_live_balance,
      'auto_approve_payout', COALESCE(v_settings.auto_approve_payout, false),
      'admin_notes', v_payout.admin_notes,
      'reviewed_at', v_payout.reviewed_at,
      'paid_at', v_payout.paid_at
    ),
    'qualifications', v_qualifications
  );
END;
$$;
