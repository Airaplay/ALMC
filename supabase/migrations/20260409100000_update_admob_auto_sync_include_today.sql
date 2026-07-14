/*
  # Update AdMob auto-sync to include "today so far"

  The admin dashboard expects AdMob totals to include:
  - Today so far
  - Yesterday
  - This month so far
  - Last month

  Previous scheduled sync defaulted to `date_to = yesterday`, so "today" was often 0.
  This migration updates `public.trigger_admob_auto_sync()` to pass explicit
  `date_from` and `date_to` (today) to the `admob-sync` edge function.
*/

-- NOTE: `pg_net` is already enabled on Supabase projects (used elsewhere in this repo).
-- Avoid creating extensions inside migrations when possible.

CREATE OR REPLACE FUNCTION public.trigger_admob_auto_sync()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
  v_cfg record;
  v_date_from date;
  v_date_to date;
BEGIN
  FOR v_cfg IN
    SELECT id, sync_days_back
    FROM public.admob_api_config
    WHERE is_active = true
      AND auto_sync_enabled = true
      AND (next_sync_at IS NULL OR next_sync_at <= now())
      AND connection_status IN ('connected', 'disconnected', 'error')
  LOOP
    v_count := v_count + 1;
    v_date_to := current_date; -- include today so far
    v_date_from := current_date - GREATEST(COALESCE(v_cfg.sync_days_back, 7), 1);

    PERFORM net.http_post(
      url := (SELECT public.get_supabase_url()) || '/functions/v1/admob-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_key', true)
      ),
      body := jsonb_build_object(
        'config_id', v_cfg.id,
        'sync_type', 'scheduled',
        'date_from', to_char(v_date_from, 'YYYY-MM-DD'),
        'date_to', to_char(v_date_to, 'YYYY-MM-DD')
      )
    );
  END LOOP;

  RETURN v_count;
END;
$$;

