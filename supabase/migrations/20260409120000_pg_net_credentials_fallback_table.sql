/*
  # pg_net credentials fallback (Supabase SQL Editor)

  Supabase often returns:
    ERROR: permission denied to set parameter "app.supabase_url"
  for `ALTER DATABASE ... SET app.supabase_*`.

  This migration adds a single-row table `private.pg_net_edge_config` that
  `trigger_admob_auto_sync()` reads when `current_setting('app.supabase_*')` is unset.

  After applying, run once in SQL Editor (replace placeholders):

  INSERT INTO private.pg_net_edge_config (id, supabase_url, service_role_key)
  VALUES (
    1,
    'https://YOUR_PROJECT_REF.supabase.co',
    'YOUR_SERVICE_ROLE_JWT'
  )
  ON CONFLICT (id) DO UPDATE SET
    supabase_url = EXCLUDED.supabase_url,
    service_role_key = EXCLUDED.service_role_key,
    updated_at = now();

  Get values from: Dashboard → Project Settings → API (Project URL + service_role).
*/

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.pg_net_edge_config (
  id int PRIMARY KEY CHECK (id = 1),
  supabase_url text,
  service_role_key text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.pg_net_edge_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.pg_net_edge_config FROM PUBLIC;
GRANT ALL ON TABLE private.pg_net_edge_config TO postgres;

COMMENT ON TABLE private.pg_net_edge_config IS
  'Singleton (id=1) for pg_cron/pg_net edge calls when ALTER DATABASE SET app.* is not permitted.';

CREATE OR REPLACE FUNCTION public.get_supabase_url()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(trim(current_setting('app.supabase_url', true)), ''),
    (SELECT NULLIF(trim(supabase_url), '') FROM private.pg_net_edge_config WHERE id = 1),
    'https://' || current_database() || '.supabase.co'
  );
$$;

CREATE OR REPLACE FUNCTION private.get_service_role_jwt_for_pg_net()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(trim(current_setting('app.supabase_service_key', true)), ''),
    (SELECT NULLIF(trim(service_role_key), '') FROM private.pg_net_edge_config WHERE id = 1)
  );
$$;

REVOKE ALL ON FUNCTION private.get_service_role_jwt_for_pg_net() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.get_service_role_jwt_for_pg_net() TO postgres;

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
        'Authorization', 'Bearer ' || v_token
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

COMMENT ON FUNCTION public.get_supabase_url() IS
  'Base URL for pg_net edge calls: app.supabase_url, then private.pg_net_edge_config, then https://<db>.supabase.co';

COMMENT ON FUNCTION public.trigger_admob_auto_sync() IS
  'Calls admob-sync via pg_net; uses service role from app.supabase_service_key or private.pg_net_edge_config.';
