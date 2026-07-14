/*
  # Referral Milestone Program (Program 2)

  Separate from the existing Treat-per-referral program. Tracks referrers who
  invite 10 referred users that each stay active for at least N calendar days.

  - Admin-only visibility (RPCs + RLS). End users are not shown progress.
  - Reuses existing `referrals` rows (same signup / referral code flow).
  - Anti-farming: shared device, multi-account device, detect_referral_abuse().
  - Cash milestone (NGN / USD) is admin-reviewed; no automatic wallet credit.

  Does NOT modify InviteEarnScreen or the Treat referral reward path except
  adding a best-effort hook at the end of process_referral_reward().
*/

-- ============================================================================
-- 1) Device registry (anti-Sybil; populated via register_user_device RPC)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_device_registry (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_id text NOT NULL CHECK (char_length(trim(device_id)) >= 16),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  PRIMARY KEY (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_user_device_registry_device_id
  ON public.user_device_registry(device_id);

COMMENT ON TABLE public.user_device_registry IS
  'Per-install device identifiers for anti-farming. Not a hardware ID.';

ALTER TABLE public.user_device_registry ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_device_registry'
      AND policyname = 'Users manage own device registry rows'
  ) THEN
    CREATE POLICY "Users manage own device registry rows"
      ON public.user_device_registry
      FOR ALL
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================================
-- 2) Milestone program settings (singleton)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.referral_milestone_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_key boolean NOT NULL DEFAULT true,
  is_enabled boolean NOT NULL DEFAULT false,
  program_active boolean NOT NULL DEFAULT true,
  required_qualified_referrals integer NOT NULL DEFAULT 10
    CHECK (required_qualified_referrals > 0),
  min_active_days integer NOT NULL DEFAULT 3
    CHECK (min_active_days > 0),
  min_listens_per_active_day integer NOT NULL DEFAULT 1
    CHECK (min_listens_per_active_day > 0),
  reward_amount_ngn integer NOT NULL DEFAULT 5000 CHECK (reward_amount_ngn >= 0),
  reward_amount_usd numeric(12, 2) NOT NULL DEFAULT 4.00 CHECK (reward_amount_usd >= 0),
  detect_abuse boolean NOT NULL DEFAULT true,
  detect_shared_device boolean NOT NULL DEFAULT true,
  max_accounts_per_device integer NOT NULL DEFAULT 1
    CHECK (max_accounts_per_device > 0),
  program_start_at timestamptz NOT NULL DEFAULT now(),
  total_paid_out integer NOT NULL DEFAULT 0 CHECK (total_paid_out >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT referral_milestone_settings_singleton UNIQUE (singleton_key)
);

INSERT INTO public.referral_milestone_settings (singleton_key, is_enabled)
VALUES (true, false)
ON CONFLICT (singleton_key) DO NOTHING;

ALTER TABLE public.referral_milestone_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'referral_milestone_settings'
      AND policyname = 'Admins manage referral milestone settings'
  ) THEN
    CREATE POLICY "Admins manage referral milestone settings"
      ON public.referral_milestone_settings
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid() AND u.role IN ('admin', 'manager')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid() AND u.role IN ('admin', 'manager')
        )
      );
  END IF;
END $$;

-- ============================================================================
-- 3) Per-referral qualification + referrer payout tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.referral_milestone_qualifications (
  referral_id uuid PRIMARY KEY REFERENCES public.referrals(id) ON DELETE CASCADE,
  referrer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referred_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'qualified', 'disqualified')),
  active_days integer NOT NULL DEFAULT 0 CHECK (active_days >= 0),
  disqualified_reason text,
  fraud_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  qualified_at timestamptz,
  last_evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_milestone_qual_referrer
  ON public.referral_milestone_qualifications(referrer_id, status);

CREATE INDEX IF NOT EXISTS idx_referral_milestone_qual_referred
  ON public.referral_milestone_qualifications(referred_id);

ALTER TABLE public.referral_milestone_qualifications ENABLE ROW LEVEL SECURITY;

-- No user-facing SELECT policies (admin RPCs only).

CREATE TABLE IF NOT EXISTS public.referral_milestone_payouts (
  referrer_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  qualified_count integer NOT NULL DEFAULT 0 CHECK (qualified_count >= 0),
  pending_count integer NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
  disqualified_count integer NOT NULL DEFAULT 0 CHECK (disqualified_count >= 0),
  payout_status text NOT NULL DEFAULT 'tracking'
    CHECK (payout_status IN ('tracking', 'ready_for_review', 'approved', 'paid', 'rejected')),
  admin_notes text,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_milestone_payouts_status
  ON public.referral_milestone_payouts(payout_status);

ALTER TABLE public.referral_milestone_payouts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4) Helpers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.referral_milestone_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin', 'manager')
  );
$$;

GRANT EXECUTE ON FUNCTION public.referral_milestone_is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.count_user_listening_active_days(
  p_user_id uuid,
  p_min_listens_per_day integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'listening_history'
  ) THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::integer INTO v_count
  FROM (
    SELECT (lh.listened_at AT TIME ZONE 'UTC')::date AS d
    FROM public.listening_history lh
    WHERE lh.user_id = p_user_id
      AND lh.listened_at IS NOT NULL
    GROUP BY (lh.listened_at AT TIME ZONE 'UTC')::date
    HAVING COUNT(*) >= GREATEST(1, COALESCE(p_min_listens_per_day, 1))
  ) days;

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.detect_referral_milestone_fraud(
  p_referrer_id uuid,
  p_referred_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.referral_milestone_settings%ROWTYPE;
  v_is_fraud boolean := false;
  v_reason text := NULL;
  v_flags jsonb := '{}'::jsonb;
  v_abuse jsonb;
  v_device_users integer;
  v_shared_device boolean := false;
BEGIN
  SELECT * INTO v_settings
  FROM public.referral_milestone_settings
  WHERE singleton_key = true
  LIMIT 1;

  IF p_referrer_id = p_referred_id THEN
    RETURN jsonb_build_object(
      'is_fraud', true,
      'reason', 'Self-referral',
      'flags', jsonb_build_object('self_referral', true)
    );
  END IF;

  IF COALESCE(v_settings.detect_abuse, true) THEN
    IF to_regprocedure('public.detect_referral_abuse(uuid,uuid)') IS NOT NULL THEN
      SELECT public.detect_referral_abuse(p_referrer_id, p_referred_id) INTO v_abuse;
      IF COALESCE((v_abuse->>'is_abuse')::boolean, false) THEN
        v_is_fraud := true;
        v_reason := COALESCE(v_abuse->>'reason', 'Referral abuse detected');
        v_flags := v_flags || jsonb_build_object('referral_abuse', v_abuse);
      END IF;
    END IF;
  END IF;

  IF NOT v_is_fraud AND COALESCE(v_settings.detect_shared_device, true) THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.user_device_registry rd
      INNER JOIN public.user_device_registry rr
        ON rr.device_id = rd.device_id
      WHERE rd.user_id = p_referred_id
        AND rr.user_id = p_referrer_id
    ) INTO v_shared_device;

    IF v_shared_device THEN
      v_is_fraud := true;
      v_reason := 'Referrer and referred user share the same device';
      v_flags := v_flags || jsonb_build_object('shared_device_with_referrer', true);
    END IF;
  END IF;

  IF NOT v_is_fraud AND COALESCE(v_settings.detect_shared_device, true) THEN
    SELECT MAX(cnt) INTO v_device_users
    FROM (
      SELECT COUNT(DISTINCT udr.user_id)::integer AS cnt
      FROM public.user_device_registry udr
      WHERE udr.device_id IN (
        SELECT device_id FROM public.user_device_registry WHERE user_id = p_referred_id
      )
      GROUP BY udr.device_id
    ) x;

    IF COALESCE(v_device_users, 0) > COALESCE(v_settings.max_accounts_per_device, 1) THEN
      v_is_fraud := true;
      v_reason := format(
        'Multiple accounts (%s) detected on the same device',
        COALESCE(v_device_users, 0)
      );
      v_flags := v_flags || jsonb_build_object(
        'multi_account_device', true,
        'accounts_on_device', v_device_users
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'is_fraud', v_is_fraud,
    'reason', v_reason,
    'flags', v_flags
  );
END;
$$;

-- ============================================================================
-- 5) register_user_device — client best-effort (AuthContext)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.register_user_device(
  p_device_id text,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_device text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_authenticated');
  END IF;

  v_device := NULLIF(trim(p_device_id), '');
  IF v_device IS NULL OR char_length(v_device) < 16 THEN
    RETURN jsonb_build_object('ok', false, 'status', 'invalid_device_id');
  END IF;

  INSERT INTO public.user_device_registry (user_id, device_id, user_agent)
  VALUES (v_user_id, v_device, NULLIF(trim(p_user_agent), ''))
  ON CONFLICT (user_id, device_id) DO UPDATE SET
    last_seen_at = now(),
    user_agent = COALESCE(EXCLUDED.user_agent, public.user_device_registry.user_agent);

  RETURN jsonb_build_object('ok', true, 'status', 'registered');
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_user_device(text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.register_user_device(text, text) FROM PUBLIC, anon;

-- ============================================================================
-- 6) Evaluate qualification + refresh referrer aggregates
-- ============================================================================

CREATE OR REPLACE FUNCTION public.evaluate_referral_milestone_qualification(p_referral_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.referral_milestone_settings%ROWTYPE;
  v_ref public.referrals%ROWTYPE;
  v_active_days integer;
  v_fraud jsonb;
  v_status text;
  v_reason text;
BEGIN
  SELECT * INTO v_settings
  FROM public.referral_milestone_settings
  WHERE singleton_key = true
  LIMIT 1;

  IF NOT FOUND OR NOT v_settings.is_enabled OR NOT v_settings.program_active THEN
    RETURN;
  END IF;

  SELECT * INTO v_ref
  FROM public.referrals r
  WHERE r.id = p_referral_id
  LIMIT 1;

  IF NOT FOUND OR v_ref.status = 'revoked' THEN
    RETURN;
  END IF;

  IF v_ref.created_at < v_settings.program_start_at THEN
    RETURN;
  END IF;

  v_active_days := public.count_user_listening_active_days(
    v_ref.referred_id,
    v_settings.min_listens_per_active_day
  );

  SELECT public.detect_referral_milestone_fraud(v_ref.referrer_id, v_ref.referred_id)
  INTO v_fraud;

  IF COALESCE((v_fraud->>'is_fraud')::boolean, false) THEN
    v_status := 'disqualified';
    v_reason := COALESCE(v_fraud->>'reason', 'Disqualified by fraud checks');
  ELSIF v_active_days >= v_settings.min_active_days THEN
    v_status := 'qualified';
    v_reason := NULL;
  ELSE
    v_status := 'pending';
    v_reason := NULL;
  END IF;

  INSERT INTO public.referral_milestone_qualifications (
    referral_id,
    referrer_id,
    referred_id,
    status,
    active_days,
    disqualified_reason,
    fraud_flags,
    qualified_at,
    last_evaluated_at,
    updated_at
  ) VALUES (
    v_ref.id,
    v_ref.referrer_id,
    v_ref.referred_id,
    v_status,
    v_active_days,
    v_reason,
    COALESCE(v_fraud->'flags', '{}'::jsonb),
    CASE WHEN v_status = 'qualified' THEN now() ELSE NULL END,
    now(),
    now()
  )
  ON CONFLICT (referral_id) DO UPDATE SET
    status = EXCLUDED.status,
    active_days = EXCLUDED.active_days,
    disqualified_reason = EXCLUDED.disqualified_reason,
    fraud_flags = EXCLUDED.fraud_flags,
    qualified_at = CASE
      WHEN EXCLUDED.status = 'qualified'
        AND public.referral_milestone_qualifications.qualified_at IS NULL
      THEN now()
      WHEN EXCLUDED.status = 'qualified'
      THEN public.referral_milestone_qualifications.qualified_at
      ELSE NULL
    END,
    last_evaluated_at = now(),
    updated_at = now();

  PERFORM public.refresh_referral_milestone_payout(v_ref.referrer_id);
END;
$$;

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
      THEN public.referral_milestone_payouts.payout_status
      ELSE EXCLUDED.payout_status
    END,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_referral_milestone_qualification(p_referred_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_referral_id uuid;
BEGIN
  SELECT r.id INTO v_referral_id
  FROM public.referrals r
  WHERE r.referred_id = p_referred_id
    AND r.status <> 'revoked'
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_referral_id IS NOT NULL THEN
    PERFORM public.evaluate_referral_milestone_qualification(v_referral_id);
  END IF;
END;
$$;

-- Hook into existing Treat referral processor (additive tail call).
CREATE OR REPLACE FUNCTION public.process_referral_reward(p_referred_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_referral_record RECORD;
  v_settings RECORD;
  v_activity_count integer;
  v_limit_check jsonb;
  v_abuse_check jsonb;
  v_abuse_reason text;
BEGIN
  SELECT * INTO v_referral_record
  FROM public.referrals
  WHERE referred_id = p_referred_id
    AND status IN ('pending', 'active')
  LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.refresh_referral_milestone_qualification(p_referred_id);
    RETURN;
  END IF;

  SELECT * INTO v_settings
  FROM public.referral_settings
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND OR NOT v_settings.enabled OR NOT v_settings.program_active THEN
    PERFORM public.refresh_referral_milestone_qualification(p_referred_id);
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_activity_count
  FROM public.listening_history
  WHERE user_id = p_referred_id;

  IF v_activity_count >= v_settings.min_activity_threshold THEN
    UPDATE public.referrals
    SET is_active = true, last_activity = now()
    WHERE id = v_referral_record.id;
  END IF;

  IF v_activity_count >= v_settings.min_activity_threshold AND v_referral_record.status != 'rewarded' THEN
    IF COALESCE(v_settings.detect_abuse, true) = true THEN
      SELECT public.detect_referral_abuse(v_referral_record.referrer_id, p_referred_id)
      INTO v_abuse_check;

      IF COALESCE((v_abuse_check->>'is_abuse')::boolean, false) = true THEN
        v_abuse_reason := COALESCE(v_abuse_check->>'reason', 'Referral flagged for suspected abuse');

        UPDATE public.referrals
        SET
          flagged_for_abuse = true,
          abuse_reason = v_abuse_reason,
          abuse_flagged_at = COALESCE(public.referrals.abuse_flagged_at, now()),
          status = 'active',
          is_active = true,
          last_activity = now()
        WHERE id = v_referral_record.id;

        PERFORM public.refresh_referral_milestone_qualification(p_referred_id);
        RETURN;
      END IF;
    END IF;

    SELECT public.check_referral_limit(v_referral_record.referrer_id) INTO v_limit_check;

    IF (v_limit_check->>'can_refer')::boolean = true THEN
      UPDATE public.referrals
      SET
        status = 'rewarded',
        reward_amount = v_settings.reward_per_referral,
        rewarded_at = now(),
        is_active = true,
        last_activity = now()
      WHERE id = v_referral_record.id;

      PERFORM public.add_treat_balance(
        v_referral_record.referrer_id,
        v_settings.reward_per_referral,
        'referral_bonus',
        format('Referral reward - User became active (ID: %s)', p_referred_id)
      );
    ELSE
      UPDATE public.referrals
      SET
        status = 'active',
        is_active = true,
        last_activity = now()
      WHERE id = v_referral_record.id;
    END IF;
  ELSIF v_activity_count > 0 AND v_referral_record.status = 'pending' THEN
    UPDATE public.referrals
    SET
      status = 'active',
      is_active = true,
      last_activity = now()
    WHERE id = v_referral_record.id;
  END IF;

  PERFORM public.refresh_referral_milestone_qualification(p_referred_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid) TO service_role;

-- ============================================================================
-- 7) Admin RPCs
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
BEGIN
  IF NOT public.referral_milestone_is_admin() THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  SELECT * INTO v_settings FROM public.referral_milestone_settings WHERE singleton_key = true LIMIT 1;

  SELECT
    COUNT(*) FILTER (WHERE payout_status = 'ready_for_review'),
    COUNT(*) FILTER (WHERE payout_status = 'paid'),
    COUNT(*) FILTER (WHERE payout_status = 'tracking')
  INTO v_ready, v_paid, v_tracking
  FROM public.referral_milestone_payouts;

  RETURN jsonb_build_object(
    'settings', jsonb_build_object(
      'is_enabled', COALESCE(v_settings.is_enabled, false),
      'program_active', COALESCE(v_settings.program_active, true),
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

CREATE OR REPLACE FUNCTION public.admin_get_referral_milestone_leaderboard(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
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
BEGIN
  IF NOT public.referral_milestone_is_admin() THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  SELECT * INTO v_settings FROM public.referral_milestone_settings WHERE singleton_key = true LIMIT 1;

  SELECT COUNT(DISTINCT p.referrer_id) INTO v_total
  FROM public.referral_milestone_payouts p
  LEFT JOIN public.users u ON u.id = p.referrer_id
  WHERE p_search IS NULL OR p_search = '' OR (
    COALESCE(u.display_name, '') ILIKE '%' || p_search || '%'
    OR COALESCE(u.email, '') ILIKE '%' || p_search || '%'
  );

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.qualified_count DESC, t.updated_at DESC), '[]'::jsonb)
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
      v_settings.required_qualified_referrals AS target_count,
      LEAST(
        100,
        ROUND(
          (p.qualified_count::numeric / NULLIF(v_settings.required_qualified_referrals, 0)) * 100,
          1
        )
      ) AS progress_percent,
      p.payout_status,
      v_settings.reward_amount_ngn,
      v_settings.reward_amount_usd,
      p.admin_notes,
      p.reviewed_at,
      p.paid_at,
      p.updated_at
    FROM public.referral_milestone_payouts p
    LEFT JOIN public.users u ON u.id = p.referrer_id
    LEFT JOIN public.referral_codes rc ON rc.user_id = p.referrer_id
    WHERE p_search IS NULL OR p_search = '' OR (
      COALESCE(u.display_name, '') ILIKE '%' || p_search || '%'
      OR COALESCE(u.email, '') ILIKE '%' || p_search || '%'
    )
    ORDER BY p.qualified_count DESC, p.updated_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) t;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
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

  SELECT jsonb_build_object(
    'id', u.id,
    'display_name', u.display_name,
    'email', u.email,
    'referral_code', rc.code
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
      'payout_status', COALESCE(v_payout.payout_status, 'tracking'),
      'reward_amount_ngn', COALESCE(v_settings.reward_amount_ngn, 5000),
      'reward_amount_usd', COALESCE(v_settings.reward_amount_usd, 4),
      'admin_notes', v_payout.admin_notes,
      'reviewed_at', v_payout.reviewed_at,
      'paid_at', v_payout.paid_at
    ),
    'qualifications', v_qualifications
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_refresh_referral_milestone_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref record;
  v_count integer := 0;
BEGIN
  IF NOT public.referral_milestone_is_admin() THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  FOR v_ref IN
    SELECT r.id
    FROM public.referrals r
    WHERE r.status <> 'revoked'
    ORDER BY r.created_at DESC
  LOOP
    PERFORM public.evaluate_referral_milestone_qualification(v_ref.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'evaluated', v_count);
END;
$$;

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
  p_program_start_at timestamptz
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
    updated_by = auth.uid(),
    updated_at = now()
  WHERE singleton_key = true;

  RETURN jsonb_build_object('ok', true);
END;
$$;

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
BEGIN
  IF NOT public.referral_milestone_is_admin() THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  IF p_payout_status NOT IN ('tracking', 'ready_for_review', 'approved', 'paid', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid payout_status');
  END IF;

  INSERT INTO public.referral_milestone_payouts (referrer_id, payout_status, admin_notes, updated_at)
  VALUES (p_referrer_id, p_payout_status, p_admin_notes, now())
  ON CONFLICT (referrer_id) DO UPDATE SET
    payout_status = EXCLUDED.payout_status,
    admin_notes = COALESCE(EXCLUDED.admin_notes, public.referral_milestone_payouts.admin_notes),
    reviewed_by = CASE
      WHEN EXCLUDED.payout_status IN ('approved', 'rejected', 'paid') THEN auth.uid()
      ELSE public.referral_milestone_payouts.reviewed_by
    END,
    reviewed_at = CASE
      WHEN EXCLUDED.payout_status IN ('approved', 'rejected', 'paid') THEN now()
      ELSE public.referral_milestone_payouts.reviewed_at
    END,
    paid_at = CASE
      WHEN EXCLUDED.payout_status = 'paid' THEN now()
      ELSE public.referral_milestone_payouts.paid_at
    END,
    updated_at = now();

  IF p_payout_status = 'paid' THEN
    UPDATE public.referral_milestone_settings
    SET total_paid_out = total_paid_out + 1, updated_at = now()
    WHERE singleton_key = true;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_referral_milestone_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_referral_milestone_leaderboard(integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_referral_milestone_referrer_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refresh_referral_milestone_all() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_referral_milestone_settings(boolean, boolean, integer, integer, integer, numeric, boolean, boolean, integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_referral_milestone_payout_status(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_get_referral_milestone_stats() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_referral_milestone_leaderboard(integer, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_referral_milestone_referrer_detail(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_refresh_referral_milestone_all() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_referral_milestone_settings(boolean, boolean, integer, integer, integer, numeric, boolean, boolean, integer, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_referral_milestone_payout_status(uuid, text, text) FROM PUBLIC, anon;
