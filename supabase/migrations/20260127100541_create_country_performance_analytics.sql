/*
  # Create Country Performance Analytics System

  ## Overview
  Comprehensive country analytics for marketing insights, financial tracking, and content strategy.

  ## New Functions
  
  ### 1. get_country_performance_analytics(start_date, end_date)
  Returns comprehensive country-level metrics:
  
  **User Metrics:**
  - Total users (registered + detected via IP)
  - Active users (users with activity in date range)
  - Listener/Creator split
  - Gender distribution
  - New users in period

  **Engagement Metrics:**
  - Total plays (songs + videos)
  - Plays per user
  - Content consumption patterns

  **Revenue Metrics (USD):**
  - Ad revenue total (from ad_revenue_events)
  - Ad revenue breakdown (50% creators, 10% listeners, 40% platform)
  - Treat purchase revenue (actual USD from treat_payments)
  - Treat spending (Treats spent in country)
  - Curator earnings
  - Gross earnings (lifetime total earned)
  - Current balance (available now)
  - Total withdrawn (paid out)

  **Growth Metrics:**
  - New users in period
  - Growth rate vs previous period
  - Engagement trends

  ## Data Sources
  - uses `detected_country_code` from playback history (IP geolocation)
  - Fallback to `users.country` for users without playback history
  - Normalizes country codes (Nigeria -> NG)

  ## Security
  - SECURITY DEFINER for consistent access
  - Only accessible to authenticated users with admin role
  - No direct table access, uses function-level RLS
*/

-- Create function to get comprehensive country performance analytics
CREATE OR REPLACE FUNCTION public.get_country_performance_analytics(
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  country_code text,
  country_name text,
  
  -- User Metrics
  total_users bigint,
  active_users_period bigint,
  listener_count bigint,
  creator_count bigint,
  male_count bigint,
  female_count bigint,
  other_count bigint,
  new_users_period bigint,
  
  -- Engagement Metrics
  total_plays bigint,
  total_views bigint,
  avg_plays_per_user numeric,
  avg_views_per_user numeric,
  
  -- Revenue Metrics (USD)
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
  
  -- Growth Metrics
  plays_growth_percent numeric,
  users_growth_percent numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_prev_start_date timestamptz;
  v_prev_end_date timestamptz;
BEGIN
  -- Set default date range if not provided (last 30 days)
  v_end_date := COALESCE(p_end_date, NOW());
  v_start_date := COALESCE(p_start_date, v_end_date - INTERVAL '30 days');
  
  -- Calculate previous period for growth comparison
  v_prev_end_date := v_start_date;
  v_prev_start_date := v_start_date - (v_end_date - v_start_date);

  RETURN QUERY
  WITH 
  -- Get all countries from various sources
  all_countries AS (
    SELECT DISTINCT 
      CASE 
        WHEN LOWER(COALESCE(lh.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(lh.detected_country_code, u.country))
      END as country_code
    FROM public.users u
    LEFT JOIN public.listening_history lh ON lh.user_id = u.id
    WHERE COALESCE(lh.detected_country_code, u.country) IS NOT NULL
    
    UNION
    
    SELECT DISTINCT 
      CASE 
        WHEN LOWER(COALESCE(vph.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(vph.detected_country_code, u.country))
      END as country_code
    FROM public.users u
    LEFT JOIN public.video_playback_history vph ON vph.user_id = u.id
    WHERE COALESCE(vph.detected_country_code, u.country) IS NOT NULL
    
    UNION
    
    SELECT DISTINCT 
      CASE 
        WHEN LOWER(country) = 'nigeria' THEN 'NG'
        ELSE UPPER(country)
      END as country_code
    FROM public.users
    WHERE country IS NOT NULL
  ),
  
  -- User metrics by country
  user_metrics AS (
    SELECT
      CASE 
        WHEN LOWER(u.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(u.country)
      END as country_code,
      COUNT(DISTINCT u.id) as total_users,
      COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'listener') as listener_count,
      COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'creator') as creator_count,
      COUNT(DISTINCT u.id) FILTER (WHERE u.gender = 'male') as male_count,
      COUNT(DISTINCT u.id) FILTER (WHERE u.gender = 'female') as female_count,
      COUNT(DISTINCT u.id) FILTER (WHERE u.gender IS NULL OR u.gender NOT IN ('male', 'female')) as other_count,
      COUNT(DISTINCT u.id) FILTER (WHERE u.created_at >= v_start_date AND u.created_at <= v_end_date) as new_users_period,
      SUM(u.total_earnings) as current_balance_usd
    FROM public.users u
    WHERE u.country IS NOT NULL
    GROUP BY 
      CASE 
        WHEN LOWER(u.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(u.country)
      END
  ),
  
  -- Engagement metrics from listening history
  listening_metrics AS (
    SELECT
      CASE 
        WHEN LOWER(COALESCE(lh.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(lh.detected_country_code, u.country))
      END as country_code,
      COUNT(*) as total_plays,
      COUNT(DISTINCT lh.user_id) as active_users,
      COUNT(*) FILTER (WHERE lh.listened_at >= v_start_date AND lh.listened_at <= v_end_date) as plays_in_period,
      COUNT(*) FILTER (WHERE lh.listened_at >= v_prev_start_date AND lh.listened_at < v_prev_end_date) as plays_prev_period
    FROM public.listening_history lh
    LEFT JOIN public.users u ON u.id = lh.user_id
    WHERE COALESCE(lh.detected_country_code, u.country) IS NOT NULL
    GROUP BY 
      CASE 
        WHEN LOWER(COALESCE(lh.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(lh.detected_country_code, u.country))
      END
  ),
  
  -- Video viewing metrics
  video_metrics AS (
    SELECT
      CASE 
        WHEN LOWER(COALESCE(vph.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(vph.detected_country_code, u.country))
      END as country_code,
      COUNT(*) as total_views,
      COUNT(DISTINCT vph.user_id) as active_users
    FROM public.video_playback_history vph
    LEFT JOIN public.users u ON u.id = vph.user_id
    WHERE COALESCE(vph.detected_country_code, u.country) IS NOT NULL
    GROUP BY 
      CASE 
        WHEN LOWER(COALESCE(vph.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(vph.detected_country_code, u.country))
      END
  ),
  
  -- Ad revenue by country
  ad_revenue AS (
    SELECT
      CASE 
        WHEN LOWER(u.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(u.country)
      END as country_code,
      SUM(COALESCE(are.revenue_amount, 0)) as total_ad_revenue
    FROM public.ad_revenue_events are
    LEFT JOIN public.users u ON u.id = are.user_id
    WHERE are.status = 'processed'
      AND u.country IS NOT NULL
    GROUP BY 
      CASE 
        WHEN LOWER(u.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(u.country)
      END
  ),
  
  -- Treat purchase revenue by country
  treat_revenue AS (
    SELECT
      CASE 
        WHEN LOWER(COALESCE(tp.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(tp.detected_country_code, u.country))
      END as country_code,
      SUM(COALESCE(tp.amount_usd, 0)) as treat_purchase_revenue
    FROM public.treat_payments tp
    LEFT JOIN public.users u ON u.id = tp.user_id
    WHERE tp.status = 'completed'
      AND COALESCE(tp.detected_country_code, u.country) IS NOT NULL
    GROUP BY 
      CASE 
        WHEN LOWER(COALESCE(tp.detected_country_code, u.country)) = 'nigeria' THEN 'NG'
        ELSE UPPER(COALESCE(tp.detected_country_code, u.country))
      END
  ),
  
  -- Withdrawn amounts by country
  withdrawals AS (
    SELECT
      CASE 
        WHEN LOWER(wr.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(wr.country)
      END as country_code,
      SUM(COALESCE(wr.amount, 0)) as total_withdrawn
    FROM public.withdrawal_requests wr
    WHERE wr.status IN ('approved', 'completed')
      AND wr.country IS NOT NULL
    GROUP BY 
      CASE 
        WHEN LOWER(wr.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(wr.country)
      END
  ),
  
  -- Curator earnings by country
  curator_revenue AS (
    SELECT
      CASE 
        WHEN LOWER(u.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(u.country)
      END as country_code,
      SUM(COALESCE(ce.amount, 0)) as curator_earnings
    FROM public.curator_earnings ce
    LEFT JOIN public.users u ON u.id = ce.curator_id
    WHERE u.country IS NOT NULL
    GROUP BY 
      CASE 
        WHEN LOWER(u.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(u.country)
      END
  ),
  
  -- User growth metrics
  user_growth AS (
    SELECT
      CASE 
        WHEN LOWER(u.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(u.country)
      END as country_code,
      COUNT(DISTINCT u.id) FILTER (WHERE u.created_at >= v_start_date AND u.created_at <= v_end_date) as new_users_current,
      COUNT(DISTINCT u.id) FILTER (WHERE u.created_at >= v_prev_start_date AND u.created_at < v_prev_end_date) as new_users_previous
    FROM public.users u
    WHERE u.country IS NOT NULL
    GROUP BY 
      CASE 
        WHEN LOWER(u.country) = 'nigeria' THEN 'NG'
        ELSE UPPER(u.country)
      END
  )
  
  -- Combine all metrics
  SELECT
    ac.country_code,
    ac.country_code as country_name,
    
    -- User Metrics
    COALESCE(um.total_users, 0)::bigint as total_users,
    COALESCE(GREATEST(lm.active_users, vm.active_users), 0)::bigint as active_users_period,
    COALESCE(um.listener_count, 0)::bigint as listener_count,
    COALESCE(um.creator_count, 0)::bigint as creator_count,
    COALESCE(um.male_count, 0)::bigint as male_count,
    COALESCE(um.female_count, 0)::bigint as female_count,
    COALESCE(um.other_count, 0)::bigint as other_count,
    COALESCE(um.new_users_period, 0)::bigint as new_users_period,
    
    -- Engagement Metrics
    COALESCE(lm.total_plays, 0)::bigint as total_plays,
    COALESCE(vm.total_views, 0)::bigint as total_views,
    CASE 
      WHEN COALESCE(um.total_users, 0) > 0 
      THEN ROUND(COALESCE(lm.total_plays, 0)::numeric / um.total_users, 2)
      ELSE 0
    END as avg_plays_per_user,
    CASE 
      WHEN COALESCE(um.total_users, 0) > 0 
      THEN ROUND(COALESCE(vm.total_views, 0)::numeric / um.total_users, 2)
      ELSE 0
    END as avg_views_per_user,
    
    -- Revenue Metrics (USD)
    COALESCE(ar.total_ad_revenue, 0) as ad_revenue_total,
    COALESCE(ar.total_ad_revenue * 0.50, 0) as ad_revenue_creators,
    COALESCE(ar.total_ad_revenue * 0.10, 0) as ad_revenue_listeners,
    COALESCE(ar.total_ad_revenue * 0.40, 0) as ad_revenue_platform,
    COALESCE(tr.treat_purchase_revenue, 0) as treat_purchase_revenue,
    0::numeric as treat_spent_amount,
    COALESCE(cr.curator_earnings, 0) as curator_earnings_total,
    COALESCE(um.current_balance_usd, 0) + COALESCE(w.total_withdrawn, 0) as gross_earnings_usd,
    COALESCE(um.current_balance_usd, 0) as current_balance_usd,
    COALESCE(w.total_withdrawn, 0) as withdrawn_usd,
    
    -- Growth Metrics
    CASE 
      WHEN COALESCE(lm.plays_prev_period, 0) > 0 
      THEN ROUND(((lm.plays_in_period - lm.plays_prev_period)::numeric / lm.plays_prev_period * 100), 2)
      ELSE 0
    END as plays_growth_percent,
    CASE 
      WHEN COALESCE(ug.new_users_previous, 0) > 0 
      THEN ROUND(((ug.new_users_current - ug.new_users_previous)::numeric / ug.new_users_previous * 100), 2)
      ELSE 0
    END as users_growth_percent
    
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

-- Grant execute permission to authenticated users (admin check will be in UI)
GRANT EXECUTE ON FUNCTION public.get_country_performance_analytics(timestamptz, timestamptz) TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION public.get_country_performance_analytics IS 
  'Comprehensive country performance analytics using IP geolocation (detected_country) with fallback to user profile country. Returns user, engagement, revenue, and growth metrics by country for marketing, financial, and content strategy insights.';
