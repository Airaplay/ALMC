/*
  # Unify Treat "active" and ₦5K milestone "qualified" criteria

  Both programs now read the same thresholds from referral_milestone_settings:
  - min_active_days
  - min_listens_per_active_day

  Shared helper: measure_referred_user_activity()
  Used by process_referral_reward (Treat) and evaluate_referral_milestone_qualification (cash).
*/

CREATE OR REPLACE FUNCTION public.measure_referred_user_activity(p_referred_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ms public.referral_milestone_settings%ROWTYPE;
  v_days integer;
  v_min_days integer;
  v_min_listens integer;
BEGIN
  IF p_referred_id IS NULL THEN
    RETURN jsonb_build_object(
      'active_days', 0,
      'min_active_days', 3,
      'min_listens_per_active_day', 1,
      'meets_threshold', false
    );
  END IF;

  SELECT * INTO v_ms
  FROM public.referral_milestone_settings
  WHERE singleton_key = true
  LIMIT 1;

  v_min_days := COALESCE(v_ms.min_active_days, 3);
  v_min_listens := COALESCE(v_ms.min_listens_per_active_day, 1);
  v_days := public.count_user_listening_active_days(p_referred_id, v_min_listens);

  RETURN jsonb_build_object(
    'active_days', COALESCE(v_days, 0),
    'min_active_days', v_min_days,
    'min_listens_per_active_day', v_min_listens,
    'meets_threshold', COALESCE(v_days, 0) >= v_min_days
  );
END;
$$;

COMMENT ON FUNCTION public.measure_referred_user_activity(uuid) IS
  'Shared activity bar for Treat referrals (active/rewarded) and ₦5K milestone (qualified). Reads referral_milestone_settings.';

-- ============================================================================
-- Treat referrals — active + rewarded when meets_threshold
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_referral_reward(p_referred_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_referral_record RECORD;
  v_settings RECORD;
  v_activity jsonb;
  v_active_days integer;
  v_meets_threshold boolean;
  v_min_active_days integer;
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

  v_activity := public.measure_referred_user_activity(p_referred_id);
  v_active_days := COALESCE((v_activity->>'active_days')::integer, 0);
  v_min_active_days := COALESCE((v_activity->>'min_active_days')::integer, 3);
  v_meets_threshold := COALESCE((v_activity->>'meets_threshold')::boolean, false);

  IF v_meets_threshold THEN
    UPDATE public.referrals
    SET is_active = true, last_activity = now()
    WHERE id = v_referral_record.id;
  END IF;

  IF v_meets_threshold AND v_referral_record.status != 'rewarded' THEN
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
        format(
          'Referral reward - User active %s+ days (ID: %s)',
          v_min_active_days,
          p_referred_id
        )
      );
    ELSE
      UPDATE public.referrals
      SET
        status = 'active',
        is_active = true,
        last_activity = now()
      WHERE id = v_referral_record.id;
    END IF;
  ELSIF v_active_days > 0 AND v_referral_record.status = 'pending' THEN
    UPDATE public.referrals
    SET
      status = 'active',
      is_active = false,
      last_activity = now()
    WHERE id = v_referral_record.id;
  END IF;

  PERFORM public.refresh_referral_milestone_qualification(p_referred_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid) TO service_role;

COMMENT ON FUNCTION public.process_referral_reward(uuid) IS
  'Treat referral: active/rewarded when measure_referred_user_activity meets_threshold (same bar as ₦5K qualified).';

-- ============================================================================
-- ₦5K milestone — qualified uses same shared helper
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
  v_activity jsonb;
  v_active_days integer;
  v_meets_threshold boolean;
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

  v_activity := public.measure_referred_user_activity(v_ref.referred_id);
  v_active_days := COALESCE((v_activity->>'active_days')::integer, 0);
  v_meets_threshold := COALESCE((v_activity->>'meets_threshold')::boolean, false);

  SELECT public.detect_referral_milestone_fraud(v_ref.referrer_id, v_ref.referred_id)
  INTO v_fraud;

  IF COALESCE((v_fraud->>'is_fraud')::boolean, false) THEN
    v_status := 'disqualified';
    v_reason := COALESCE(v_fraud->>'reason', 'Disqualified by fraud checks');
  ELSIF v_meets_threshold THEN
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
