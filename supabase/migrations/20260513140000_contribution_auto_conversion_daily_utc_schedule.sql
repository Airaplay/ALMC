/*
  Contribution auto-conversion schedule (daily / ~24h cadence).

  - Adds UTC clock fields on contribution_conversion_settings so admins pick when
    automation may run (replaces fixed "1st of month 07:00 UTC" pg_cron).
  - Optional auto_conversion_not_before_utc: suppress automation until this instant (UTC).
  - pg_cron runs every minute; trigger_contribution_monthly_auto_conversion only POSTs
    when current UTC time matches the configured hour:minute (at most once per day).

  Keeps column auto_execute_monthly_conversion as the enable flag (name unchanged for compatibility).
*/

ALTER TABLE public.contribution_conversion_settings
  ADD COLUMN IF NOT EXISTS auto_conversion_run_hour_utc integer NOT NULL DEFAULT 7
    CONSTRAINT auto_conversion_run_hour_utc_chk
      CHECK (auto_conversion_run_hour_utc >= 0 AND auto_conversion_run_hour_utc <= 23),
  ADD COLUMN IF NOT EXISTS auto_conversion_run_minute_utc integer NOT NULL DEFAULT 0
    CONSTRAINT auto_conversion_run_minute_utc_chk
      CHECK (auto_conversion_run_minute_utc >= 0 AND auto_conversion_run_minute_utc <= 59),
  ADD COLUMN IF NOT EXISTS auto_conversion_not_before_utc timestamptz NULL;

COMMENT ON COLUMN public.contribution_conversion_settings.auto_conversion_run_hour_utc IS
  'UTC hour (0–23). When auto_execute_monthly_conversion is true, automation may invoke the edge function at this clock time each day (idempotent per calendar month).';

COMMENT ON COLUMN public.contribution_conversion_settings.auto_conversion_run_minute_utc IS
  'UTC minute (0–59), paired with auto_conversion_run_hour_utc.';

COMMENT ON COLUMN public.contribution_conversion_settings.auto_conversion_not_before_utc IS
  'When set, automated conversion requests are skipped until now() >= this timestamp (UTC).';

COMMENT ON COLUMN public.contribution_conversion_settings.auto_execute_monthly_conversion IS
  'When true, scheduled automation may run conversion for the previous calendar month (daily check at auto_conversion_run_*_utc; skips if already completed, pool zero, or caps missing).';

CREATE OR REPLACE FUNCTION public.trigger_contribution_monthly_auto_conversion()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
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

COMMENT ON FUNCTION public.trigger_contribution_monthly_auto_conversion() IS
  'pg_cron: when auto_execute_monthly_conversion is enabled and UTC clock matches settings (and optional not-before passed), POST contribution-monthly-convert.';

-- Reschedule: every minute (function gates to once per day at configured UTC time)
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron not available; skip rescheduling contribution_monthly_auto_conversion: %', SQLERRM;
      RETURN;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'contribution_monthly_auto_conversion') THEN
    PERFORM cron.unschedule('contribution_monthly_auto_conversion');
  END IF;

  PERFORM cron.schedule(
    'contribution_monthly_auto_conversion',
    '* * * * *',
    $cron$SELECT public.trigger_contribution_monthly_auto_conversion()$cron$
  );
END $$;
