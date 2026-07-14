/*
  # pg_net: add apikey header for admob-sync

  Supabase API gateway often expects both Authorization Bearer and apikey
  for Edge Function routes under /functions/v1/. Missing apikey can yield 401 with
  "Invalid Token or Protected Header formatting" before the Edge Function runs.

  Re-applies public.trigger_admob_auto_sync() with the extra header.
*/

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
  v_base_url text;
  v_token text;
BEGIN
  v_base_url := public.get_supabase_url();
  v_token := private.get_service_role_jwt_for_pg_net();

  IF NOT EXISTS (
    SELECT 1
    FROM public.admob_api_config
    WHERE is_active = true
      AND auto_sync_enabled = true
      AND (next_sync_at IS NULL OR next_sync_at <= now())
      AND connection_status IN ('connected', 'disconnected', 'error')
  ) THEN
    RETURN 0;
  END IF;

  IF v_token IS NULL OR length(v_token) < 10 THEN
    RAISE WARNING 'pg_net AdMob sync skipped: set app.supabase_service_key or private.pg_net_edge_config.service_role_key';
    RETURN 0;
  END IF;

  FOR v_cfg IN
    SELECT id, sync_days_back
    FROM public.admob_api_config
    WHERE is_active = true
      AND auto_sync_enabled = true
      AND (next_sync_at IS NULL OR next_sync_at <= now())
      AND connection_status IN ('connected', 'disconnected', 'error')
  LOOP
    v_count := v_count + 1;
    v_date_to := current_date;
    v_date_from := current_date - GREATEST(COALESCE(v_cfg.sync_days_back, 7), 1);

    PERFORM net.http_post(
      url := v_base_url || '/functions/v1/admob-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_token,
        'apikey', v_token
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
