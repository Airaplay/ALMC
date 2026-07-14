/*
  # Schedule Creator Weekly Reports (Friday–Friday week = 7 calendar days)

  Reporting window: **inclusive Friday through Thursday** (UTC dates), i.e. seven days
  ending on Thursday; the next calendar day is Friday ("Friday to Friday" week boundary).

  Cron: every **Friday 10:15 UTC** queues the week that **just ended** (yesterday = Thursday
  through the prior Friday). Existing `process-email-queue-every-5-minutes` then delivers mail.

  Idempotency: one row per `week_start` in `creator_weekly_report_cron_runs` so a duplicate
  cron tick does not enqueue twice.
*/

CREATE TABLE IF NOT EXISTS public.creator_weekly_report_cron_runs (
  week_start date PRIMARY KEY,
  week_end date NOT NULL,
  queued int NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.creator_weekly_report_cron_runs IS
  'One row per completed Fri–Thu UTC week when creator weekly_report emails were queued by cron.';

REVOKE ALL ON TABLE public.creator_weekly_report_cron_runs FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.system_queue_creator_weekly_reports_friday_week()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_today date := (timezone('UTC', now()))::date;
  v_end date;
  v_start date;
  v_ins int := 0;
  v_result jsonb;
BEGIN
  -- Completed 7-day window ending Thursday UTC; run is on Friday so "yesterday" is Thursday.
  v_end := v_today - 1;
  v_start := v_end - 6;

  IF v_end < v_start THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid week computation');
  END IF;

  INSERT INTO public.creator_weekly_report_cron_runs (week_start, week_end, queued)
  VALUES (v_start, v_end, 0)
  ON CONFLICT (week_start) DO NOTHING;

  GET DIAGNOSTICS v_ins = ROW_COUNT;

  IF v_ins = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'reason', 'already_queued_for_week',
      'week_start', v_start,
      'week_end', v_end
    );
  END IF;

  BEGIN
    v_result := public.admin_queue_weekly_creator_reports(v_start, v_end);

    UPDATE public.creator_weekly_report_cron_runs
    SET queued = COALESCE((v_result->>'queued')::int, 0),
        ran_at = now()
    WHERE week_start = v_start;

    RETURN v_result || jsonb_build_object(
      'cron', true,
      'timezone', 'UTC',
      'week_start', v_start,
      'week_end', v_end
    );
  EXCEPTION
    WHEN OTHERS THEN
      DELETE FROM public.creator_weekly_report_cron_runs WHERE week_start = v_start;
      RAISE;
  END;
END;
$$;

COMMENT ON FUNCTION public.system_queue_creator_weekly_reports_friday_week() IS
  'pg_cron: each Friday UTC, queue weekly_report for prior Fri–Thu (7 inclusive days, UTC).';

REVOKE ALL ON FUNCTION public.system_queue_creator_weekly_reports_friday_week() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.system_queue_creator_weekly_reports_friday_week() TO postgres;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'queue-creator-weekly-reports-friday-utc') THEN
    PERFORM cron.unschedule('queue-creator-weekly-reports-friday-utc');
  END IF;
END $$;

-- Friday 10:15 UTC — after the Thu week boundary; adjust if you prefer a different send window
SELECT cron.schedule(
  'queue-creator-weekly-reports-friday-utc',
  '15 10 * * 5',
  $$ SELECT public.system_queue_creator_weekly_reports_friday_week(); $$
);
