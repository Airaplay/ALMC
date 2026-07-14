/*
  # Fix admin_get_analytics_dashboard function

  1. Problem
    - The admin_get_analytics_dashboard function has an ambiguous column reference for "created_at"
    - This occurs because the function doesn't properly specify which table the created_at column belongs to
    - The content_stats calculation is missing proper FROM clauses and table references

  2. Solution
    - Drop and recreate the function with explicit table references
    - Add proper FROM clauses to all subqueries
    - Ensure all filters are correctly applied with proper table joins
    - Fix all column references to include table aliases
*/

-- Drop the existing function first to avoid conflicts
DROP FUNCTION IF EXISTS admin_get_analytics_dashboard(timestamptz, timestamptz, text, text);

-- Recreate the function with proper table references
CREATE OR REPLACE FUNCTION admin_get_analytics_dashboard(
  start_date timestamptz DEFAULT (now() - interval '30 days'),
  end_date timestamptz DEFAULT now(),
  role_filter text DEFAULT NULL,
  country_filter text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_stats jsonb;
  content_stats jsonb;
  play_stats jsonb;
  earnings_stats jsonb;
  ad_stats jsonb;
  country_growth jsonb;
  result jsonb;
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  -- Get user statistics
  SELECT jsonb_build_object(
    'total_users', COUNT(*),
    'new_users', COUNT(*) FILTER (WHERE u.created_at BETWEEN start_date AND end_date),
    'active_users', COUNT(*) FILTER (WHERE u.is_active = true),
    'by_role', jsonb_build_object(
      'listeners', COUNT(*) FILTER (WHERE u.role = 'listener'),
      'creators', COUNT(*) FILTER (WHERE u.role = 'creator'),
      'admins', COUNT(*) FILTER (WHERE u.role = 'admin')
    )
  )
  INTO user_stats
  FROM users u
  WHERE (role_filter IS NULL OR u.role = role_filter)
    AND (country_filter IS NULL OR u.country = country_filter);

  -- Get content statistics with proper table references
  SELECT jsonb_build_object(
    'total_content', (
      SELECT COUNT(*) 
      FROM content_uploads cu
      JOIN users u ON cu.user_id = u.id
      WHERE (role_filter IS NULL OR u.role = role_filter)
        AND (country_filter IS NULL OR u.country = country_filter)
    ),
    'new_content', (
      SELECT COUNT(*) 
      FROM content_uploads cu
      JOIN users u ON cu.user_id = u.id
      WHERE cu.created_at BETWEEN start_date AND end_date
        AND (role_filter IS NULL OR u.role = role_filter)
        AND (country_filter IS NULL OR u.country = country_filter)
    ),
    'by_type', jsonb_build_object(
      'songs', (
        SELECT COUNT(*) 
        FROM songs s
        JOIN artists a ON s.artist_id = a.id
        JOIN artist_profiles ap ON a.id = ap.artist_id
        JOIN users u ON ap.user_id = u.id
        WHERE (role_filter IS NULL OR u.role = role_filter)
          AND (country_filter IS NULL OR u.country = country_filter)
      ),
      'albums', (
        SELECT COUNT(*) 
        FROM albums al
        JOIN artists a ON al.artist_id = a.id
        JOIN artist_profiles ap ON a.id = ap.artist_id
        JOIN users u ON ap.user_id = u.id
        WHERE (role_filter IS NULL OR u.role = role_filter)
          AND (country_filter IS NULL OR u.country = country_filter)
      ),
      'videos', (
        SELECT COUNT(*) 
        FROM content_uploads cu
        JOIN users u ON cu.user_id = u.id
        WHERE cu.content_type = 'video'
          AND (role_filter IS NULL OR u.role = role_filter)
          AND (country_filter IS NULL OR u.country = country_filter)
      ),
      'short_clips', (
        SELECT COUNT(*) 
        FROM content_uploads cu
        JOIN users u ON cu.user_id = u.id
        WHERE cu.content_type = 'short_clip'
          AND (role_filter IS NULL OR u.role = role_filter)
          AND (country_filter IS NULL OR u.country = country_filter)
      )
    )
  )
  INTO content_stats;

  -- Get play statistics
  SELECT jsonb_build_object(
    'total_plays', COUNT(*),
    'plays_in_period', COUNT(*) FILTER (WHERE lh.listened_at BETWEEN start_date AND end_date),
    'by_content_type', jsonb_build_object(
      'songs', COUNT(*) FILTER (WHERE lh.song_id IS NOT NULL),
      'videos', COUNT(*) FILTER (WHERE lh.content_upload_id IN (
        SELECT id FROM content_uploads WHERE content_type = 'video'
      )),
      'short_clips', COUNT(*) FILTER (WHERE lh.content_upload_id IN (
        SELECT id FROM content_uploads WHERE content_type = 'short_clip'
      ))
    ),
    'avg_duration', COALESCE(AVG(lh.duration_listened), 0)
  )
  INTO play_stats
  FROM listening_history lh
  LEFT JOIN users u ON lh.user_id = u.id
  WHERE (role_filter IS NULL OR u.role = role_filter)
    AND (country_filter IS NULL OR u.country = country_filter)
    AND lh.listened_at BETWEEN start_date AND end_date;

  -- Get earnings statistics
  SELECT jsonb_build_object(
    'total_earnings', COALESCE(SUM(u.total_earnings), 0),
    'avg_earnings', COALESCE(AVG(u.total_earnings) FILTER (WHERE u.total_earnings > 0), 0),
    'users_with_earnings', COUNT(*) FILTER (WHERE u.total_earnings > 0),
    'by_role', jsonb_build_object(
      'listeners', COALESCE(SUM(u.total_earnings) FILTER (WHERE u.role = 'listener'), 0),
      'creators', COALESCE(SUM(u.total_earnings) FILTER (WHERE u.role = 'creator'), 0)
    ),
    'withdrawals', (
      SELECT jsonb_build_object(
        'total_requested', COALESCE(SUM(wr.amount), 0),
        'total_approved', COALESCE(SUM(wr.amount) FILTER (WHERE wr.status = 'approved'), 0),
        'total_pending', COALESCE(SUM(wr.amount) FILTER (WHERE wr.status = 'pending'), 0),
        'count', COUNT(*),
        'approved_count', COUNT(*) FILTER (WHERE wr.status = 'approved'),
        'pending_count', COUNT(*) FILTER (WHERE wr.status = 'pending')
      )
      FROM withdrawal_requests wr
      JOIN users u ON wr.user_id = u.id
      WHERE (role_filter IS NULL OR u.role = role_filter)
        AND (country_filter IS NULL OR u.country = country_filter)
        AND wr.request_date BETWEEN start_date AND end_date
    )
  )
  INTO earnings_stats
  FROM users u
  WHERE (role_filter IS NULL OR u.role = role_filter)
    AND (country_filter IS NULL OR u.country = country_filter);

  -- Get ad statistics
  SELECT jsonb_build_object(
    'total_impressions', COUNT(*),
    'completed_views', COUNT(*) FILTER (WHERE ai.completed = true),
    'completion_rate', CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((COUNT(*) FILTER (WHERE ai.completed = true)::numeric / COUNT(*)) * 100, 2)
      ELSE 0
    END,
    'avg_duration_viewed', COALESCE(AVG(ai.duration_viewed), 0),
    'by_ad_type', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'ad_type', ad_type,
          'count', COUNT(*),
          'completed', COUNT(*) FILTER (WHERE completed = true)
        )
      )
      FROM (
        SELECT 
          ai2.ad_type,
          ai2.completed
        FROM ad_impressions ai2
        LEFT JOIN users u2 ON ai2.user_id = u2.id
        WHERE (role_filter IS NULL OR u2.role = role_filter)
          AND (country_filter IS NULL OR u2.country = country_filter)
          AND ai2.impression_time BETWEEN start_date AND end_date
        GROUP BY ai2.ad_type, ai2.completed
      ) ad_types
    ),
    'ad_to_stream_ratio', (
      SELECT 
        CASE 
          WHEN COUNT(*) > 0 THEN 
            ROUND((SELECT COUNT(*) FROM ad_impressions ai3
                  LEFT JOIN users u3 ON ai3.user_id = u3.id
                  WHERE (role_filter IS NULL OR u3.role = role_filter)
                    AND (country_filter IS NULL OR u3.country = country_filter)
                    AND ai3.impression_time BETWEEN start_date AND end_date)::numeric / COUNT(*), 4)
          ELSE 0
        END
      FROM listening_history lh
      LEFT JOIN users u4 ON lh.user_id = u4.id
      WHERE (role_filter IS NULL OR u4.role = role_filter)
        AND (country_filter IS NULL OR u4.country = country_filter)
        AND lh.listened_at BETWEEN start_date AND end_date
    )
  )
  INTO ad_stats
  FROM ad_impressions ai
  LEFT JOIN users u ON ai.user_id = u.id
  WHERE (role_filter IS NULL OR u.role = role_filter)
    AND (country_filter IS NULL OR u.country = country_filter)
    AND ai.impression_time BETWEEN start_date AND end_date;

  -- Get country-based user growth
  SELECT jsonb_agg(
    jsonb_build_object(
      'country', COALESCE(u.country, 'Unknown'),
      'total_users', COUNT(*),
      'new_users', COUNT(*) FILTER (WHERE u.created_at BETWEEN start_date AND end_date)
    )
    ORDER BY COUNT(*) DESC
  )
  INTO country_growth
  FROM users u
  WHERE (role_filter IS NULL OR u.role = role_filter)
  GROUP BY u.country
  LIMIT 10;

  -- Build result
  result := jsonb_build_object(
    'user_stats', COALESCE(user_stats, '{}'::jsonb),
    'content_stats', COALESCE(content_stats, '{}'::jsonb),
    'play_stats', COALESCE(play_stats, '{}'::jsonb),
    'earnings_stats', COALESCE(earnings_stats, '{}'::jsonb),
    'ad_stats', COALESCE(ad_stats, '{}'::jsonb),
    'country_growth', COALESCE(country_growth, '[]'::jsonb),
    'period', jsonb_build_object(
      'start_date', start_date,
      'end_date', end_date
    ),
    'filters', jsonb_build_object(
      'role', role_filter,
      'country', country_filter
    )
  );

  RETURN result;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION admin_get_analytics_dashboard(timestamptz, timestamptz, text, text) TO authenticated;