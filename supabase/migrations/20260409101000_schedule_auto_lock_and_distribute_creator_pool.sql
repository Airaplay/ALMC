/*
  # Auto lock AdMob daily revenue and distribute creator pool (idempotent)

  Goal:
  - For each completed day (<= yesterday) with AdMob-synced revenue, automatically:
    1) lock the `ad_daily_revenue_input` row
    2) run `admin_distribute_creator_pool_for_date(date)`

  Safety:
  - Only runs for `source = 'admob_api'`
  - Only locks rows that are not already locked
  - Distribution function is idempotent via `ad_creator_pool_distributions(revenue_date)`
  - Uses a per-date advisory lock to avoid concurrent runs
*/

-- NOTE: `pg_cron` is already enabled on Supabase projects.
-- Avoid `CREATE EXTENSION pg_cron` here because it can trigger privilege rewrite scripts that fail
-- when dependent grants exist. If `cron.*` objects are missing, enable `pg_cron` from the Supabase dashboard.

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
BEGIN
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

    -- If it was already locked by another process, skip
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_result := public.admin_distribute_creator_pool_for_date(v_row.revenue_date);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.system_lock_and_distribute_creator_pool() TO postgres;

-- Replace job (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lock-and-distribute-creator-pool-daily') THEN
    PERFORM cron.unschedule('lock-and-distribute-creator-pool-daily');
  END IF;
END $$;

-- Run daily at 04:15 UTC (after typical AdMob sync window)
SELECT cron.schedule(
  'lock-and-distribute-creator-pool-daily',
  '15 4 * * *',
  $$ SELECT public.system_lock_and_distribute_creator_pool(); $$
);

