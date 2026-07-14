/*
  Contribution reward pool suggestion from platform ad revenue.

  - Adds contribution_conversion_settings.platform_to_pool_percentage (default 15).
  - admin_suggest_contribution_pool_from_platform_revenue(p_period_date): for the
    calendar month containing p_period_date, sums AdMob-synced usable net
    (ad_daily_revenue_input, source = admob_api) and applies the same platform
    residual split as the Ad Revenue dashboard (ad_safety_caps). Returns
    suggested_pool_usd = platform_revenue_usd * (platform_to_pool_percentage / 100).
  - admin_set_platform_to_pool_percentage: admin-only update of that percentage.
*/

ALTER TABLE public.contribution_conversion_settings
  ADD COLUMN IF NOT EXISTS platform_to_pool_percentage numeric(5, 2)
    NOT NULL DEFAULT 15.00
    CHECK (platform_to_pool_percentage >= 0 AND platform_to_pool_percentage <= 100);

COMMENT ON COLUMN public.contribution_conversion_settings.platform_to_pool_percentage IS
  'Percent of platform ad-revenue share (usable net × platform split) allocated to the monthly contribution reward pool suggestion.';

CREATE OR REPLACE FUNCTION public.admin_suggest_contribution_pool_from_platform_revenue(p_period_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_month_start date;
  v_month_end date;
  v_net_sum numeric;
  v_artist_pct numeric;
  v_listener_pct numeric;
  v_platform_usd numeric;
  v_pool_pct numeric;
  v_suggested numeric;
  v_days integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Unauthorized: Admin access required');
  END IF;

  IF p_period_date IS NULL THEN
    RETURN jsonb_build_object('error', 'Conversion period date is required');
  END IF;

  v_month_start := date_trunc('month', p_period_date::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;

  SELECT
    a.artist_revenue_percentage,
    a.listener_revenue_percentage
  INTO v_artist_pct, v_listener_pct
  FROM public.ad_safety_caps a
  WHERE a.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT COALESCE(platform_to_pool_percentage, 15::numeric) INTO v_pool_pct
    FROM public.contribution_conversion_settings
    WHERE is_active = true
    ORDER BY updated_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'period_start', v_month_start,
      'period_end', v_month_end,
      'usable_net_total_usd', 0,
      'platform_revenue_usd', 0,
      'pool_percentage', COALESCE(v_pool_pct, 15),
      'suggested_pool_usd', 0,
      'admob_days_count', 0,
      'caps_missing', true
    );
  END IF;

  v_artist_pct := greatest(0::numeric, least(100::numeric, coalesce(v_artist_pct, 0)));
  v_listener_pct := greatest(0::numeric, least(100::numeric, coalesce(v_listener_pct, 0)));

  SELECT
    COALESCE(SUM(
      COALESCE(i.total_revenue_usd, 0) * (
        GREATEST(0::numeric, LEAST(100::numeric, COALESCE(i.safety_buffer_percentage, 75))) / 100.0
      )
    ), 0)::numeric,
    COUNT(*)::integer
  INTO v_net_sum, v_days
  FROM public.ad_daily_revenue_input i
  WHERE i.source = 'admob_api'
    AND i.revenue_date >= v_month_start
    AND i.revenue_date <= v_month_end;

  -- Residual platform share (matches Ad Revenue dashboard)
  v_platform_usd :=
    v_net_sum
    - (v_net_sum * v_artist_pct / 100.0)
    - (v_net_sum * v_listener_pct / 100.0);

  SELECT COALESCE(cs.platform_to_pool_percentage, 15::numeric) INTO v_pool_pct
  FROM public.contribution_conversion_settings cs
  WHERE cs.is_active = true
  ORDER BY cs.updated_at DESC
  LIMIT 1;

  v_pool_pct := greatest(0::numeric, least(100::numeric, COALESCE(v_pool_pct, 15)));
  v_suggested := round((v_platform_usd * (v_pool_pct / 100.0))::numeric, 2);

  RETURN jsonb_build_object(
    'period_start', v_month_start,
    'period_end', v_month_end,
    'usable_net_total_usd', round(v_net_sum, 2),
    'platform_revenue_usd', round(v_platform_usd, 2),
    'pool_percentage', v_pool_pct,
    'suggested_pool_usd', v_suggested,
    'admob_days_count', v_days,
    'caps_missing', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_suggest_contribution_pool_from_platform_revenue(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_suggest_contribution_pool_from_platform_revenue(date) TO authenticated;

COMMENT ON FUNCTION public.admin_suggest_contribution_pool_from_platform_revenue(date) IS
  'Admin: suggested contribution reward pool = (platform share of AdMob usable net for calendar month) × (platform_to_pool_percentage / 100).';

CREATE OR REPLACE FUNCTION public.admin_set_platform_to_pool_percentage(p_percentage numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  v_admin_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_admin_id AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin access required');
  END IF;

  IF p_percentage IS NULL OR p_percentage < 0 OR p_percentage > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Percentage must be between 0 and 100');
  END IF;

  UPDATE public.contribution_conversion_settings
  SET
    platform_to_pool_percentage = p_percentage,
    last_updated_by = v_admin_id,
    updated_at = now()
  WHERE is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active contribution_conversion_settings row');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_platform_to_pool_percentage(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_platform_to_pool_percentage(numeric) TO authenticated;

COMMENT ON FUNCTION public.admin_set_platform_to_pool_percentage(numeric) IS
  'Admin: set percent of platform ad-revenue share to suggest for the contribution reward pool.';
