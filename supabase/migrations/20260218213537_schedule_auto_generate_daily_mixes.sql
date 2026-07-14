/*
  # Schedule Auto Generate Daily Mixes

  ## Summary
  Creates a PostgreSQL function and cron job that automatically triggers the
  generate-daily-mixes edge function every hour, checking whether auto_generate
  is enabled and whether the current UTC hour matches the configured refresh_hour.

  ## How It Works
  1. A cron job runs every hour at minute 0
  2. It calls `trigger_auto_daily_mix_generation()`
  3. That function reads `daily_mix_config` and checks:
     - `enabled = true`
     - `auto_generate = true`
     - `refresh_hour` matches the current UTC hour
  4. If all conditions pass, it fires an HTTP POST to the edge function via pg_net
     using the service role key so no admin session is needed

  ## Security
  - Uses SUPABASE_SERVICE_ROLE_KEY stored in vault for the HTTP call
  - Function runs as SECURITY DEFINER to access vault secrets
  - Only fires when both `enabled` AND `auto_generate` are true
*/

CREATE OR REPLACE FUNCTION trigger_auto_daily_mix_generation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config record;
  v_current_hour int;
  v_service_key text;
  v_supabase_url text;
BEGIN
  SELECT * INTO v_config
  FROM daily_mix_config
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT v_config.enabled OR NOT v_config.auto_generate THEN
    RETURN;
  END IF;

  v_current_hour := EXTRACT(HOUR FROM now() AT TIME ZONE 'UTC')::int;

  IF v_current_hour <> v_config.refresh_hour THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
  LIMIT 1;

  IF v_service_key IS NULL THEN
    v_service_key := current_setting('app.supabase_service_role_key', true);
  END IF;

  v_supabase_url := current_setting('app.supabase_url', true);

  IF v_service_key IS NULL OR v_supabase_url IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/generate-daily-mixes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := '{}'::jsonb
  );

EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto_generate_daily_mixes_hourly') THEN
    PERFORM cron.unschedule('auto_generate_daily_mixes_hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'auto_generate_daily_mixes_hourly',
  '0 * * * *',
  $$SELECT trigger_auto_daily_mix_generation()$$
);
