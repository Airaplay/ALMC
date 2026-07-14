/*
  # Automated 30-day Contributor Score clawback for bot-flagged users

  Adds a queue job `bot_contribution_clawback` processed by `process_job_queue_batch`.

  Flow:
  1) Fraud detection flags user in `user_bot_flags`
  2) A job is enqueued (deduped)
  3) Queue worker invalidates last 30 days of `listener_contributions`
     and subtracts points from `listener_contribution_scores`.

  Important:
  - Runs as SECURITY DEFINER, does not require admin auth.uid().
  - Uses existing job_queue infrastructure.
*/

-- 1) Expand job_queue valid_job_type constraint to include bot clawback.
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'job_queue'
    AND c.contype = 'c'
    AND c.conname = 'valid_job_type';

  IF v_constraint_name IS NOT NULL THEN
    ALTER TABLE public.job_queue DROP CONSTRAINT valid_job_type;
  END IF;

  -- Recreate with existing values + new one (idempotent).
  ALTER TABLE public.job_queue
    ADD CONSTRAINT valid_job_type CHECK (job_type IN (
      'ad_revenue_distribution',
      'curator_earnings_distribution',
      'top_listener_ranking_update',
      'early_discovery_tracking',
      'influence_score_update',
      'playlist_fraud_check',
      'daily_mix_generation',
      
      'bot_contribution_clawback'
    ));
EXCEPTION
  WHEN undefined_table THEN
    -- job_queue not present in some environments; skip safely
    NULL;
END $$;

-- 2) Helper: system clawback last 30 days for one user.
CREATE OR REPLACE FUNCTION public.system_clawback_contributions_last_30_days(
  p_user_id uuid,
  p_reason text DEFAULT 'Invalidated due to suspicious/bot-like behavior (30-day clawback)'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_points_to_remove bigint := 0;
  v_invalidated_count int := 0;
  v_prev_total int := 0;
  v_prev_period int := 0;
  v_new_total int := 0;
  v_new_period int := 0;
  v_from timestamptz := now() - interval '30 days';
BEGIN
  -- Ensure score row exists
  INSERT INTO public.listener_contribution_scores (user_id, total_points, current_period_points)
  VALUES (p_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT total_points, current_period_points
  INTO v_prev_total, v_prev_period
  FROM public.listener_contribution_scores
  WHERE user_id = p_user_id;

  -- Lock contributions in window to avoid races with concurrent inserts
  -- (record_listener_contribution will already be gated once flagged)
  SELECT COALESCE(SUM(contribution_points), 0), COUNT(*)
  INTO v_points_to_remove, v_invalidated_count
  FROM public.listener_contributions
  WHERE user_id = p_user_id
    AND is_valid = true
    AND created_at >= v_from
  FOR UPDATE;

  UPDATE public.listener_contributions
  SET
    is_valid = false,
    invalidated_at = now(),
    invalid_reason = p_reason
  WHERE user_id = p_user_id
    AND is_valid = true
    AND created_at >= v_from;

  v_new_total := GREATEST(0, COALESCE(v_prev_total, 0) - v_points_to_remove::int);
  v_new_period := GREATEST(0, COALESCE(v_prev_period, 0) - v_points_to_remove::int);

  UPDATE public.listener_contribution_scores
  SET
    total_points = v_new_total,
    current_period_points = v_new_period,
    updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'from', v_from,
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

GRANT EXECUTE ON FUNCTION public.system_clawback_contributions_last_30_days(uuid, text) TO service_role;

-- 3) Queue handler for the new job type.
CREATE OR REPLACE FUNCTION public.process_bot_contribution_clawback_from_queue(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (p_payload->>'user_id')::uuid;
  v_reason text := COALESCE(p_payload->>'reason', 'Invalidated due to suspicious/bot-like behavior (30-day clawback)');
BEGIN
  PERFORM public.system_clawback_contributions_last_30_days(v_user_id, v_reason);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_bot_contribution_clawback_from_queue(jsonb) TO service_role;

-- 4) Extend process_job_queue_batch to route the new job type.
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
        WHEN 'bot_contribution_clawback' THEN
          PERFORM public.process_bot_contribution_clawback_from_queue(v_job.payload);
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

GRANT EXECUTE ON FUNCTION public.process_job_queue_batch(int, text) TO service_role;

-- 5) Enqueue helper (deduped).
CREATE OR REPLACE FUNCTION public.enqueue_bot_contribution_clawback(
  p_user_id uuid,
  p_reason text DEFAULT 'Invalidated due to suspicious/bot-like behavior (30-day clawback)'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- If job_queue doesn't exist, do nothing.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'job_queue'
  ) THEN
    RETURN;
  END IF;

  -- Dedup: don't enqueue if a pending/retry/processing job exists for this user recently.
  IF EXISTS (
    SELECT 1
    FROM public.job_queue
    WHERE job_type = 'bot_contribution_clawback'
      AND status IN ('pending', 'retry', 'processing')
      AND (payload->>'user_id')::uuid = p_user_id
      AND created_at > now() - interval '24 hours'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.job_queue (job_type, priority, payload, status, scheduled_at)
  VALUES (
    'bot_contribution_clawback',
    100,
    jsonb_build_object('user_id', p_user_id, 'reason', p_reason),
    'pending',
    now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_bot_contribution_clawback(uuid, text) TO authenticated, anon, service_role;

