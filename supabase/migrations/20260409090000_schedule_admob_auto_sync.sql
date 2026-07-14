/*
  # Schedule AdMob auto-sync (pg_cron + pg_net)

  The Admin UI exposes `admob_api_config.auto_sync_enabled`, `sync_frequency_hours`,
  and `next_sync_at`, but without a scheduled job those values don't do anything.

  This migration adds a cron job that periodically triggers the `admob-sync` edge function
  using the Supabase service role key (the same pattern used by the email queue processor).

  Requirements:
  - pg_cron extension enabled (already used elsewhere in this project)
  - pg_net extension enabled (for HTTP calls)
  - `app.supabase_url` and `app.supabase_service_key` settings should be present in the DB
    (or URL will fall back to `https://<db>.supabase.co` like other migrations do)

  Schedule:
  - Runs every 30 minutes
  - For any active config with auto sync enabled + due `next_sync_at`, it calls the edge function.
*/

-- NOTE: `pg_net` is already enabled on Supabase projects (used elsewhere in this repo).
-- Avoid creating extensions inside migrations when possible.

-- Reuse helper (safe if it already exists)
CREATE OR REPLACE FUNCTION get_supabase_url()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  BEGIN
    RETURN current_setting('app.supabase_url', true);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN 'https://' || current_database() || '.supabase.co';
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_admob_auto_sync()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
  v_cfg record;
BEGIN
  FOR v_cfg IN
    SELECT id
    FROM public.admob_api_config
    WHERE is_active = true
      AND auto_sync_enabled = true
      AND (next_sync_at IS NULL OR next_sync_at <= now())
      AND connection_status IN ('connected', 'disconnected', 'error') -- allow retries
  LOOP
    v_count := v_count + 1;

    PERFORM net.http_post(
      url := (SELECT get_supabase_url()) || '/functions/v1/admob-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_key', true)
      ),
      body := jsonb_build_object(
        'config_id', v_cfg.id,
        'sync_type', 'scheduled'
      )
    );
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_admob_auto_sync() TO postgres;

-- Remove existing job if it exists (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admob-auto-sync-every-30-minutes') THEN
    PERFORM cron.unschedule('admob-auto-sync-every-30-minutes');
  END IF;
END $$;

-- Run every 30 minutes
SELECT cron.schedule(
  'admob-auto-sync-every-30-minutes',
  '*/30 * * * *',
  $$ SELECT public.trigger_admob_auto_sync(); $$
);

COMMENT ON FUNCTION public.trigger_admob_auto_sync() IS
'Calls admob-sync edge function for due configs (auto_sync_enabled + next_sync_at<=now). Uses service role via pg_net.';

