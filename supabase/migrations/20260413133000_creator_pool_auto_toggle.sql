/*
  Toggle for automatic creator pool lock + distribution.

  Background:
  - `20260409101000_schedule_auto_lock_and_distribute_creator_pool.sql` schedules
    a daily cron job that locks AdMob-synced days and runs creator pool distribution.
  - This migration adds a DB-backed toggle so admins can turn that automation on/off
    from the UI without modifying cron schedules.
*/

-- 1) Settings table (single active row)
CREATE TABLE IF NOT EXISTS public.ad_automation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auto_lock_and_distribute_creator_pool boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_automation_settings_one_active
  ON public.ad_automation_settings(is_active)
  WHERE is_active = true;

ALTER TABLE public.ad_automation_settings ENABLE ROW LEVEL SECURITY;

-- Minimal read access for admins via RPC; lock down table direct access.
REVOKE ALL ON TABLE public.ad_automation_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.ad_automation_settings FROM authenticated;

-- Ensure there is exactly one active row.
INSERT INTO public.ad_automation_settings (auto_lock_and_distribute_creator_pool, is_active)
SELECT true, true
WHERE NOT EXISTS (SELECT 1 FROM public.ad_automation_settings WHERE is_active = true);

-- 2) Admin RPCs (source of truth for UI)
CREATE OR REPLACE FUNCTION public.admin_get_ad_automation_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_row record;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized: admin role required');
  END IF;

  SELECT *
  INTO v_row
  FROM public.ad_automation_settings
  WHERE is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No active ad_automation_settings row');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'auto_lock_and_distribute_creator_pool', v_row.auto_lock_and_distribute_creator_pool,
    'updated_at', v_row.updated_at,
    'updated_by', v_row.updated_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_ad_automation_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_ad_automation_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_auto_lock_and_distribute_creator_pool(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized: admin role required');
  END IF;

  UPDATE public.ad_automation_settings
  SET
    auto_lock_and_distribute_creator_pool = COALESCE(p_enabled, false),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No active ad_automation_settings row');
  END IF;

  RETURN jsonb_build_object('ok', true, 'enabled', COALESCE(p_enabled, false));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_auto_lock_and_distribute_creator_pool(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_auto_lock_and_distribute_creator_pool(boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_set_auto_lock_and_distribute_creator_pool(boolean) IS
  'Admin-only. Enables/disables the daily cron automation that locks AdMob revenue days and distributes the creator pool.';

-- 3) Respect toggle inside the scheduled function
CREATE OR REPLACE FUNCTION public.system_lock_and_distribute_creator_pool()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
  v_row record;
  v_result jsonb;
  v_lock_key bigint;
  v_enabled boolean;
BEGIN
  SELECT COALESCE(auto_lock_and_distribute_creator_pool, true)
  INTO v_enabled
  FROM public.ad_automation_settings
  WHERE is_active = true
  LIMIT 1;

  IF COALESCE(v_enabled, true) = false THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT revenue_date
    FROM public.ad_daily_revenue_input
    WHERE source = 'admob_api'
      AND revenue_date <= (current_date - 1)
      AND COALESCE(is_locked, false) = false
    ORDER BY revenue_date ASC
  LOOP
    -- Advisory lock per date (prevents concurrent double-processing)
    v_lock_key := (extract(epoch from v_row.revenue_date::timestamp)::bigint);
    PERFORM pg_advisory_xact_lock(v_lock_key);

    UPDATE public.ad_daily_revenue_input
    SET is_locked = true,
        locked_at = now(),
        updated_at = now()
    WHERE revenue_date = v_row.revenue_date
      AND source = 'admob_api'
      AND COALESCE(is_locked, false) = false;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_result := public.admin_distribute_creator_pool_for_date(v_row.revenue_date);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

