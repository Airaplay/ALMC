/*
  # Referral abuse detection + reward gating (no signature changes)
 
  Goals:
  - Detect obvious referral-farm patterns using existing signals (bot flags, IP fan-out, low-quality activation)
  - Flag referral rows for admin review via `referrals.flagged_for_abuse`
  - Prevent Treat rewards from being issued for suspicious referrals
 
  Notes:
  - Does NOT change any existing RPC/function signatures.
  - Only affects `process_referral_reward(p_referred_id uuid)` behavior when `referral_settings.detect_abuse = true`.
*/
 
-- Helper: lightweight referral abuse check (best-effort, bounded).
CREATE OR REPLACE FUNCTION public.detect_referral_abuse(
  p_referrer_id uuid,
  p_referred_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason text := NULL;
  v_is_abuse boolean := false;
 
  v_referrer_flagged boolean := false;
  v_referred_flagged boolean := false;
 
  v_ip text := NULL;
  v_distinct_users_same_ip int := 0;
 
  v_last30_count int := 0;
  v_unique_songs int := 0;
 
  v_interval_count int := 0;
  v_median_delta_s numeric := NULL;
  v_stddev_delta_s numeric := NULL;
BEGIN
  -- 1) If either side is already bot-flagged, treat referral as suspicious.
  SELECT COALESCE(is_flagged, false)
  INTO v_referrer_flagged
  FROM public.user_bot_flags
  WHERE user_id = p_referrer_id;
 
  SELECT COALESCE(is_flagged, false)
  INTO v_referred_flagged
  FROM public.user_bot_flags
  WHERE user_id = p_referred_id;
 
  IF v_referrer_flagged THEN
    v_is_abuse := true;
    v_reason := 'Referrer is already flagged for suspicious/bot-like behavior';
  ELSIF v_referred_flagged THEN
    v_is_abuse := true;
    v_reason := 'Referred user is flagged for suspicious/bot-like behavior';
  END IF;
 
  -- If listening_history is missing in some env, skip remaining checks safely.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'listening_history'
  ) THEN
    RETURN jsonb_build_object('is_abuse', v_is_abuse, 'reason', v_reason);
  END IF;
 
  -- 2) Shared IP fan-out (farm-like): many distinct users from same IP recently.
  IF NOT v_is_abuse THEN
    SELECT lh.ip_address
    INTO v_ip
    FROM public.listening_history lh
    WHERE lh.user_id = p_referred_id
      AND lh.ip_address IS NOT NULL
    ORDER BY lh.listened_at DESC
    LIMIT 1;
 
    IF v_ip IS NOT NULL THEN
      SELECT COUNT(DISTINCT user_id)
      INTO v_distinct_users_same_ip
      FROM public.listening_history
      WHERE ip_address = v_ip
        AND listened_at > now() - interval '24 hours'
        AND user_id IS NOT NULL;
 
      IF v_distinct_users_same_ip >= 50 THEN
        v_is_abuse := true;
        v_reason := 'High account fan-out from same IP (possible referral farm)';
      END IF;
    END IF;
  END IF;
 
  -- 3) Low-quality "activation gaming": last 30 plays are 1 song only.
  IF NOT v_is_abuse THEN
    WITH last30 AS (
      SELECT song_id
      FROM public.listening_history
      WHERE user_id = p_referred_id
      ORDER BY listened_at DESC
      LIMIT 30
    )
    SELECT COUNT(*), COUNT(DISTINCT song_id)
    INTO v_last30_count, v_unique_songs
    FROM last30;
 
    IF v_last30_count >= 30 AND v_unique_songs <= 1 THEN
      v_is_abuse := true;
      v_reason := 'Referred user activity is low-quality (single-song farming)';
    END IF;
  END IF;
 
  -- 4) Bot-like regular intervals over recent plays (bounded to last 12 within 30 minutes).
  IF NOT v_is_abuse THEN
    WITH last_plays AS (
      SELECT listened_at
      FROM public.listening_history
      WHERE user_id = p_referred_id
        AND listened_at > now() - interval '30 minutes'
      ORDER BY listened_at DESC
      LIMIT 12
    ),
    deltas AS (
      SELECT EXTRACT(EPOCH FROM (listened_at - LAG(listened_at) OVER (ORDER BY listened_at))) AS delta_s
      FROM last_plays
    )
    SELECT
      COUNT(*) FILTER (WHERE delta_s IS NOT NULL),
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY delta_s),
      STDDEV_SAMP(delta_s)
    INTO v_interval_count, v_median_delta_s, v_stddev_delta_s
    FROM deltas;
 
    IF v_interval_count >= 10
       AND v_median_delta_s BETWEEN 27 AND 33
       AND COALESCE(v_stddev_delta_s, 999999) <= 2 THEN
      v_is_abuse := true;
      v_reason := 'Referred user shows bot-like regular playback intervals';
    END IF;
  END IF;
 
  RETURN jsonb_build_object('is_abuse', v_is_abuse, 'reason', v_reason);
END;
$$;
 
GRANT EXECUTE ON FUNCTION public.detect_referral_abuse(uuid, uuid) TO service_role;
 
-- Update process_referral_reward to gate rewards when detect_abuse is enabled.
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
  -- Get the referral record
  SELECT * INTO v_referral_record
  FROM public.referrals
  WHERE referred_id = p_referred_id
    AND status IN ('pending', 'active')
  LIMIT 1;
 
  IF NOT FOUND THEN
    RETURN;
  END IF;
 
  -- Get referral settings
  SELECT * INTO v_settings
  FROM public.referral_settings
  ORDER BY created_at DESC
  LIMIT 1;
 
  -- Check if referral program is enabled
  IF NOT FOUND OR NOT v_settings.enabled OR NOT v_settings.program_active THEN
    RETURN;
  END IF;
 
  -- Check activity threshold (using listening_history as activity metric)
  SELECT COUNT(*) INTO v_activity_count
  FROM public.listening_history
  WHERE user_id = p_referred_id;
 
  -- Update is_active status in referrals table
  IF v_activity_count >= v_settings.min_activity_threshold THEN
    UPDATE public.referrals
    SET is_active = true, last_activity = now()
    WHERE id = v_referral_record.id;
  END IF;
 
  -- If user is active and not yet rewarded
  IF v_activity_count >= v_settings.min_activity_threshold AND v_referral_record.status != 'rewarded' THEN
    -- Abuse detection gate (only when enabled)
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
 
        -- Do not issue Treat rewards for suspicious referrals.
        RETURN;
      END IF;
    END IF;
 
    -- Check if referrer can still receive rewards (within limits)
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
END;
$$;
 
GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_reward(uuid) TO service_role;

