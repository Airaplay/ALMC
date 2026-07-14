/*
  # Create ad_impressions table and analytics functions

  1. New Tables
    - `ad_impressions` - Track ad views and impressions
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `content_id` (uuid, references content_uploads or songs)
      - `content_type` (text, type of content the ad was shown with)
      - `ad_type` (text, type of ad shown)
      - `impression_time` (timestamptz, when the ad was viewed)
      - `duration_viewed` (integer, how long the ad was viewed in seconds)
      - `completed` (boolean, whether the ad was viewed to completion)
      - `created_at` (timestamptz)

  2. New Functions
    - `record_ad_impression` - Record a new ad impression
    - `admin_get_ad_analytics` - Get ad analytics for admin dashboard
    - `admin_get_ad_stream_ratio` - Calculate ratio of ad views to content streams

  3. Security
    - Enable RLS on ad_impressions table
    - Users can only insert their own ad impressions
    - Users can only view their own ad impressions
    - Admins can view all ad impressions
*/

-- Create ad_impressions table
CREATE TABLE IF NOT EXISTS ad_impressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  content_id uuid, -- Can reference either content_uploads.id or songs.id
  content_type text NOT NULL, -- 'song', 'video', 'short_clip', etc.
  ad_type text NOT NULL, -- 'pre-roll', 'mid-roll', 'banner', etc.
  impression_time timestamptz DEFAULT now(),
  duration_viewed integer DEFAULT 0 CHECK (duration_viewed >= 0),
  completed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE ad_impressions ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ad_impressions_user_id ON ad_impressions(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_content_id ON ad_impressions(content_id);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_impression_time ON ad_impressions(impression_time);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_ad_type ON ad_impressions(ad_type);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_content_type ON ad_impressions(content_type);

-- RLS Policies for ad_impressions table
-- Users can insert their own ad impressions
CREATE POLICY "Users can insert own ad impressions"
ON ad_impressions
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Users can view their own ad impressions
CREATE POLICY "Users can view own ad impressions"
ON ad_impressions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Admins can view all ad impressions
CREATE POLICY "Admins can view all ad impressions"
ON ad_impressions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

-- Function to record an ad impression
CREATE OR REPLACE FUNCTION record_ad_impression(
  content_uuid uuid,
  content_type_param text,
  ad_type_param text,
  duration_viewed_param integer DEFAULT 0,
  completed_param boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  result jsonb;
BEGIN
  -- Insert the ad impression
  INSERT INTO ad_impressions (
    user_id,
    content_id,
    content_type,
    ad_type,
    duration_viewed,
    completed
  ) VALUES (
    current_user_id,
    content_uuid,
    content_type_param,
    ad_type_param,
    duration_viewed_param,
    completed_param
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Ad impression recorded successfully'
  );
END;
$$;

-- Function to get ad analytics for admin dashboard
CREATE OR REPLACE FUNCTION admin_get_ad_analytics(
  start_date timestamptz DEFAULT (now() - interval '30 days'),
  end_date timestamptz DEFAULT now(),
  content_type_filter text DEFAULT NULL,
  ad_type_filter text DEFAULT NULL,
  country_filter text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_impressions bigint;
  completed_views bigint;
  completion_rate numeric;
  avg_duration numeric;
  impressions_by_type jsonb;
  impressions_by_content jsonb;
  impressions_by_country jsonb;
  daily_impressions jsonb;
  result jsonb;
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  -- Get total impressions
  SELECT COUNT(*) INTO total_impressions
  FROM ad_impressions ai
  LEFT JOIN users u ON ai.user_id = u.id
  WHERE ai.impression_time BETWEEN start_date AND end_date
    AND (content_type_filter IS NULL OR ai.content_type = content_type_filter)
    AND (ad_type_filter IS NULL OR ai.ad_type = ad_type_filter)
    AND (country_filter IS NULL OR u.country = country_filter);

  -- Get completed views
  SELECT COUNT(*) INTO completed_views
  FROM ad_impressions ai
  LEFT JOIN users u ON ai.user_id = u.id
  WHERE ai.impression_time BETWEEN start_date AND end_date
    AND ai.completed = true
    AND (content_type_filter IS NULL OR ai.content_type = content_type_filter)
    AND (ad_type_filter IS NULL OR ai.ad_type = ad_type_filter)
    AND (country_filter IS NULL OR u.country = country_filter);

  -- Calculate completion rate
  IF total_impressions > 0 THEN
    completion_rate := (completed_views::numeric / total_impressions) * 100;
  ELSE
    completion_rate := 0;
  END IF;

  -- Get average duration viewed
  SELECT COALESCE(AVG(ai.duration_viewed), 0) INTO avg_duration
  FROM ad_impressions ai
  LEFT JOIN users u ON ai.user_id = u.id
  WHERE ai.impression_time BETWEEN start_date AND end_date
    AND (content_type_filter IS NULL OR ai.content_type = content_type_filter)
    AND (ad_type_filter IS NULL OR ai.ad_type = ad_type_filter)
    AND (country_filter IS NULL OR u.country = country_filter);

  -- Get impressions by ad type
  SELECT jsonb_agg(
    jsonb_build_object(
      'ad_type', ad_type,
      'count', count
    )
  )
  INTO impressions_by_type
  FROM (
    SELECT 
      ai.ad_type,
      COUNT(*) as count
    FROM ad_impressions ai
    LEFT JOIN users u ON ai.user_id = u.id
    WHERE ai.impression_time BETWEEN start_date AND end_date
      AND (content_type_filter IS NULL OR ai.content_type = content_type_filter)
      AND (ad_type_filter IS NULL OR ai.ad_type = ad_type_filter)
      AND (country_filter IS NULL OR u.country = country_filter)
    GROUP BY ai.ad_type
    ORDER BY count DESC
  ) as ad_types;

  -- Get impressions by content type
  SELECT jsonb_agg(
    jsonb_build_object(
      'content_type', content_type,
      'count', count
    )
  )
  INTO impressions_by_content
  FROM (
    SELECT 
      ai.content_type,
      COUNT(*) as count
    FROM ad_impressions ai
    LEFT JOIN users u ON ai.user_id = u.id
    WHERE ai.impression_time BETWEEN start_date AND end_date
      AND (content_type_filter IS NULL OR ai.content_type = content_type_filter)
      AND (ad_type_filter IS NULL OR ai.ad_type = ad_type_filter)
      AND (country_filter IS NULL OR u.country = country_filter)
    GROUP BY ai.content_type
    ORDER BY count DESC
  ) as content_types;

  -- Get impressions by country
  SELECT jsonb_agg(
    jsonb_build_object(
      'country', COALESCE(country, 'Unknown'),
      'count', count
    )
  )
  INTO impressions_by_country
  FROM (
    SELECT 
      u.country,
      COUNT(*) as count
    FROM ad_impressions ai
    LEFT JOIN users u ON ai.user_id = u.id
    WHERE ai.impression_time BETWEEN start_date AND end_date
      AND (content_type_filter IS NULL OR ai.content_type = content_type_filter)
      AND (ad_type_filter IS NULL OR ai.ad_type = ad_type_filter)
      AND (country_filter IS NULL OR u.country = country_filter)
    GROUP BY u.country
    ORDER BY count DESC
  ) as countries;

  -- Get daily impressions
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', date,
      'count', count
    )
  )
  INTO daily_impressions
  FROM (
    SELECT 
      date_trunc('day', ai.impression_time) as date,
      COUNT(*) as count
    FROM ad_impressions ai
    LEFT JOIN users u ON ai.user_id = u.id
    WHERE ai.impression_time BETWEEN start_date AND end_date
      AND (content_type_filter IS NULL OR ai.content_type = content_type_filter)
      AND (ad_type_filter IS NULL OR ai.ad_type = ad_type_filter)
      AND (country_filter IS NULL OR u.country = country_filter)
    GROUP BY date
    ORDER BY date
  ) as daily;

  -- Build result
  result := jsonb_build_object(
    'total_impressions', total_impressions,
    'completed_views', completed_views,
    'completion_rate', round(completion_rate, 2),
    'avg_duration_viewed', round(avg_duration, 2),
    'impressions_by_type', COALESCE(impressions_by_type, '[]'::jsonb),
    'impressions_by_content', COALESCE(impressions_by_content, '[]'::jsonb),
    'impressions_by_country', COALESCE(impressions_by_country, '[]'::jsonb),
    'daily_impressions', COALESCE(daily_impressions, '[]'::jsonb),
    'period', jsonb_build_object(
      'start_date', start_date,
      'end_date', end_date
    )
  );

  RETURN result;
END;
$$;

-- Function to calculate ad views to stream ratio
CREATE OR REPLACE FUNCTION admin_get_ad_stream_ratio(
  start_date timestamptz DEFAULT (now() - interval '30 days'),
  end_date timestamptz DEFAULT now(),
  content_type_filter text DEFAULT NULL,
  country_filter text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_ad_impressions bigint;
  total_content_plays bigint;
  ratio numeric;
  daily_ratio jsonb;
  content_type_ratio jsonb;
  country_ratio jsonb;
  result jsonb;
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  -- Get total ad impressions
  SELECT COUNT(*) INTO total_ad_impressions
  FROM ad_impressions ai
  LEFT JOIN users u ON ai.user_id = u.id
  WHERE ai.impression_time BETWEEN start_date AND end_date
    AND (content_type_filter IS NULL OR ai.content_type = content_type_filter)
    AND (country_filter IS NULL OR u.country = country_filter);

  -- Get total content plays (from listening_history)
  SELECT COUNT(*) INTO total_content_plays
  FROM listening_history lh
  LEFT JOIN users u ON lh.user_id = u.id
  WHERE lh.listened_at BETWEEN start_date AND end_date
    AND (content_type_filter IS NULL OR 
         (content_type_filter = 'song' AND lh.song_id IS NOT NULL) OR
         (content_type_filter = 'video' AND lh.content_upload_id IN (
           SELECT id FROM content_uploads WHERE content_type = 'video'
         )) OR
         (content_type_filter = 'short_clip' AND lh.content_upload_id IN (
           SELECT id FROM content_uploads WHERE content_type = 'short_clip'
         )))
    AND (country_filter IS NULL OR u.country = country_filter);

  -- Calculate ratio
  IF total_content_plays > 0 THEN
    ratio := (total_ad_impressions::numeric / total_content_plays);
  ELSE
    ratio := 0;
  END IF;

  -- Get daily ratio
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', date,
      'ad_impressions', ad_count,
      'content_plays', play_count,
      'ratio', CASE WHEN play_count > 0 THEN round((ad_count::numeric / play_count), 4) ELSE 0 END
    )
  )
  INTO daily_ratio
  FROM (
    SELECT 
      date_trunc('day', d) as date,
      COALESCE(a.ad_count, 0) as ad_count,
      COALESCE(p.play_count, 0) as play_count
    FROM 
      generate_series(
        date_trunc('day', start_date),
        date_trunc('day', end_date),
        '1 day'::interval
      ) as d
    LEFT JOIN (
      SELECT 
        date_trunc('day', ai.impression_time) as day,
        COUNT(*) as ad_count
      FROM ad_impressions ai
      LEFT JOIN users u ON ai.user_id = u.id
      WHERE ai.impression_time BETWEEN start_date AND end_date
        AND (content_type_filter IS NULL OR ai.content_type = content_type_filter)
        AND (country_filter IS NULL OR u.country = country_filter)
      GROUP BY day
    ) a ON date_trunc('day', d) = a.day
    LEFT JOIN (
      SELECT 
        date_trunc('day', lh.listened_at) as day,
        COUNT(*) as play_count
      FROM listening_history lh
      LEFT JOIN users u ON lh.user_id = u.id
      WHERE lh.listened_at BETWEEN start_date AND end_date
        AND (content_type_filter IS NULL OR 
             (content_type_filter = 'song' AND lh.song_id IS NOT NULL) OR
             (content_type_filter = 'video' AND lh.content_upload_id IN (
               SELECT id FROM content_uploads WHERE content_type = 'video'
             )) OR
             (content_type_filter = 'short_clip' AND lh.content_upload_id IN (
               SELECT id FROM content_uploads WHERE content_type = 'short_clip'
             )))
        AND (country_filter IS NULL OR u.country = country_filter)
      GROUP BY day
    ) p ON date_trunc('day', d) = p.day
    ORDER BY date
  ) as daily;

  -- Get ratio by content type
  SELECT jsonb_agg(
    jsonb_build_object(
      'content_type', COALESCE(content_type, 'Unknown'),
      'ad_impressions', ad_count,
      'content_plays', play_count,
      'ratio', CASE WHEN play_count > 0 THEN round((ad_count::numeric / play_count), 4) ELSE 0 END
    )
  )
  INTO content_type_ratio
  FROM (
    -- For ad impressions by content type
    WITH ad_counts AS (
      SELECT 
        ai.content_type,
        COUNT(*) as ad_count
      FROM ad_impressions ai
      LEFT JOIN users u ON ai.user_id = u.id
      WHERE ai.impression_time BETWEEN start_date AND end_date
        AND (content_type_filter IS NULL OR ai.content_type = content_type_filter)
        AND (country_filter IS NULL OR u.country = country_filter)
      GROUP BY ai.content_type
    ),
    -- For content plays by type
    play_counts AS (
      SELECT 
        CASE 
          WHEN lh.song_id IS NOT NULL THEN 'song'
          WHEN lh.content_upload_id IS NOT NULL THEN (
            SELECT content_type FROM content_uploads WHERE id = lh.content_upload_id
          )
          ELSE 'unknown'
        END as content_type,
        COUNT(*) as play_count
      FROM listening_history lh
      LEFT JOIN users u ON lh.user_id = u.id
      WHERE lh.listened_at BETWEEN start_date AND end_date
        AND (content_type_filter IS NULL OR 
             (content_type_filter = 'song' AND lh.song_id IS NOT NULL) OR
             (content_type_filter = 'video' AND lh.content_upload_id IN (
               SELECT id FROM content_uploads WHERE content_type = 'video'
             )) OR
             (content_type_filter = 'short_clip' AND lh.content_upload_id IN (
               SELECT id FROM content_uploads WHERE content_type = 'short_clip'
             )))
        AND (country_filter IS NULL OR u.country = country_filter)
      GROUP BY content_type
    )
    -- Join the two to calculate ratios
    SELECT 
      COALESCE(a.content_type, p.content_type) as content_type,
      COALESCE(a.ad_count, 0) as ad_count,
      COALESCE(p.play_count, 0) as play_count
    FROM ad_counts a
    FULL OUTER JOIN play_counts p ON a.content_type = p.content_type
    ORDER BY COALESCE(p.play_count, 0) DESC
  ) as content_types;

  -- Get ratio by country
  SELECT jsonb_agg(
    jsonb_build_object(
      'country', COALESCE(country, 'Unknown'),
      'ad_impressions', ad_count,
      'content_plays', play_count,
      'ratio', CASE WHEN play_count > 0 THEN round((ad_count::numeric / play_count), 4) ELSE 0 END
    )
  )
  INTO country_ratio
  FROM (
    -- For ad impressions by country
    WITH ad_counts AS (
      SELECT 
        u.country,
        COUNT(*) as ad_count
      FROM ad_impressions ai
      LEFT JOIN users u ON ai.user_id = u.id
      WHERE ai.impression_time BETWEEN start_date AND end_date
        AND (content_type_filter IS NULL OR ai.content_type = content_type_filter)
        AND (country_filter IS NULL OR u.country = country_filter)
      GROUP BY u.country
    ),
    -- For content plays by country
    play_counts AS (
      SELECT 
        u.country,
        COUNT(*) as play_count
      FROM listening_history lh
      LEFT JOIN users u ON lh.user_id = u.id
      WHERE lh.listened_at BETWEEN start_date AND end_date
        AND (content_type_filter IS NULL OR 
             (content_type_filter = 'song' AND lh.song_id IS NOT NULL) OR
             (content_type_filter = 'video' AND lh.content_upload_id IN (
               SELECT id FROM content_uploads WHERE content_type = 'video'
             )) OR
             (content_type_filter = 'short_clip' AND lh.content_upload_id IN (
               SELECT id FROM content_uploads WHERE content_type = 'short_clip'
             )))
        AND (country_filter IS NULL OR u.country = country_filter)
      GROUP BY u.country
    )
    -- Join the two to calculate ratios
    SELECT 
      COALESCE(a.country, p.country) as country,
      COALESCE(a.ad_count, 0) as ad_count,
      COALESCE(p.play_count, 0) as play_count
    FROM ad_counts a
    FULL OUTER JOIN play_counts p ON a.country = p.country
    ORDER BY COALESCE(p.play_count, 0) DESC
    LIMIT 10
  ) as countries;

  -- Build result
  result := jsonb_build_object(
    'total_ad_impressions', total_ad_impressions,
    'total_content_plays', total_content_plays,
    'overall_ratio', round(ratio, 4),
    'daily_ratio', COALESCE(daily_ratio, '[]'::jsonb),
    'content_type_ratio', COALESCE(content_type_ratio, '[]'::jsonb),
    'country_ratio', COALESCE(country_ratio, '[]'::jsonb),
    'period', jsonb_build_object(
      'start_date', start_date,
      'end_date', end_date
    )
  );

  RETURN result;
END;
$$;

-- Function to get admin analytics dashboard data
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
    'new_users', COUNT(*) FILTER (WHERE created_at BETWEEN start_date AND end_date),
    'active_users', COUNT(*) FILTER (WHERE is_active = true),
    'by_role', jsonb_build_object(
      'listeners', COUNT(*) FILTER (WHERE role = 'listener'),
      'creators', COUNT(*) FILTER (WHERE role = 'creator'),
      'admins', COUNT(*) FILTER (WHERE role = 'admin')
    )
  )
  INTO user_stats
  FROM users
  WHERE (role_filter IS NULL OR role = role_filter)
    AND (country_filter IS NULL OR country = country_filter);

  -- Get content statistics
  SELECT jsonb_build_object(
    'total_content', COUNT(*),
    'new_content', COUNT(*) FILTER (WHERE created_at BETWEEN start_date AND end_date),
    'by_type', jsonb_build_object(
      'songs', (SELECT COUNT(*) FROM songs WHERE (country_filter IS NULL OR EXISTS (
        SELECT 1 FROM artist_profiles ap 
        JOIN users u ON ap.user_id = u.id 
        WHERE ap.artist_id = songs.artist_id AND (country_filter IS NULL OR u.country = country_filter)
      ))),
      'albums', (SELECT COUNT(*) FROM albums WHERE (country_filter IS NULL OR EXISTS (
        SELECT 1 FROM artist_profiles ap 
        JOIN users u ON ap.user_id = u.id 
        WHERE ap.artist_id = albums.artist_id AND (country_filter IS NULL OR u.country = country_filter)
      ))),
      'videos', (SELECT COUNT(*) FROM content_uploads 
                 WHERE content_type = 'video' 
                 AND (country_filter IS NULL OR EXISTS (
                   SELECT 1 FROM users u WHERE u.id = content_uploads.user_id AND u.country = country_filter
                 ))),
      'short_clips', (SELECT COUNT(*) FROM content_uploads 
                      WHERE content_type = 'short_clip' 
                      AND (country_filter IS NULL OR EXISTS (
                        SELECT 1 FROM users u WHERE u.id = content_uploads.user_id AND u.country = country_filter
                      )))
    )
  )
  INTO content_stats;

  -- Get play statistics
  SELECT jsonb_build_object(
    'total_plays', COUNT(*),
    'plays_in_period', COUNT(*) FILTER (WHERE listened_at BETWEEN start_date AND end_date),
    'by_content_type', jsonb_build_object(
      'songs', COUNT(*) FILTER (WHERE song_id IS NOT NULL),
      'videos', COUNT(*) FILTER (WHERE content_upload_id IN (
        SELECT id FROM content_uploads WHERE content_type = 'video'
      )),
      'short_clips', COUNT(*) FILTER (WHERE content_upload_id IN (
        SELECT id FROM content_uploads WHERE content_type = 'short_clip'
      ))
    ),
    'avg_duration', COALESCE(AVG(duration_listened), 0)
  )
  INTO play_stats
  FROM listening_history lh
  LEFT JOIN users u ON lh.user_id = u.id
  WHERE (role_filter IS NULL OR u.role = role_filter)
    AND (country_filter IS NULL OR u.country = country_filter)
    AND listened_at BETWEEN start_date AND end_date;

  -- Get earnings statistics
  SELECT jsonb_build_object(
    'total_earnings', COALESCE(SUM(total_earnings), 0),
    'avg_earnings', COALESCE(AVG(total_earnings) FILTER (WHERE total_earnings > 0), 0),
    'users_with_earnings', COUNT(*) FILTER (WHERE total_earnings > 0),
    'by_role', jsonb_build_object(
      'listeners', COALESCE(SUM(total_earnings) FILTER (WHERE role = 'listener'), 0),
      'creators', COALESCE(SUM(total_earnings) FILTER (WHERE role = 'creator'), 0)
    ),
    'withdrawals', (
      SELECT jsonb_build_object(
        'total_requested', COALESCE(SUM(amount), 0),
        'total_approved', COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0),
        'total_pending', COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0),
        'count', COUNT(*),
        'approved_count', COUNT(*) FILTER (WHERE status = 'approved'),
        'pending_count', COUNT(*) FILTER (WHERE status = 'pending')
      )
      FROM withdrawal_requests wr
      JOIN users u ON wr.user_id = u.id
      WHERE (role_filter IS NULL OR u.role = role_filter)
        AND (country_filter IS NULL OR u.country = country_filter)
        AND wr.request_date BETWEEN start_date AND end_date
    )
  )
  INTO earnings_stats
  FROM users
  WHERE (role_filter IS NULL OR role = role_filter)
    AND (country_filter IS NULL OR country = country_filter);

  -- Get ad statistics
  SELECT jsonb_build_object(
    'total_impressions', COUNT(*),
    'completed_views', COUNT(*) FILTER (WHERE completed = true),
    'completion_rate', CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((COUNT(*) FILTER (WHERE completed = true)::numeric / COUNT(*)) * 100, 2)
      ELSE 0
    END,
    'avg_duration_viewed', COALESCE(AVG(duration_viewed), 0),
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
          ad_type,
          completed
        FROM ad_impressions ai
        LEFT JOIN users u ON ai.user_id = u.id
        WHERE (role_filter IS NULL OR u.role = role_filter)
          AND (country_filter IS NULL OR u.country = country_filter)
          AND ai.impression_time BETWEEN start_date AND end_date
        GROUP BY ad_type, completed
      ) ad_types
    ),
    'ad_to_stream_ratio', (
      SELECT 
        CASE 
          WHEN COUNT(*) > 0 THEN 
            ROUND((SELECT COUNT(*) FROM ad_impressions ai
                  LEFT JOIN users u ON ai.user_id = u.id
                  WHERE (role_filter IS NULL OR u.role = role_filter)
                    AND (country_filter IS NULL OR u.country = country_filter)
                    AND ai.impression_time BETWEEN start_date AND end_date)::numeric / COUNT(*), 4)
          ELSE 0
        END
      FROM listening_history lh
      LEFT JOIN users u ON lh.user_id = u.id
      WHERE (role_filter IS NULL OR u.role = role_filter)
        AND (country_filter IS NULL OR u.country = country_filter)
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
      'country', COALESCE(country, 'Unknown'),
      'total_users', COUNT(*),
      'new_users', COUNT(*) FILTER (WHERE created_at BETWEEN start_date AND end_date)
    )
    ORDER BY COUNT(*) DESC
  )
  INTO country_growth
  FROM users
  WHERE (role_filter IS NULL OR role = role_filter)
  GROUP BY country
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

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION record_ad_impression(uuid, text, text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_ad_analytics(timestamptz, timestamptz, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_ad_stream_ratio(timestamptz, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_analytics_dashboard(timestamptz, timestamptz, text, text) TO authenticated;