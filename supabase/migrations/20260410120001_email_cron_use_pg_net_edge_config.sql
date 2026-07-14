/*
  Email queue cron: use private.pg_net_edge_config for service role (same as AdMob)

  The job process-email-queue-every-5-minutes called net.http_post with
  current_setting app.supabase_service_key, which is usually unset on Supabase,
  producing Bearer with an empty token and gateway 401
  Invalid Token or Protected Header formatting.

  This adds a small wrapper that uses private.get_service_role_jwt_for_pg_net()
  and public.get_supabase_url(), plus apikey header for Edge Functions.
*/

CREATE OR REPLACE FUNCTION public.trigger_process_email_queue()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_token text;
  v_id bigint;
BEGIN
  v_token := private.get_service_role_jwt_for_pg_net();

  IF v_token IS NULL OR length(trim(v_token)) < 10 THEN
    RAISE WARNING 'process-email-queue skipped: set private.pg_net_edge_config.service_role_key or app.supabase_service_key';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := public.get_supabase_url() || '/functions/v1/process-email-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token,
      'apikey', v_token
    ),
    body := '{}'::jsonb
  ) INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_process_email_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_process_email_queue() TO postgres;

COMMENT ON FUNCTION public.trigger_process_email_queue() IS
  'pg_net call to process-email-queue Edge Function; auth from app settings or private.pg_net_edge_config.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue-every-5-minutes') THEN
    PERFORM cron.unschedule('process-email-queue-every-5-minutes');
  END IF;
END $$;

SELECT cron.schedule(
  'process-email-queue-every-5-minutes',
  '*/5 * * * *',
  $$ SELECT public.trigger_process_email_queue(); $$
);
