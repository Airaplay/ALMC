/*
  # Create admin_get_revenue_summary function

  1. New Function
    - `admin_get_revenue_summary` - Get comprehensive revenue summary for admin dashboard
    - Includes total revenue, artist/listener/platform breakdowns
    - Provides revenue by content type, ad type, and daily trends

  2. Security
    - Function runs with security definer to ensure proper permissions
    - Only accessible to admin users
    - Supports filtering by date range
*/

-- Create function to get revenue summary for admin dashboard
CREATE OR REPLACE FUNCTION admin_get_revenue_summary(
  start_date timestamptz DEFAULT (now() - interval '30 days'),
  end_date timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_revenue numeric;
  revenue_today numeric;
  artist_revenue numeric;
  listener_revenue numeric;
  platform_revenue numeric;
  artist_count integer;
  listener_count integer;
  by_content_type jsonb;
  by_ad_type jsonb;
  daily_revenue jsonb;
  result jsonb;
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  -- Get total revenue
  SELECT COALESCE(SUM(revenue_amount), 0) INTO total_revenue
  FROM ad_revenue_events
  WHERE processed_at BETWEEN start_date AND end_date
    AND status = 'processed';

  -- Get revenue today
  SELECT COALESCE(SUM(revenue_amount), 0) INTO revenue_today
  FROM ad_revenue_events
  WHERE processed_at >= date_trunc('day', now())
    AND status = 'processed';

  -- Get artist revenue
  SELECT COALESCE(SUM(metadata->>'artist_share'), 0)::numeric INTO artist_revenue
  FROM ad_revenue_events
  WHERE processed_at BETWEEN start_date AND end_date
    AND status = 'processed'
    AND metadata->>'artist_share' IS NOT NULL;

  -- Get listener revenue
  SELECT COALESCE(SUM(metadata->>'user_share'), 0)::numeric INTO listener_revenue
  FROM ad_revenue_events
  WHERE processed_at BETWEEN start_date AND end_date
    AND status = 'processed'
    AND metadata->>'user_share' IS NOT NULL;

  -- Get platform revenue
  SELECT COALESCE(SUM(metadata->>'platform_share'), 0)::numeric INTO platform_revenue
  FROM ad_revenue_events
  WHERE processed_at BETWEEN start_date AND end_date
    AND status = 'processed'
    AND metadata->>'platform_share' IS NOT NULL;

  -- Get artist count
  SELECT COUNT(DISTINCT artist_id) INTO artist_count
  FROM ad_revenue_events
  WHERE processed_at BETWEEN start_date AND end_date
    AND status = 'processed'
    AND artist_id IS NOT NULL;

  -- Get listener count
  SELECT COUNT(DISTINCT user_id) INTO listener_count
  FROM ad_revenue_events
  WHERE processed_at BETWEEN start_date AND end_date
    AND status = 'processed'
    AND user_id IS NOT NULL;

  -- Get revenue by content type
  SELECT jsonb_agg(
    jsonb_build_object(
      'content_type', content_type,
      'revenue', revenue
    )
  )
  INTO by_content_type
  FROM (
    SELECT 
      metadata->>'content_type' as content_type,
      SUM(revenue_amount) as revenue
    FROM ad_revenue_events
    WHERE processed_at BETWEEN start_date AND end_date
      AND status = 'processed'
      AND metadata->>'content_type' IS NOT NULL
    GROUP BY metadata->>'content_type'
    ORDER BY revenue DESC
  ) as content_types;

  -- Get revenue by ad type
  SELECT jsonb_agg(
    jsonb_build_object(
      'ad_type', ad_type,
      'revenue', revenue
    )
  )
  INTO by_ad_type
  FROM (
    SELECT 
      metadata->>'ad_type' as ad_type,
      SUM(revenue_amount) as revenue
    FROM ad_revenue_events
    WHERE processed_at BETWEEN start_date AND end_date
      AND status = 'processed'
      AND metadata->>'ad_type' IS NOT NULL
    GROUP BY metadata->>'ad_type'
    ORDER BY revenue DESC
  ) as ad_types;

  -- Get daily revenue
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', date,
      'revenue', revenue
    )
  )
  INTO daily_revenue
  FROM (
    SELECT 
      date_trunc('day', processed_at) as date,
      SUM(revenue_amount) as revenue
    FROM ad_revenue_events
    WHERE processed_at BETWEEN start_date AND end_date
      AND status = 'processed'
    GROUP BY date
    ORDER BY date
  ) as daily;

  -- Calculate platform percentage
  IF total_revenue > 0 THEN
    platform_revenue := COALESCE(platform_revenue, total_revenue - artist_revenue - listener_revenue);
  END IF;

  -- Build result
  result := jsonb_build_object(
    'total_revenue', total_revenue,
    'revenue_today', revenue_today,
    'artist_revenue', artist_revenue,
    'listener_revenue', listener_revenue,
    'platform_revenue', platform_revenue,
    'platform_percentage', CASE 
      WHEN total_revenue > 0 THEN ROUND((platform_revenue / total_revenue) * 100, 2)
      ELSE 0
    END,
    'artist_count', artist_count,
    'listener_count', listener_count,
    'by_content_type', COALESCE(by_content_type, '[]'::jsonb),
    'by_ad_type', COALESCE(by_ad_type, '[]'::jsonb),
    'daily_revenue', COALESCE(daily_revenue, '[]'::jsonb),
    'period', jsonb_build_object(
      'start_date', start_date,
      'end_date', end_date
    )
  );

  RETURN result;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION admin_get_revenue_summary(timestamptz, timestamptz) TO authenticated;