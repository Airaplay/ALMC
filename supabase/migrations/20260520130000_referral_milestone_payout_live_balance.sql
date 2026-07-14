/*
  # Referral milestone — Live Balance payout + filters

  - Credits users.total_earnings (withdrawable Live Balance) on approve/paid.
  - Idempotent: credited_at prevents double-credit.
  - auto_approve_payout: credits automatically when milestone is reached.
  - Does not touch treat_wallets / WithdrawEarnings screens.
*/

-- Settings: auto-approve toggle
ALTER TABLE public.referral_milestone_settings
  ADD COLUMN IF NOT EXISTS auto_approve_payout boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.referral_milestone_settings.auto_approve_payout IS
  'When true, reaching the qualified-referral milestone automatically credits Live Balance (users.total_earnings).';

-- Payout row: credit audit fields
ALTER TABLE public.referral_milestone_payouts
  ADD COLUMN IF NOT EXISTS payout_amount_usd numeric(12, 2),
  ADD COLUMN IF NOT EXISTS payout_amount_ngn integer,
  ADD COLUMN IF NOT EXISTS credited_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_balance_before numeric(12, 2),
  ADD COLUMN IF NOT EXISTS live_balance_after numeric(12, 2);

CREATE INDEX IF NOT EXISTS idx_referral_milestone_payouts_credited_at
  ON public.referral_milestone_payouts(credited_at)
  WHERE credited_at IS NOT NULL;

-- ============================================================================
-- Credit Live Balance (withdrawable via existing withdraw_user_funds RPC)
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

REVOKE ALL ON FUNCTION public.credit_referral_milestone_live_balance(uuid) FROM PUBLIC, anon;

-- ============================================================================
-- Refresh payout aggregates (+ optional auto-credit)
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

  SELECT payout_status INTO v_current_status
  FROM public.referral_milestone_payouts
  WHERE referrer_id = p_referrer_id;

  v_new_status := COALESCE(v_current_status, 'tracking');

  IF v_new_status IN ('tracking', 'ready_for_review')
     AND v_qualified >= v_settings.required_qualified_referrals THEN
    v_new_status := 'ready_for_review';
  ELSIF v_new_status = 'tracking'
        AND v_qualified < v_settings.required_qualified_referrals THEN
    v_new_status := 'tracking';
  END IF;

  INSERT INTO public.referral_milestone_payouts (
    referrer_id,
    qualified_count,
    pending_count,
    disqualified_count,
    payout_status,
    updated_at
  ) VALUES (
    p_referrer_id,
    COALESCE(v_qualified, 0),
    COALESCE(v_pending, 0),
    COALESCE(v_disqualified, 0),
    v_new_status,
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
      ELSE EXCLUDED.payout_status
    END,
    updated_at = now();

  IF COALESCE(v_settings.auto_approve_payout, false) = true
     AND v_qualified >= v_settings.required_qualified_referrals THEN
    SELECT public.credit_referral_milestone_live_balance(p_referrer_id) INTO v_credit_result;
  END IF;
END;
$$;

-- ============================================================================
-- Admin: approve + credit Live Balance
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_approve_referral_milestone_payout(
  p_referrer_id uuid,
  p_admin_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_credit jsonb;
BEGIN
  IF NOT public.referral_milestone_is_admin() THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  UPDATE public.referral_milestone_payouts
  SET
    payout_status = 'approved',
    admin_notes = COALESCE(p_admin_notes, admin_notes),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at = now()
  WHERE referrer_id = p_referrer_id
    AND credited_at IS NULL;

  SELECT public.credit_referral_milestone_live_balance(p_referrer_id) INTO v_credit;

  RETURN v_credit || jsonb_build_object('approved_by', auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_referral_milestone_payout(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_approve_referral_milestone_payout(uuid, text) FROM PUBLIC, anon;

-- ============================================================================
-- Admin: update payout status (reject only without credit; paid/approved credit)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_referral_milestone_payout_status(
  p_referrer_id uuid,
  p_payout_status text,
  p_admin_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_credit jsonb;
BEGIN
  IF NOT public.referral_milestone_is_admin() THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  IF p_payout_status NOT IN ('tracking', 'ready_for_review', 'approved', 'paid', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid payout_status');
  END IF;

  IF p_payout_status IN ('approved', 'paid') THEN
    RETURN public.admin_approve_referral_milestone_payout(p_referrer_id, p_admin_notes);
  END IF;

  IF p_payout_status = 'rejected' THEN
    UPDATE public.referral_milestone_payouts
    SET
      payout_status = 'rejected',
      admin_notes = COALESCE(p_admin_notes, admin_notes),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
    WHERE referrer_id = p_referrer_id
      AND credited_at IS NULL;

    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  UPDATE public.referral_milestone_payouts
  SET
    payout_status = p_payout_status,
    admin_notes = COALESCE(p_admin_notes, admin_notes),
    updated_at = now()
  WHERE referrer_id = p_referrer_id
    AND credited_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'status', p_payout_status);
END;
$$;

-- ============================================================================
-- Admin stats + settings (auto_approve)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_referral_milestone_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.referral_milestone_settings%ROWTYPE;
  v_ready integer;
  v_paid integer;
  v_tracking integer;
  v_approved integer;
BEGIN
  IF NOT public.referral_milestone_is_admin() THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  SELECT * INTO v_settings FROM public.referral_milestone_settings WHERE singleton_key = true LIMIT 1;

  SELECT
    COUNT(*) FILTER (WHERE payout_status = 'ready_for_review' AND credited_at IS NULL),
    COUNT(*) FILTER (WHERE credited_at IS NOT NULL OR payout_status = 'paid'),
    COUNT(*) FILTER (WHERE payout_status = 'tracking'),
    COUNT(*) FILTER (WHERE payout_status = 'approved' AND credited_at IS NULL)
  INTO v_ready, v_paid, v_tracking, v_approved
  FROM public.referral_milestone_payouts;

  RETURN jsonb_build_object(
    'settings', jsonb_build_object(
      'is_enabled', COALESCE(v_settings.is_enabled, false),
      'program_active', COALESCE(v_settings.program_active, true),
      'auto_approve_payout', COALESCE(v_settings.auto_approve_payout, false),
      'required_qualified_referrals', COALESCE(v_settings.required_qualified_referrals, 10),
      'min_active_days', COALESCE(v_settings.min_active_days, 3),
      'min_listens_per_active_day', COALESCE(v_settings.min_listens_per_active_day, 1),
      'reward_amount_ngn', COALESCE(v_settings.reward_amount_ngn, 5000),
      'reward_amount_usd', COALESCE(v_settings.reward_amount_usd, 4),
      'detect_abuse', COALESCE(v_settings.detect_abuse, true),
      'detect_shared_device', COALESCE(v_settings.detect_shared_device, true),
      'max_accounts_per_device', COALESCE(v_settings.max_accounts_per_device, 1),
      'program_start_at', v_settings.program_start_at,
      'total_paid_out', COALESCE(v_settings.total_paid_out, 0),
      'updated_at', v_settings.updated_at
    ),
    'stats', jsonb_build_object(
      'referrers_tracking', COALESCE(v_tracking, 0),
      'referrers_ready_for_review', COALESCE(v_ready, 0),
      'referrers_approved_pending_credit', COALESCE(v_approved, 0),
      'referrers_paid', COALESCE(v_paid, 0),
      'total_qualification_rows', (SELECT COUNT(*) FROM public.referral_milestone_qualifications),
      'total_qualified_referrals', (
        SELECT COUNT(*) FROM public.referral_milestone_qualifications WHERE status = 'qualified'
      ),
      'total_disqualified', (
        SELECT COUNT(*) FROM public.referral_milestone_qualifications WHERE status = 'disqualified'
      )
    )
  );
END;
$$;

-- Leaderboard with server-side filters
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

-- Referrer detail includes live balance credit info
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

-- Settings update includes auto_approve
CREATE OR REPLACE FUNCTION public.admin_update_referral_milestone_settings(
  p_is_enabled boolean,
  p_program_active boolean,
  p_required_qualified_referrals integer,
  p_min_active_days integer,
  p_reward_amount_ngn integer,
  p_reward_amount_usd numeric,
  p_detect_abuse boolean,
  p_detect_shared_device boolean,
  p_max_accounts_per_device integer,
  p_program_start_at timestamptz,
  p_auto_approve_payout boolean DEFAULT NULL
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

  UPDATE public.referral_milestone_settings
  SET
    is_enabled = COALESCE(p_is_enabled, is_enabled),
    program_active = COALESCE(p_program_active, program_active),
    required_qualified_referrals = COALESCE(p_required_qualified_referrals, required_qualified_referrals),
    min_active_days = COALESCE(p_min_active_days, min_active_days),
    reward_amount_ngn = COALESCE(p_reward_amount_ngn, reward_amount_ngn),
    reward_amount_usd = COALESCE(p_reward_amount_usd, reward_amount_usd),
    detect_abuse = COALESCE(p_detect_abuse, detect_abuse),
    detect_shared_device = COALESCE(p_detect_shared_device, detect_shared_device),
    max_accounts_per_device = COALESCE(p_max_accounts_per_device, max_accounts_per_device),
    program_start_at = COALESCE(p_program_start_at, program_start_at),
    auto_approve_payout = COALESCE(p_auto_approve_payout, auto_approve_payout),
    updated_by = auth.uid(),
    updated_at = now()
  WHERE singleton_key = true;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_referral_milestone_leaderboard(integer, integer, text, text, boolean, integer, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_referral_milestone_leaderboard(integer, integer, text, text, boolean, integer, text) FROM PUBLIC, anon;

-- Drop old 3-arg leaderboard signature if present
DROP FUNCTION IF EXISTS public.admin_get_referral_milestone_leaderboard(integer, integer, text);

-- Replace settings function (new arg count)
DROP FUNCTION IF EXISTS public.admin_update_referral_milestone_settings(boolean, boolean, integer, integer, integer, numeric, boolean, boolean, integer, timestamptz);

GRANT EXECUTE ON FUNCTION public.admin_update_referral_milestone_settings(boolean, boolean, integer, integer, integer, numeric, boolean, boolean, integer, timestamptz, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_referral_milestone_settings(boolean, boolean, integer, integer, integer, numeric, boolean, boolean, integer, timestamptz, boolean) FROM PUBLIC, anon;
