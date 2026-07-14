/*
  Prevent double-crediting listeners when self-service conversion is active.

  Self-service pays users one-at-a-time from the AdMob-funded pool.
  Batch monthly pays all eligible users in one admin/cron run.
  These paths must not run together.
*/

CREATE OR REPLACE FUNCTION public.self_service_conversion_is_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE((
    SELECT s.self_service_conversion_enabled
    FROM public.contribution_conversion_settings s
    WHERE s.is_active = true
    ORDER BY s.updated_at DESC
    LIMIT 1
  ), true);
$$;

COMMENT ON FUNCTION public.self_service_conversion_is_enabled() IS
  'True when listener self-service conversion is active (default true). Batch monthly conversion must stay off.';

REVOKE ALL ON FUNCTION public.self_service_conversion_is_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.self_service_conversion_is_enabled() TO authenticated;
GRANT EXECUTE ON FUNCTION public.self_service_conversion_is_enabled() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_distribute_contribution_rewards(
  p_period_date date,
  p_reward_pool_usd numeric,
  p_include_external_revenue_topups boolean DEFAULT false
)
RETURNS TABLE (
  success boolean,
  total_distributed_usd numeric,
  distributed_count integer,
  scaling_applied boolean,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF public.self_service_conversion_is_enabled() THEN
    RETURN QUERY
    SELECT
      false::boolean,
      0::numeric,
      0::integer,
      false::boolean,
      'Admin batch conversion is disabled while self-service conversion is enabled. Users convert from the funded pool, or disable self_service_conversion_enabled in settings.'::text;
    RETURN;
  END IF;

  IF auth.role() = 'service_role' THEN
    RETURN QUERY
    SELECT * FROM public._admin_distribute_contribution_rewards_legacy(p_period_date, p_reward_pool_usd);
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  RETURN QUERY
  SELECT * FROM public._admin_distribute_contribution_rewards_legacy(p_period_date, p_reward_pool_usd);
END;
$$;

CREATE OR REPLACE FUNCTION public._admin_distribute_contribution_rewards_legacy(
  p_period_date date,
  p_reward_pool_usd numeric
)
RETURNS TABLE (
  success boolean,
  total_distributed_usd numeric,
  distributed_count integer,
  scaling_applied boolean,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin_id uuid;
  v_total_points bigint;
  v_total_weighted numeric;
  v_conversion_history_id uuid;
  v_users_rewarded integer := 0;
  v_total_distributed numeric := 0;
  v_conversion_rate numeric;
  v_min_points integer;
  v_scaling_applied boolean := false;
  v_actual_rate numeric;
BEGIN
  IF public.self_service_conversion_is_enabled() THEN
    RETURN QUERY
    SELECT
      false::boolean,
      0::numeric,
      0::integer,
      false::boolean,
      'Legacy batch conversion blocked: self-service conversion is enabled.'::text;
    RETURN;
  END IF;

  v_admin_id := auth.uid();

  IF p_reward_pool_usd IS NULL OR p_reward_pool_usd <= 0 THEN
    RAISE EXCEPTION 'Reward pool must be greater than 0';
  END IF;

  SELECT cs.conversion_rate, cs.minimum_points_for_payout
  INTO v_conversion_rate, v_min_points
  FROM public.contribution_conversion_settings cs
  WHERE cs.is_active = true
  ORDER BY cs.updated_at DESC
  LIMIT 1;

  v_conversion_rate := COALESCE(v_conversion_rate, 0.001);
  v_min_points := COALESCE(v_min_points, 10);

  SELECT
    COALESCE(SUM(lcs.current_period_points), 0),
    COALESCE(SUM(lcs.current_period_points::numeric * public.get_contribution_cash_multiplier(lcs.user_id)), 0)
  INTO v_total_points, v_total_weighted
  FROM public.listener_contribution_scores lcs
  WHERE lcs.current_period_points >= v_min_points;

  IF v_total_weighted = 0 THEN
    RETURN QUERY SELECT true, 0::numeric, 0, false, 'No eligible users found with minimum points'::text;
    RETURN;
  END IF;

  IF (v_total_weighted * v_conversion_rate) > p_reward_pool_usd THEN
    v_scaling_applied := true;
    v_actual_rate := p_reward_pool_usd / v_total_weighted;
  ELSE
    v_actual_rate := v_conversion_rate;
  END IF;

  INSERT INTO public.contribution_conversion_history (
    conversion_date,
    reward_pool_usd,
    total_points_converted,
    total_users_paid,
    conversion_rate_used,
    actual_rate_applied,
    scaling_applied,
    total_distributed_usd,
    executed_by,
    status
  )
  VALUES (
    p_period_date,
    p_reward_pool_usd,
    v_total_points,
    0,
    v_conversion_rate,
    v_actual_rate,
    v_scaling_applied,
    0,
    v_admin_id,
    'processing'
  )
  RETURNING id INTO v_conversion_history_id;

  CREATE TEMP TABLE earnings_updates AS
  SELECT
    lcs.user_id,
    lcs.current_period_points AS total_points,
    public.get_contribution_cash_multiplier(lcs.user_id) AS cash_multiplier,
    FLOOR((lcs.current_period_points::numeric * public.get_contribution_cash_multiplier(lcs.user_id) * v_actual_rate) * 100) / 100.0 AS reward_amount_usd
  FROM public.listener_contribution_scores lcs
  WHERE lcs.current_period_points >= v_min_points;

  UPDATE public.users u
  SET total_earnings = COALESCE(u.total_earnings, 0) + eu.reward_amount_usd,
      updated_at = now()
  FROM earnings_updates eu
  WHERE u.id = eu.user_id
    AND eu.reward_amount_usd > 0;

  INSERT INTO public.contribution_rewards_history (
    user_id, period_date, contribution_points, reward_amount_usd, reward_source, status
  )
  SELECT
    eu.user_id,
    p_period_date,
    eu.total_points,
    eu.reward_amount_usd,
    'admin_batch_listener_score',
    'completed'
  FROM earnings_updates eu
  WHERE eu.reward_amount_usd > 0;

  SELECT COUNT(*)::integer, COALESCE(SUM(reward_amount_usd), 0)
  INTO v_users_rewarded, v_total_distributed
  FROM earnings_updates
  WHERE reward_amount_usd > 0;

  INSERT INTO public.notifications (user_id, type, category, title, message, metadata, is_read)
  SELECT
    eu.user_id,
    'reward',
    'contribution_rewards',
    'Listeners Score Converted',
    'You earned $' || eu.reward_amount_usd::text || ' from your ' || eu.total_points::text || ' Listeners Score this month!',
    jsonb_build_object(
      'conversion_history_id', v_conversion_history_id,
      'period_date', p_period_date,
      'amount_usd', eu.reward_amount_usd,
      'points_converted', eu.total_points,
      'creator_cash_multiplier', eu.cash_multiplier,
      'source', 'contribution_rewards'
    ),
    false
  FROM earnings_updates eu
  WHERE eu.reward_amount_usd > 0;

  UPDATE public.listener_contribution_scores lcs
  SET current_period_points = 0,
      last_reward_date = p_period_date,
      updated_at = now()
  FROM earnings_updates eu
  WHERE lcs.user_id = eu.user_id;

  UPDATE public.contribution_conversion_history
  SET total_users_paid = v_users_rewarded,
      total_distributed_usd = v_total_distributed,
      status = 'completed'
  WHERE id = v_conversion_history_id;

  DROP TABLE IF EXISTS earnings_updates;

  RETURN QUERY
  SELECT true, v_total_distributed, v_users_rewarded, v_scaling_applied, 'Conversion completed successfully.'::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.service_run_scheduled_monthly_contribution_conversion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_auto boolean;
  v_month date;
  v_metrics jsonb;
  v_pool numeric;
  v_row record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_role only');
  END IF;

  IF public.self_service_conversion_is_enabled() THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'self_service_conversion_enabled'
    );
  END IF;

  SELECT COALESCE(auto_execute_monthly_conversion, false)
  INTO v_auto
  FROM public.contribution_conversion_settings
  WHERE is_active = true
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT COALESCE(v_auto, false) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'auto_execute_monthly_conversion_disabled'
    );
  END IF;

  v_month := date_trunc('month', (CURRENT_DATE - interval '1 month'))::date;

  IF EXISTS (
    SELECT 1
    FROM public.contribution_conversion_history h
    WHERE h.status = 'completed'
      AND date_trunc('month', h.conversion_date)::date = v_month
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_completed_for_month',
      'period', v_month
    );
  END IF;

  v_metrics := private.compute_contribution_pool_suggestion(v_month);

  IF COALESCE((v_metrics->>'caps_missing')::boolean, false) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'ad_safety_caps_missing',
      'period', v_month,
      'metrics', v_metrics
    );
  END IF;

  v_pool := (v_metrics->>'suggested_pool_usd')::numeric;

  IF v_pool IS NULL OR v_pool <= 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'zero_or_negative_pool',
      'period', v_month,
      'metrics', v_metrics
    );
  END IF;

  SELECT * INTO v_row
  FROM public.admin_distribute_contribution_rewards(v_month, v_pool)
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'executed', true,
    'period', v_month,
    'reward_pool_usd', v_pool,
    'metrics', v_metrics,
    'distribution_success', v_row.success,
    'total_distributed_usd', v_row.total_distributed_usd,
    'distributed_count', v_row.distributed_count,
    'scaling_applied', v_row.scaling_applied,
    'message', v_row.message
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_contribution_monthly_auto_conversion()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_token text;
  v_base_url text;
  v_auto boolean;
  v_h int;
  v_m int;
  v_not_before timestamptz;
  v_now_h int;
  v_now_m int;
BEGIN
  SELECT
    COALESCE(s.auto_execute_monthly_conversion, false),
    s.auto_conversion_run_hour_utc,
    s.auto_conversion_run_minute_utc,
    s.auto_conversion_not_before_utc
  INTO v_auto, v_h, v_m, v_not_before
  FROM public.contribution_conversion_settings s
  WHERE s.is_active = true
  ORDER BY s.updated_at DESC
  LIMIT 1;

  IF NOT FOUND OR NOT COALESCE(v_auto, false) THEN
    RETURN 0;
  END IF;

  IF public.self_service_conversion_is_enabled() THEN
    RETURN 0;
  END IF;

  IF v_not_before IS NOT NULL AND now() < v_not_before THEN
    RETURN 0;
  END IF;

  v_now_h := extract(hour FROM timezone('utc', now()))::int;
  v_now_m := extract(minute FROM timezone('utc', now()))::int;

  IF v_now_h IS DISTINCT FROM COALESCE(v_h, 7) OR v_now_m IS DISTINCT FROM COALESCE(v_m, 0) THEN
    RETURN 0;
  END IF;

  v_base_url := public.get_supabase_url();
  v_token := private.get_service_role_jwt_for_pg_net();

  IF v_token IS NULL OR length(v_token) < 10 THEN
    RAISE WARNING 'contribution-monthly-convert skipped: configure private.pg_net_edge_config or app.supabase_service_key';
    RETURN 0;
  END IF;

  PERFORM net.http_post(
    url := v_base_url || '/functions/v1/contribution-monthly-convert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token,
      'apikey', v_token
    ),
    body := jsonb_build_object('sync_type', 'scheduled')
  );

  RETURN 1;
END;
$$;

COMMENT ON FUNCTION public.service_run_scheduled_monthly_contribution_conversion() IS
  'service_role: idempotently run monthly batch conversion for previous month. Skipped when self_service_conversion_enabled.';

COMMENT ON FUNCTION public.trigger_contribution_monthly_auto_conversion() IS
  'pg_cron/pg_net: POST contribution-monthly-convert when batch automation is enabled and self-service is off.';
