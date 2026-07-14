/*
  Ensure full financial reset also refreshes Financial Monitoring snapshot values.
  Uses a wrapper to avoid touching the existing reset implementation.
*/

CREATE OR REPLACE FUNCTION public.admin_reset_all_financial_data_v2(
  p_confirm text,
  p_include_ad_impressions boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.admin_reset_all_financial_data(p_confirm, p_include_ad_impressions);

  -- If reset succeeded, force Financial Monitoring to show current state.
  IF COALESCE((v_result->>'ok')::boolean, false) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'daily_financial_snapshots'
    ) THEN
      DELETE FROM public.daily_financial_snapshots;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'generate_daily_financial_snapshot'
    ) THEN
      PERFORM public.generate_daily_financial_snapshot();
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_all_financial_data_v2(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_financial_data_v2(text, boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_reset_all_financial_data_v2(text, boolean) IS
  'Admin-only wrapper reset. Runs admin_reset_all_financial_data then refreshes daily financial snapshot data.';

