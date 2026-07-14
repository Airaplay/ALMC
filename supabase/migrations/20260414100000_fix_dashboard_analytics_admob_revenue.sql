/*
  # Fix Analytics Overview + Country Performance ad revenue (AdMob)

  Problem:
  - Overview showed `admob_platform_share_usd` (only after completed creator-pool distributions),
    so gross AdMob sync in `ad_daily_revenue_input` appeared as $0.
  - Country performance summed `ad_revenue_events` (per-impression / legacy); pool + API sync
    does not fill that the same way, so country ad revenue stayed empty.

  Changes:
  - `get_country_performance_analytics`: allocate period gross from `ad_daily_revenue_input`
    by country using (song+video engagement in range), with fallback to profile users, then
    legacy `ad_revenue_events` in range when no daily AdMob rows. Split columns use 60% / 0% / 40%
    (creators / listeners / platform) to match `admob_configuration`.
*/

CREATE OR REPLACE FUNCTION public.get_country_performance_analytics(
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  country_code text,
  country_name text,
  total_users bigint,
  active_users_period bigint,
  listener_count bigint,
  creator_count bigint,
  male_count bigint,
  female_count bigint,
  other_count bigint,
  new_users_period bigint,
  total_plays bigint,
  total_views bigint,
  avg_plays_per_user numeric,
  avg_views_per_user numeric,
  ad_revenue_total numeric,
  ad_revenue_creators numeric,
  ad_revenue_listeners numeric,
  ad_revenue_platform numeric,
  treat_purchase_revenue numeric,
  treat_spent_amount numeric,
  curator_earnings_total numeric,
  gross_earnings_usd numeric,
  current_balance_usd numeric,
  withdrawn_usd numeric,
  plays_growth_percent numeric,
  users_growth_percent numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_prev_start_date timestamptz;
  v_prev_end_date timestamptz;
BEGIN
  v_end_date := COALESCE(p_end_date, NOW());
  v_start_date := COALESCE(p_start_date, v_end_date - INTERVAL '30 days');
  v_prev_end_date := v_start_date;
  v_prev_start_date := v_start_date - (v_end_date - v_start_date);

  RETURN QUERY
  WITH
  all_countries AS (
    SELECT DISTINCT
      CASE
        WHEN LOWER(COALESCE(lh.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(lh.detected_country_code, u.country))
      END AS country_code
    FROM public.users u
    LEFT JOIN public.listening_history lh ON lh.user_id = u.id
    WHERE COALESCE(lh.detected_country_code, u.country) IS NOT NULL
    UNION
    SELECT DISTINCT
      CASE
        WHEN LOWER(COALESCE(vph.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(vph.detected_country_code, u.country))
      END
    FROM public.users u
    LEFT JOIN public.video_playback_history vph ON vph.user_id = u.id
    WHERE COALESCE(vph.detected_country_code, u.country) IS NOT NULL
    UNION
    SELECT DISTINCT
      CASE
        WHEN LOWER(country) = 'nigeria' THEN 'NG'
        ELSE UPPER(country)
      END
    FROM public.users
    WHERE country IS NOT NULL
  ),
  user_metrics AS (
    SELECT
      CASE
        WHEN LOWER(u.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(u.country)
      END AS country_code,
      COUNT(DISTINCT u.id) AS total_users,
      COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'listener') AS listener_count,
      COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'creator') AS creator_count,
      COUNT(DISTINCT u.id) FILTER (WHERE u.gender = 'male') AS male_count,
      COUNT(DISTINCT u.id) FILTER (WHERE u.gender = 'female') AS female_count,
      COUNT(DISTINCT u.id) FILTER (WHERE u.gender IS NULL OR u.gender NOT IN ('male', 'female')) AS other_count,
      COUNT(DISTINCT u.id) FILTER (WHERE u.created_at >= v_start_date AND u.created_at <= v_end_date) AS new_users_period,
      SUM(u.total_earnings) AS current_balance_usd
    FROM public.users u
    WHERE u.country IS NOT NULL
    GROUP BY 1
  ),
  listening_metrics AS (
    SELECT
      CASE
        WHEN LOWER(COALESCE(lh.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(lh.detected_country_code, u.country))
      END AS country_code,
      COUNT(*) AS total_plays,
      COUNT(DISTINCT lh.user_id) AS active_users,
      COUNT(*) FILTER (WHERE lh.listened_at >= v_start_date AND lh.listened_at <= v_end_date) AS plays_in_period,
      COUNT(*) FILTER (WHERE lh.listened_at >= v_prev_start_date AND lh.listened_at < v_prev_end_date) AS plays_prev_period
    FROM public.listening_history lh
    LEFT JOIN public.users u ON u.id = lh.user_id
    WHERE COALESCE(lh.detected_country_code, u.country) IS NOT NULL
    GROUP BY 1
  ),
  video_metrics AS (
    SELECT
      CASE
        WHEN LOWER(COALESCE(vph.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(vph.detected_country_code, u.country))
      END AS country_code,
      COUNT(*) AS total_views,
      COUNT(DISTINCT vph.user_id) AS active_users,
      COUNT(*) FILTER (WHERE vph.watched_at >= v_start_date AND vph.watched_at <= v_end_date) AS views_in_period
    FROM public.video_playback_history vph
    LEFT JOIN public.users u ON u.id = vph.user_id
    WHERE COALESCE(vph.detected_country_code, u.country) IS NOT NULL
    GROUP BY 1
  ),
  period_admob_total AS (
    SELECT COALESCE(SUM(total_revenue_usd), 0)::numeric AS total
    FROM public.ad_daily_revenue_input
    WHERE revenue_date >= (v_start_date AT TIME ZONE 'UTC')::date
      AND revenue_date <= (v_end_date AT TIME ZONE 'UTC')::date
  ),
  sum_raw AS (
    SELECT COALESCE(SUM(
      COALESCE(lm.plays_in_period, 0) + COALESCE(vm.views_in_period, 0)
    ), 0)::numeric AS t
    FROM all_countries ac
    LEFT JOIN listening_metrics lm ON lm.country_code = ac.country_code
    LEFT JOIN video_metrics vm ON vm.country_code = ac.country_code
  ),
  sum_users AS (
    SELECT COALESCE(SUM(um.total_users), 0)::numeric AS t
    FROM user_metrics um
  ),
  legacy_ad_revenue AS (
    SELECT
      CASE
        WHEN LOWER(u.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(u.country)
      END AS country_code,
      SUM(COALESCE(are.revenue_amount, 0)) AS total_ad_revenue
    FROM public.ad_revenue_events are
    LEFT JOIN public.users u ON u.id = are.user_id
    WHERE are.status = 'processed'
      AND u.country IS NOT NULL
      AND COALESCE(are.processed_at, are.created_at) >= v_start_date
      AND COALESCE(are.processed_at, are.created_at) <= v_end_date
    GROUP BY 1
  ),
  ad_revenue AS (
    SELECT
      ac.country_code,
      CASE
        WHEN (SELECT total FROM period_admob_total) > 0 AND (SELECT t FROM sum_raw) > 0 THEN
          ROUND(
            (SELECT total FROM period_admob_total)
            * (
              (COALESCE(lm.plays_in_period, 0) + COALESCE(vm.views_in_period, 0))::numeric
              / NULLIF((SELECT t FROM sum_raw), 0)
            ),
            6
          )
        WHEN (SELECT total FROM period_admob_total) > 0 AND (SELECT t FROM sum_raw) = 0
             AND (SELECT t FROM sum_users) > 0 THEN
          ROUND(
            (SELECT total FROM period_admob_total)
            * (COALESCE(um.total_users, 0)::numeric / NULLIF((SELECT t FROM sum_users), 0)),
            6
          )
        WHEN (SELECT total FROM period_admob_total) > 0 THEN
          0::numeric
        ELSE
          COALESCE(leg.total_ad_revenue, 0)
      END AS total_ad_revenue
    FROM all_countries ac
    LEFT JOIN user_metrics um ON um.country_code = ac.country_code
    LEFT JOIN listening_metrics lm ON lm.country_code = ac.country_code
    LEFT JOIN video_metrics vm ON vm.country_code = ac.country_code
    LEFT JOIN legacy_ad_revenue leg ON leg.country_code = ac.country_code
  ),
  treat_revenue AS (
    SELECT
      CASE
        WHEN LOWER(COALESCE(tp.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(tp.detected_country_code, u.country))
      END AS country_code,
      SUM(COALESCE(tp.amount_usd, 0)) AS treat_purchase_revenue
    FROM public.treat_payments tp
    LEFT JOIN public.users u ON u.id = tp.user_id
    WHERE tp.status = 'completed'
      AND COALESCE(tp.detected_country_code, u.country) IS NOT NULL
    GROUP BY 1
  ),
  withdrawals AS (
    SELECT
      CASE
        WHEN LOWER(wr.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(wr.country)
      END AS country_code,
      SUM(COALESCE(wr.amount, 0)) AS total_withdrawn
    FROM public.withdrawal_requests wr
    WHERE wr.status IN ('approved', 'completed')
      AND wr.country IS NOT NULL
    GROUP BY 1
  ),
  curator_revenue AS (
    SELECT
      CASE
        WHEN LOWER(u.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(u.country)
      END AS country_code,
      SUM(COALESCE(ce.amount, 0)) AS curator_earnings
    FROM public.curator_earnings ce
    LEFT JOIN public.users u ON u.id = ce.curator_id
    WHERE u.country IS NOT NULL
    GROUP BY 1
  ),
  user_growth AS (
    SELECT
      CASE
        WHEN LOWER(u.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(u.country)
      END AS country_code,
      COUNT(DISTINCT u.id) FILTER (WHERE u.created_at >= v_start_date AND u.created_at <= v_end_date) AS new_users_current,
      COUNT(DISTINCT u.id) FILTER (WHERE u.created_at >= v_prev_start_date AND u.created_at < v_prev_end_date) AS new_users_previous
    FROM public.users u
    WHERE u.country IS NOT NULL
    GROUP BY 1
  )
  SELECT
    ac.country_code,
    ac.country_code AS country_name,
    COALESCE(um.total_users, 0)::bigint,
    COALESCE(GREATEST(lm.active_users, vm.active_users), 0)::bigint,
    COALESCE(um.listener_count, 0)::bigint,
    COALESCE(um.creator_count, 0)::bigint,
    COALESCE(um.male_count, 0)::bigint,
    COALESCE(um.female_count, 0)::bigint,
    COALESCE(um.other_count, 0)::bigint,
    COALESCE(um.new_users_period, 0)::bigint,
    COALESCE(lm.total_plays, 0)::bigint,
    COALESCE(vm.total_views, 0)::bigint,
    CASE
      WHEN COALESCE(um.total_users, 0) > 0
      THEN ROUND(COALESCE(lm.total_plays, 0)::numeric / um.total_users, 2)
      ELSE 0
    END,
    CASE
      WHEN COALESCE(um.total_users, 0) > 0
      THEN ROUND(COALESCE(vm.total_views, 0)::numeric / um.total_users, 2)
      ELSE 0
    END,
    COALESCE(ar.total_ad_revenue, 0),
    COALESCE(ar.total_ad_revenue * 0.60, 0),
    0::numeric,
    COALESCE(ar.total_ad_revenue * 0.40, 0),
    COALESCE(tr.treat_purchase_revenue, 0),
    0::numeric,
    COALESCE(cr.curator_earnings, 0),
    COALESCE(um.current_balance_usd, 0) + COALESCE(w.total_withdrawn, 0),
    COALESCE(um.current_balance_usd, 0),
    COALESCE(w.total_withdrawn, 0),
    CASE
      WHEN COALESCE(lm.plays_prev_period, 0) > 0
      THEN ROUND(
        ((lm.plays_in_period - lm.plays_prev_period)::numeric / lm.plays_prev_period * 100),
        2
      )
      ELSE 0
    END,
    CASE
      WHEN COALESCE(ug.new_users_previous, 0) > 0
      THEN ROUND(
        (ug.new_users_current - ug.new_users_previous)::numeric / ug.new_users_previous * 100,
        2
      )
      ELSE 0
    END
  FROM all_countries ac
  LEFT JOIN user_metrics um ON um.country_code = ac.country_code
  LEFT JOIN listening_metrics lm ON lm.country_code = ac.country_code
  LEFT JOIN video_metrics vm ON vm.country_code = ac.country_code
  LEFT JOIN ad_revenue ar ON ar.country_code = ac.country_code
  LEFT JOIN treat_revenue tr ON tr.country_code = ac.country_code
  LEFT JOIN withdrawals w ON w.country_code = ac.country_code
  LEFT JOIN curator_revenue cr ON cr.country_code = ac.country_code
  LEFT JOIN user_growth ug ON ug.country_code = ac.country_code
  WHERE ac.country_code IS NOT NULL
    AND ac.country_code != ''
  ORDER BY COALESCE(um.total_users, 0) DESC;
END;
$$;

COMMENT ON FUNCTION public.get_country_performance_analytics(timestamptz, timestamptz) IS
  'Country analytics: AdMob gross for the date range (ad_daily_revenue_input) allocated by in-range plays+views per country, else by registered users, else legacy ad_revenue_events in range. Split 60% creators / 40% platform.';
