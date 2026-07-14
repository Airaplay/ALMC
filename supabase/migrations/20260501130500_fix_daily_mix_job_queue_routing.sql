/*
  # Fix daily mix queue routing in process_job_queue_batch

  Problem:
  - `daily_mix_generation` jobs are being enqueued, but `process_job_queue_batch`
    does not route that job type in this environment.
  - Result: jobs remain in retry with error `Unknown job type: daily_mix_generation`,
    so users never receive refreshed mixes.

  Fix:
  - Recreate `process_job_queue_batch` and add routing for
    `daily_mix_generation -> process_daily_mix_generation_from_queue(payload)`.
  - Keep existing job routes intact, including `bot_contribution_clawback`.
*/

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
