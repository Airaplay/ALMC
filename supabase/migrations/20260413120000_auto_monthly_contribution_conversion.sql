/*
  Automated monthly contribution conversion (Execute Conversion).

  - contribution_conversion_settings.auto_execute_monthly_conversion (default false):
    when true, pg_cron + Edge Function runs conversion for the *previous* calendar month.
  - private.compute_contribution_pool_suggestion: shared pool math (AdMob + Ad Safety Caps).
  - admin_suggest_contribution_pool_from_platform_revenue delegates to it (admin-only wrapper).
  - admin_distribute_contribution_rewards: allows service_role (auth.role()) for automation; executed_by NULL.
  - service_run_scheduled_monthly_contribution_conversion: service_role only; idempotent per month.
  - trigger_contribution_monthly_auto_conversion + cron: 1st of month07:00 UTC (skips HTTP if auto off).
*/

-- ---------------------------------------------------------------------------
-- 1) Toggle: must be enabled before cron does anything useful
-- ---------------------------------------------------------------------------
ALTER TABLE public.contribution_conversion_settings
  ADD COLUMN IF NOT EXISTS auto_execute_monthly_conversion boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contribution_conversion_settings.auto_execute_monthly_conversion IS
  'When true, monthly pg_cron invokes contribution-monthly-convert to run conversion for the previous month (pool from platform AdMob share × platform_to_pool_percentage).';

-- ---------------------------------------------------------------------------
-- 2) Shared pool calculation (no direct grants — called only from definer wrappers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.compute_contribution_pool_suggestion(p_period_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_month_start date;
  v_month_end date;
  v_net_sum numeric;
  v_artist_pct numeric;
  v_listener_pct numeric;
  v_platform_usd numeric;
  v_pool_pct numeric;
  v_suggested numeric;
  v_days integer;
BEGIN
  IF p_period_date IS NULL THEN
    RETURN jsonb_build_object('error', 'period_date_required');
  END IF;

  v_month_start := date_trunc('month', p_period_date::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;

  SELECT
    a.artist_revenue_percentage,
    a.listener_revenue_percentage
  INTO v_artist_pct, v_listener_pct
  FROM public.ad_safety_caps a
  WHERE a.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT COALESCE(platform_to_pool_percentage, 15::numeric) INTO v_pool_pct
    FROM public.contribution_conversion_settings
    WHERE is_active = true
    ORDER BY updated_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'period_start', v_month_start,
      'period_end', v_month_end,
      'usable_net_total_usd', 0,
      'platform_revenue_usd', 0,
      'pool_percentage', COALESCE(v_pool_pct, 15),
      'suggested_pool_usd', 0,
      'admob_days_count', 0,
      'caps_missing', true
    );
  END IF;

  v_artist_pct := greatest(0::numeric, least(100::numeric, coalesce(v_artist_pct, 0)));
  v_listener_pct := greatest(0::numeric, least(100::numeric, coalesce(v_listener_pct, 0)));

  SELECT
    COALESCE(SUM(
      COALESCE(i.total_revenue_usd, 0) * (
        GREATEST(0::numeric, LEAST(100::numeric, COALESCE(i.safety_buffer_percentage, 75))) / 100.0
      )
    ), 0)::numeric,
    COUNT(*)::integer
  INTO v_net_sum, v_days
  FROM public.ad_daily_revenue_input i
  WHERE i.source = 'admob_api'
    AND i.revenue_date >= v_month_start
    AND i.revenue_date <= v_month_end;

  v_platform_usd :=
    v_net_sum
    - (v_net_sum * v_artist_pct / 100.0)
    - (v_net_sum * v_listener_pct / 100.0);

  SELECT COALESCE(cs.platform_to_pool_percentage, 15::numeric) INTO v_pool_pct
  FROM public.contribution_conversion_settings cs
  WHERE cs.is_active = true
  ORDER BY cs.updated_at DESC
  LIMIT 1;

  v_pool_pct := greatest(0::numeric, least(100::numeric, COALESCE(v_pool_pct, 15)));
  v_suggested := round((v_platform_usd * (v_pool_pct / 100.0))::numeric, 2);

  RETURN jsonb_build_object(
    'period_start', v_month_start,
    'period_end', v_month_end,
    'usable_net_total_usd', round(v_net_sum, 2),
    'platform_revenue_usd', round(v_platform_usd, 2),
    'pool_percentage', v_pool_pct,
    'suggested_pool_usd', v_suggested,
    'admob_days_count', v_days,
    'caps_missing', false
  );
END;
$$;

REVOKE ALL ON FUNCTION private.compute_contribution_pool_suggestion(date) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3) Admin RPC: delegate to private helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_suggest_contribution_pool_from_platform_revenue(p_period_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Unauthorized: Admin access required');
  END IF;

  IF p_period_date IS NULL THEN
    RETURN jsonb_build_object('error', 'Conversion period date is required');
  END IF;

  RETURN private.compute_contribution_pool_suggestion(p_period_date);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_suggest_contribution_pool_from_platform_revenue(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_suggest_contribution_pool_from_platform_revenue(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Distribution: allow service_role (scheduled) or admin session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_distribute_contribution_rewards(
  p_period_date DATE,
  p_reward_pool_usd NUMERIC
)
RETURNS TABLE (
  success BOOLEAN,
  total_distributed_usd NUMERIC,
  distributed_count INTEGER,
  scaling_applied BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_is_admin BOOLEAN;
  v_total_points BIGINT;
  v_conversion_history_id UUID;
  v_users_rewarded INTEGER := 0;
  v_total_distributed NUMERIC := 0;
  v_conversion_rate NUMERIC;
  v_min_points INTEGER;
  v_scaling_applied BOOLEAN := false;
  v_actual_rate NUMERIC;
BEGIN
  IF auth.role() = 'service_role' THEN
    v_admin_id := NULL;
    v_is_admin := true;
  ELSE
    v_admin_id := auth.uid();

    IF v_admin_id IS NULL THEN
      RAISE EXCEPTION 'Authentication failed: No user session found. Please ensure you are logged in.';
    END IF;

    SELECT (role = 'admin') INTO v_is_admin
    FROM users
    WHERE id = v_admin_id;

    IF NOT COALESCE(v_is_admin, false) THEN
      RAISE EXCEPTION 'Permission denied: Admin role required. Current user is not an admin.';
    END IF;
  END IF;

  IF p_period_date IS NULL THEN
    RAISE EXCEPTION 'Invalid input: Period date cannot be NULL';
  END IF;

  IF p_reward_pool_usd IS NULL OR p_reward_pool_usd <= 0 THEN
    RAISE EXCEPTION 'Invalid input: Reward pool must be greater than 0';
  END IF;

  SELECT
    cs.conversion_rate,
    cs.minimum_points_for_payout
  INTO v_conversion_rate, v_min_points
  FROM contribution_conversion_settings cs
  WHERE cs.is_active = true
  ORDER BY cs.updated_at DESC
  LIMIT 1;

  v_conversion_rate := COALESCE(v_conversion_rate, 0.001);
  v_min_points := COALESCE(v_min_points, 10);

  SELECT COALESCE(SUM(lcs.current_period_points), 0) INTO v_total_points
  FROM listener_contribution_scores lcs
  WHERE lcs.current_period_points >= v_min_points;

  IF v_total_points = 0 THEN
    RETURN QUERY SELECT
      true::BOOLEAN,
      0::NUMERIC,
      0::INTEGER,
      false::BOOLEAN,
      'No eligible users found with minimum points'::TEXT;
    RETURN;
  END IF;

  IF (v_total_points * v_conversion_rate) > p_reward_pool_usd THEN
    v_scaling_applied := true;
    v_actual_rate := p_reward_pool_usd / v_total_points;
  ELSE
    v_actual_rate := v_conversion_rate;
  END IF;

  INSERT INTO contribution_conversion_history (
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
    ROUND((lcs.current_period_points * v_actual_rate)::NUMERIC, 2) AS reward_amount_usd
  FROM listener_contribution_scores lcs
  WHERE lcs.current_period_points >= v_min_points;

  UPDATE users u
  SET
    total_earnings = COALESCE(u.total_earnings, 0) + eu.reward_amount_usd,
    updated_at = NOW()
  FROM earnings_updates eu
  WHERE u.id = eu.user_id;

  SELECT COUNT(*)::INTEGER, COALESCE(SUM(reward_amount_usd), 0)::NUMERIC
  INTO v_users_rewarded, v_total_distributed
  FROM earnings_updates;

  INSERT INTO notifications (
    user_id,
    type,
    category,
    title,
    message,
    metadata,
    is_read
  )
  SELECT
    eu.user_id,
    'reward',
    'contribution_rewards',
    'Contribution Rewards Received',
    'You earned $' || eu.reward_amount_usd::TEXT || ' from your ' || eu.total_points::TEXT || ' contribution points this month!',
    jsonb_build_object(
      'conversion_history_id', v_conversion_history_id,
      'period_date', p_period_date,
      'amount_usd', eu.reward_amount_usd,
      'points_converted', eu.total_points,
      'source', 'contribution_rewards'
    ),
    false
  FROM earnings_updates eu;

  UPDATE listener_contribution_scores lcs
  SET
    current_period_points = 0,
    last_reward_date = p_period_date,
    updated_at = NOW()
  FROM earnings_updates eu
  WHERE lcs.user_id = eu.user_id;

  UPDATE contribution_conversion_history
  SET
    total_users_paid = v_users_rewarded,
    total_distributed_usd = v_total_distributed,
    status = 'completed'
  WHERE id = v_conversion_history_id;

  DROP TABLE earnings_updates;

  RETURN QUERY SELECT
    true::BOOLEAN,
    v_total_distributed,
    v_users_rewarded,
    v_scaling_applied,
    'Conversion completed successfully. Notifications sent to all recipients.'::TEXT;

EXCEPTION
  WHEN OTHERS THEN
    DROP TABLE IF EXISTS earnings_updates;

    IF v_conversion_history_id IS NOT NULL THEN
      UPDATE contribution_conversion_history
      SET status = 'failed', execution_notes = SQLERRM
      WHERE id = v_conversion_history_id;
    END IF;

    RAISE EXCEPTION 'Monthly conversion failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_distribute_contribution_rewards(DATE, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Service-only runner (previous calendar month, idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.service_run_scheduled_monthly_contribution_conversion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
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

REVOKE ALL ON FUNCTION public.service_run_scheduled_monthly_contribution_conversion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.service_run_scheduled_monthly_contribution_conversion() TO service_role;

COMMENT ON FUNCTION public.service_run_scheduled_monthly_contribution_conversion() IS
  'service_role: idempotently run monthly contribution conversion for previous month using platform-based pool (requires auto_execute_monthly_conversion).';

-- ---------------------------------------------------------------------------
-- 6) pg_net trigger (skip HTTP when automation disabled)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_contribution_monthly_auto_conversion()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_token text;
  v_base_url text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.contribution_conversion_settings
    WHERE is_active = true
      AND COALESCE(auto_execute_monthly_conversion, false) = true
  ) THEN
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

COMMENT ON FUNCTION public.trigger_contribution_monthly_auto_conversion() IS
  'pg_cron: POST contribution-monthly-convert when auto_execute_monthly_conversion is enabled.';

-- ---------------------------------------------------------------------------
-- 7) Schedule: 1st of month, 07:00 UTC
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron not available; skip scheduling contribution_monthly_auto_conversion: %', SQLERRM;
      RETURN;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'contribution_monthly_auto_conversion') THEN
    PERFORM cron.unschedule('contribution_monthly_auto_conversion');
  END IF;

  PERFORM cron.schedule(
    'contribution_monthly_auto_conversion',
    '0 7 1 * *',
    $cron$SELECT public.trigger_contribution_monthly_auto_conversion()$cron$
  );
END $$;
