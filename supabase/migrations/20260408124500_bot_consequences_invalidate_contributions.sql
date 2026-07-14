/*
  # Bot Consequences: Stop Contributor Score + Invalidate / Clawback

  Implements:
  - If a user is flagged for bot-like behavior, contributions stop counting (RPC gate)
  - Admin RPC to invalidate (not delete) past contribution events and claw back points

  Notes:
  - Uses existing `user_play_statistics.is_flagged` (from play fraud system) as the gate.
  - Keeps everything auditable; contributions are marked invalid with reason/timestamp.
*/

-- 1) Add invalidation fields to listener_contributions (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'listener_contributions'
      AND column_name = 'is_valid'
  ) THEN
    ALTER TABLE public.listener_contributions
      ADD COLUMN is_valid boolean NOT NULL DEFAULT true,
      ADD COLUMN invalidated_at timestamptz,
      ADD COLUMN invalid_reason text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_listener_contributions_valid
  ON public.listener_contributions(user_id, created_at DESC)
  WHERE is_valid = true;

-- 2) Update record_listener_contribution to gate flagged users.
--    (Signature unchanged: returns jsonb.)
CREATE OR REPLACE FUNCTION public.record_listener_contribution(
  p_user_id uuid,
  p_activity_type text,
  p_reference_id uuid DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_points integer := 0;
  v_daily_cap integer := 20;
  v_daily_earnings_cap integer := 100;
  v_cooldown_minutes integer := 5;
  v_current_count integer := 0;
  v_current_daily_points integer := 0;
  v_last_contribution timestamptz;
  v_user_role text;
  v_content_creator_id uuid;
  v_contribution_id uuid;
  v_rewards_active boolean;
  v_is_flagged boolean := false;
BEGIN
  -- Hard gate: flagged users cannot earn Contributor Score
  -- Prefer user_bot_flags (created by enhanced fraud detection).
  SELECT COALESCE(ubf.is_flagged, false)
  INTO v_is_flagged
  FROM public.user_bot_flags ubf
  WHERE ubf.user_id = p_user_id;

  -- Backward-compatible fallback: if legacy user_play_statistics exists, honor it too.
  IF NOT v_is_flagged AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_play_statistics'
  ) THEN
    EXECUTE 'SELECT COALESCE(is_flagged, false) FROM public.user_play_statistics WHERE user_id = $1'
    INTO v_is_flagged
    USING p_user_id;
  END IF;

  IF v_is_flagged THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Suspicious playback activity detected. Contributor Score is paused for this account.'
    );
  END IF;

  -- Check if contribution rewards are active
  SELECT is_active INTO v_rewards_active
  FROM public.platform_financial_controls
  WHERE control_name = 'contribution_rewards_active';

  IF NOT v_rewards_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Contribution rewards are currently paused'
    );
  END IF;

  -- Get user role
  SELECT role INTO v_user_role
  FROM public.users
  WHERE id = p_user_id;

  -- Prevent creators earning from own content (existing behavior)
  IF p_reference_id IS NOT NULL AND v_user_role = 'creator' THEN
    CASE p_reference_type
      WHEN 'song' THEN
        SELECT artist_id INTO v_content_creator_id
        FROM public.songs WHERE id = p_reference_id;
      WHEN 'album' THEN
        SELECT artist_id INTO v_content_creator_id
        FROM public.albums WHERE id = p_reference_id;
      WHEN 'video' THEN
        SELECT artist_id INTO v_content_creator_id
        FROM public.videos WHERE id = p_reference_id;
      WHEN 'playlist' THEN
        SELECT user_id INTO v_content_creator_id
        FROM public.playlists WHERE id = p_reference_id;
      ELSE
        v_content_creator_id := NULL;
    END CASE;

    IF v_content_creator_id = p_user_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Creators cannot earn rewards from their own content'
      );
    END IF;
  END IF;

  -- Check daily activity cap
  SELECT COALESCE(count, 0), last_contribution_at
  INTO v_current_count, v_last_contribution
  FROM public.contribution_rate_limits
  WHERE user_id = p_user_id
    AND activity_type = p_activity_type
    AND contribution_date = CURRENT_DATE;

  IF v_current_count >= v_daily_cap THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Daily limit reached for %s. You can earn more tomorrow!', p_activity_type),
      'limit', v_daily_cap,
      'current', v_current_count
    );
  END IF;

  -- Check cooldown period
  IF v_last_contribution IS NOT NULL AND
     v_last_contribution > NOW() - (v_cooldown_minutes || ' minutes')::interval THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Please wait %s minutes between actions', v_cooldown_minutes),
      'cooldown_remaining_seconds', EXTRACT(EPOCH FROM (v_last_contribution + (v_cooldown_minutes || ' minutes')::interval - NOW()))::integer
    );
  END IF;

  -- Check daily earnings cap
  SELECT COALESCE(total_points_earned, 0)
  INTO v_current_daily_points
  FROM public.user_daily_earnings
  WHERE user_id = p_user_id
    AND earning_date = CURRENT_DATE;

  -- Get reward points for this activity
  SELECT base_reward_points INTO v_points
  FROM public.contribution_activities
  WHERE activity_type = p_activity_type
    AND is_active = true;

  IF v_points IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid activity type or activity is not active'
    );
  END IF;

  IF (v_current_daily_points + v_points) > v_daily_earnings_cap THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Daily earning cap reached. Current: %s points, Cap: %s points', v_current_daily_points, v_daily_earnings_cap),
      'points_earned_today', v_current_daily_points,
      'daily_cap', v_daily_earnings_cap
    );
  END IF;

  -- Record the contribution (mark valid by default)
  INSERT INTO public.listener_contributions (
    user_id,
    activity_type,
    reference_id,
    reference_type,
    contribution_points,
    metadata,
    is_valid
  ) VALUES (
    p_user_id,
    p_activity_type,
    p_reference_id,
    p_reference_type,
    v_points,
    p_metadata,
    true
  )
  RETURNING id INTO v_contribution_id;

  -- Update rate limit
  INSERT INTO public.contribution_rate_limits (
    user_id,
    activity_type,
    contribution_date,
    count,
    last_contribution_at
  ) VALUES (
    p_user_id,
    p_activity_type,
    CURRENT_DATE,
    1,
    NOW()
  )
  ON CONFLICT (user_id, activity_type, contribution_date)
  DO UPDATE SET
    count = public.contribution_rate_limits.count + 1,
    last_contribution_at = NOW();

  -- Update daily earnings
  INSERT INTO public.user_daily_earnings (
    user_id,
    earning_date,
    total_points_earned
  ) VALUES (
    p_user_id,
    CURRENT_DATE,
    v_points
  )
  ON CONFLICT (user_id, earning_date)
  DO UPDATE SET
    total_points_earned = public.user_daily_earnings.total_points_earned + v_points,
    updated_at = NOW();

  -- Update contribution scores
  INSERT INTO public.listener_contribution_scores (
    user_id,
    total_points,
    current_period_points,
    updated_at
  ) VALUES (
    p_user_id,
    v_points,
    v_points,
    NOW()
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    total_points = public.listener_contribution_scores.total_points + v_points,
    current_period_points = public.listener_contribution_scores.current_period_points + v_points,
    updated_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'points_earned', v_points,
    'activity_count_today', v_current_count + 1,
    'daily_activity_cap', v_daily_cap,
    'total_points_today', v_current_daily_points + v_points,
    'daily_earnings_cap', v_daily_earnings_cap,
    'contribution_id', v_contribution_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_listener_contribution(uuid, text, uuid, text, jsonb) TO authenticated, service_role, anon;

-- 3) Admin RPC: invalidate contributions and claw back points.
CREATE OR REPLACE FUNCTION public.admin_invalidate_contributions_and_clawback(
  p_user_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_reason text DEFAULT 'Invalidated due to suspicious/bot-like behavior'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_points_to_remove bigint := 0;
  v_invalidated_count int := 0;
  v_prev_total int := 0;
  v_prev_period int := 0;
  v_new_total int := 0;
  v_new_period int := 0;
BEGIN
  -- Verify admin
  SELECT id INTO v_admin_id
  FROM public.users
  WHERE id = auth.uid()
    AND role = 'admin';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Ensure score row exists
  INSERT INTO public.listener_contribution_scores (user_id, total_points, current_period_points)
  VALUES (p_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT total_points, current_period_points
  INTO v_prev_total, v_prev_period
  FROM public.listener_contribution_scores
  WHERE user_id = p_user_id;

  -- Sum points to remove from still-valid contributions in window
  SELECT COALESCE(SUM(contribution_points), 0), COUNT(*)
  INTO v_points_to_remove, v_invalidated_count
  FROM public.listener_contributions
  WHERE user_id = p_user_id
    AND is_valid = true
    AND (p_from IS NULL OR created_at >= p_from)
    AND (p_to IS NULL OR created_at <= p_to);

  -- Mark contributions invalid (audit fields)
  UPDATE public.listener_contributions
  SET
    is_valid = false,
    invalidated_at = now(),
    invalid_reason = p_reason
  WHERE user_id = p_user_id
    AND is_valid = true
    AND (p_from IS NULL OR created_at >= p_from)
    AND (p_to IS NULL OR created_at <= p_to);

  -- Claw back points (never below 0)
  v_new_total := GREATEST(0, COALESCE(v_prev_total, 0) - v_points_to_remove::int);
  v_new_period := GREATEST(0, COALESCE(v_prev_period, 0) - v_points_to_remove::int);

  UPDATE public.listener_contribution_scores
  SET
    total_points = v_new_total,
    current_period_points = v_new_period,
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Log adjustments (use existing adjustments table if present)
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'contribution_score_adjustments'
  ) THEN
    INSERT INTO public.contribution_score_adjustments (
      user_id,
      admin_id,
      points_change,
      category,
      reason,
      previous_value,
      new_value
    ) VALUES (
      p_user_id,
      v_admin_id,
      -v_points_to_remove::int,
      'total_points',
      p_reason,
      COALESCE(v_prev_total, 0),
      v_new_total
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'invalidated_count', v_invalidated_count,
    'points_removed', v_points_to_remove,
    'previous_total_points', v_prev_total,
    'new_total_points', v_new_total,
    'previous_current_period_points', v_prev_period,
    'new_current_period_points', v_new_period,
    'reason', p_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_invalidate_contributions_and_clawback(uuid, timestamptz, timestamptz, text) TO authenticated;

