/*
  # Revert: Treat referral uses referral_settings.min_activity_threshold again

  Restores process_referral_reward to total listen count from listening_history.
  The ₦5K Milestone program keeps its own min_active_days setting unchanged.
*/

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

COMMENT ON FUNCTION public.process_referral_reward(uuid) IS
  'Credits Treat referral rewards when referred user listen count reaches referral_settings.min_activity_threshold.';
