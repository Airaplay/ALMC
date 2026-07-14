/*
  # Daily Mix Auto-Generation (Queue + Cron)

  Problem:
  - Admin UI toggles `daily_mix_config.auto_generate`, but there was no backend scheduler wired up.
  - "Generate Mixes Now" referenced an Edge Function endpoint that isn't present in this repo.

  Solution:
  - Add a new queue job type `daily_mix_generation` processed by `process_job_queue_batch`.
  - Add RPC `admin_enqueue_daily_mix_generation_now()` used by Admin UI.
  - Add an hourly pg_cron job that, at the configured `refresh_hour` (UTC),
    enqueues generation jobs once per day when `enabled && auto_generate`.

  Notes:
  - We enqueue jobs and let the existing queue processor (already scheduled every minute) execute them in batches.
  - Designed for scale: enqueues only users that currently do not have fresh mixes.
*/

-- pg_cron is typically managed by Supabase; attempting to (re)create it can fail due to internal grants.
-- We only require that the `cron` schema exists.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION WHEN OTHERS THEN
      -- If extension creation fails, surface a clearer error.
      RAISE EXCEPTION 'pg_cron/cron schema not available. Enable pg_cron in Supabase or remove scheduling features. Original error: %', SQLERRM;
    END;
  END IF;
END $$;

-- 0) Ensure daily_mix_config has auto_generate column (UI relies on it)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'daily_mix_config') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'daily_mix_config'
        AND column_name = 'auto_generate'
    ) THEN
      ALTER TABLE public.daily_mix_config
        ADD COLUMN auto_generate boolean DEFAULT false;
    END IF;
  END IF;
END $$;

-- 1) Expand job_queue job_type constraint to include daily mix generation
DO $$
BEGIN
  -- Drop the existing check constraint if it exists (name may vary)
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.job_queue'::regclass
      AND contype = 'c'
      AND conname = 'valid_job_type'
  ) THEN
    ALTER TABLE public.job_queue DROP CONSTRAINT valid_job_type;
  END IF;
EXCEPTION WHEN undefined_table THEN
  -- job_queue not present in this environment (migration order issue)
  NULL;
END $$;

DO $$
BEGIN
  -- Recreate constraint with the new job type
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'job_queue') THEN
    ALTER TABLE public.job_queue
      ADD CONSTRAINT valid_job_type CHECK (job_type IN (
        'ad_revenue_distribution',
        'curator_earnings_distribution',
        'top_listener_ranking_update',
        'early_discovery_tracking',
        'influence_score_update',
        'playlist_fraud_check',
        'daily_mix_generation'
      ));
  END IF;
END $$;

-- 2) Queue worker for daily mix generation
CREATE OR REPLACE FUNCTION public.process_daily_mix_generation_from_queue(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_force boolean := COALESCE((p_payload->>'force_refresh')::boolean, false);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'daily_mix_generation missing user_id';
  END IF;

  -- If not forcing, short-circuit when user already has fresh mixes
  IF NOT v_force AND EXISTS (
    SELECT 1
    FROM public.daily_mix_playlists
    WHERE user_id = v_user_id
      AND expires_at > now()
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  -- Generate mixes (function is SECURITY DEFINER)
  PERFORM public.generate_daily_mixes_for_user(v_user_id, NULL);
END;
$$;

-- 3) Patch job queue processor to recognize the new job type
CREATE OR REPLACE FUNCTION public.process_job_queue_batch(
  p_batch_size int DEFAULT 100,
  p_job_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
  v_jobs_processed int := 0;
  v_jobs_failed int := 0;
BEGIN
  FOR v_job IN
    SELECT * FROM public.job_queue
    WHERE status IN ('pending', 'retry')
      AND scheduled_at <= now()
      AND (p_job_type IS NULL OR job_type = p_job_type)
    ORDER BY priority DESC, scheduled_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      UPDATE public.job_queue
      SET status = 'processing',
          started_at = now(),
          attempts = attempts + 1
      WHERE id = v_job.id;

      CASE v_job.job_type
        WHEN 'ad_revenue_distribution' THEN
          PERFORM public.process_ad_revenue_from_queue(v_job.payload);
        WHEN 'curator_earnings_distribution' THEN
          PERFORM public.process_curator_earnings_from_queue(v_job.payload);
        WHEN 'top_listener_ranking_update' THEN
          PERFORM public.update_listener_rankings_from_queue(v_job.payload);
        WHEN 'early_discovery_tracking' THEN
          PERFORM public.track_early_discovery_from_queue(v_job.payload);
        WHEN 'influence_score_update' THEN
          PERFORM public.update_influence_score_from_queue(v_job.payload);
        WHEN 'playlist_fraud_check' THEN
          PERFORM public.check_playlist_fraud_from_queue(v_job.payload);
        WHEN 'daily_mix_generation' THEN
          PERFORM public.process_daily_mix_generation_from_queue(v_job.payload);
        ELSE
          RAISE EXCEPTION 'Unknown job type: %', v_job.job_type;
      END CASE;

      UPDATE public.job_queue
      SET status = 'completed',
          completed_at = now(),
          error = NULL
      WHERE id = v_job.id;

      v_jobs_processed := v_jobs_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      IF v_job.attempts >= v_job.max_attempts THEN
        UPDATE public.job_queue
        SET status = 'failed',
            completed_at = now(),
            error = SQLERRM
        WHERE id = v_job.id;
      ELSE
        UPDATE public.job_queue
        SET status = 'retry',
            scheduled_at = now() + (interval '1 minute' * v_job.attempts),
            error = SQLERRM
        WHERE id = v_job.id;
      END IF;

      v_jobs_failed := v_jobs_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_jobs_processed,
    'failed', v_jobs_failed,
    'timestamp', now()
  );
END;
$$;

-- 4) State table so hourly cron only enqueues once per day
CREATE TABLE IF NOT EXISTS public.daily_mix_auto_generation_state (
  id boolean PRIMARY KEY DEFAULT true,
  last_enqueued_date date,
  last_enqueued_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- Ensure singleton row exists
INSERT INTO public.daily_mix_auto_generation_state (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.daily_mix_auto_generation_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages daily mix auto state"
  ON public.daily_mix_auto_generation_state
  FOR ALL
  USING (auth.role() = 'service_role');

-- 5) Enqueue generation jobs (used by both cron and manual admin action)
CREATE OR REPLACE FUNCTION public.enqueue_daily_mix_generation_jobs(
  p_force_refresh boolean DEFAULT false,
  p_limit int DEFAULT 2000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
BEGIN
  -- Only enqueue for users who do not have fresh mixes (unless forcing refresh)
  WITH candidates AS (
    SELECT u.id AS user_id
    FROM public.users u
    WHERE (
      p_force_refresh
      OR NOT EXISTS (
        SELECT 1
        FROM public.daily_mix_playlists dmp
        WHERE dmp.user_id = u.id
          AND dmp.expires_at > now()
        LIMIT 1
      )
    )
    ORDER BY u.created_at DESC
    LIMIT GREATEST(p_limit, 0)
  ),
  ins AS (
    INSERT INTO public.job_queue (job_type, priority, payload, status, scheduled_at)
    SELECT
      'daily_mix_generation',
      5,
      jsonb_build_object('user_id', c.user_id, 'force_refresh', p_force_refresh),
      'pending',
      now()
    FROM candidates c
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object('ok', true, 'enqueued_jobs', v_inserted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_daily_mix_generation_jobs(boolean, int) TO service_role;

-- 6) Admin RPC used by the dashboard button
CREATE OR REPLACE FUNCTION public.admin_enqueue_daily_mix_generation_now(
  p_force_refresh boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := false;
  v_result jsonb;
BEGIN
  -- Basic admin gate: allow SQL editor/service calls (auth.uid() IS NULL), or users with admin role.
  IF auth.uid() IS NULL THEN
    v_is_admin := true;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'super_admin', 'account')
    ) INTO v_is_admin;
  END IF;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only admins can enqueue daily mix generation');
  END IF;

  v_result := public.enqueue_daily_mix_generation_jobs(p_force_refresh, 2000);
  RETURN jsonb_build_object(
    'ok', true,
    'enqueued_jobs', COALESCE((v_result->>'enqueued_jobs')::int, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_enqueue_daily_mix_generation_now(boolean) TO authenticated, service_role;

-- 7) Cron hook: hourly, enqueue once per day at refresh_hour UTC when enabled+auto_generate
CREATE OR REPLACE FUNCTION public.maybe_enqueue_daily_mix_auto_generation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg record;
  v_state record;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_hour int := EXTRACT(hour FROM (now() AT TIME ZONE 'UTC'))::int;
  v_should_run boolean := false;
BEGIN
  SELECT * INTO v_cfg FROM public.daily_mix_config LIMIT 1;
  IF v_cfg IS NULL THEN
    RETURN;
  END IF;

  IF NOT COALESCE(v_cfg.enabled, false) THEN
    RETURN;
  END IF;

  IF NOT COALESCE(v_cfg.auto_generate, false) THEN
    RETURN;
  END IF;

  IF v_hour != COALESCE(v_cfg.refresh_hour, 6) THEN
    RETURN;
  END IF;

  SELECT * INTO v_state FROM public.daily_mix_auto_generation_state WHERE id = true;
  IF v_state.last_enqueued_date IS DISTINCT FROM v_today THEN
    v_should_run := true;
  END IF;

  IF NOT v_should_run THEN
    RETURN;
  END IF;

  PERFORM public.enqueue_daily_mix_generation_jobs(false, 5000);

  UPDATE public.daily_mix_auto_generation_state
  SET last_enqueued_date = v_today,
      last_enqueued_at = now(),
      updated_at = now()
  WHERE id = true;

  INSERT INTO public.cron_job_logs (job_name, executed_at, status)
  VALUES ('daily_mix_auto_generation', now(), 'success');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.cron_job_logs (job_name, executed_at, status, error_message)
  VALUES ('daily_mix_auto_generation', now(), 'failed', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.maybe_enqueue_daily_mix_auto_generation() TO service_role;

-- Schedule hourly at minute 5
DO $$
BEGIN
  PERFORM cron.schedule(
    'daily-mix-auto-generation-hourly',
    '5 * * * *',
    'SELECT public.maybe_enqueue_daily_mix_auto_generation();'
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM cron.unschedule('daily-mix-auto-generation-hourly');
  PERFORM cron.schedule(
    'daily-mix-auto-generation-hourly',
    '5 * * * *',
    'SELECT public.maybe_enqueue_daily_mix_auto_generation();'
  );
END $$;

