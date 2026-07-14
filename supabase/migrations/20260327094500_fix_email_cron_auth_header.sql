/*
  Fix: process-email-queue pg_cron Authorization header

  Problem:
  The cron job uses pg_net.http_post to call the edge function `process-email-queue`.
  If the Authorization JWT in the header is wrong/empty, the edge function won't be invoked
  and emails will remain queued (not delivered automatically).

  Fix:
  Reschedule the cron job with an Authorization header built from a more likely service-role
  setting name, with fallback to the existing one.
*/

DO $$
DECLARE
  v_token text;
BEGIN
  -- Try common setting names for service-role keys.
  v_token := COALESCE(
    current_setting('app.supabase_service_role_key', true),
    current_setting('app.supabase_service_key', true)
  );

  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE WARNING 'Email cron auth token is missing from app settings; cron delivery may still fail.';
  END IF;

  -- Remove existing cron job (if present)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue-every-5-minutes') THEN
    PERFORM cron.unschedule('process-email-queue-every-5-minutes');
  END IF;

  -- Schedule cron job again; use ignore_scheduled_for=false by default.
  -- We pass a Bearer token for the edge-function invocation.
  PERFORM cron.schedule(
    'process-email-queue-every-5-minutes',
    '*/5 * * * *',
    format(
      $cmd$
      SELECT net.http_post(
        url := (SELECT get_supabase_url()) || '/functions/v1/process-email-queue',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %L'
        ),
        body := '{}'::jsonb
      );
      $cmd$,
      v_token
    )
  );
END $$;

