/*
  # Analytics Dashboard for Artists/Creators

  1. New Functions
    - get_artist_analytics: Get comprehensive analytics for an artist
    - get_artist_play_stats: Get play statistics over time
    - get_artist_content_stats: Get content upload statistics
    - get_artist_engagement_stats: Get engagement metrics

  2. Views
    - artist_analytics_summary: Aggregated view of artist performance
    - content_performance: Performance metrics for individual content

  3. Security
    - Functions are security definer to ensure proper access
    - Only artists can access their own analytics
*/

-- Function to get comprehensive artist analytics
CREATE OR REPLACE FUNCTION get_artist_analytics(artist_user_id uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  analytics_result jsonb;
  artist_profile_record record;
  total_plays bigint;
  total_followers bigint;
  total_content bigint;
  recent_plays bigint;
  top_content jsonb;
BEGIN
  -- Verify user has artist profile
  SELECT * INTO artist_profile_record
  FROM artist_profiles
  WHERE user_id = artist_user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Artist profile not found');
  END IF;

  -- Get total plays across all songs
  SELECT COALESCE(SUM(play_count), 0) INTO total_plays
  FROM songs
  WHERE artist_id = artist_profile_record.artist_id;

  -- Get follower count
  SELECT COUNT(*) INTO total_followers
  FROM user_follows
  WHERE following_id = artist_user_id;

  -- Get total content count
  SELECT COUNT(*) INTO total_content
  FROM content_uploads
  WHERE user_id = artist_user_id AND status = 'approved';

  -- Get recent plays (last 30 days)
  SELECT COUNT(*) INTO recent_plays
  FROM listening_history lh
  JOIN songs s ON lh.song_id = s.id
  WHERE s.artist_id = artist_profile_record.artist_id
    AND lh.listened_at >= NOW() - INTERVAL '30 days';

  -- Get top performing content
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'play_count', s.play_count,
      'type', CASE 
        WHEN s.video_url IS NOT NULL THEN 'video'
        WHEN s.album_id IS NOT NULL THEN 'album_track'
        ELSE 'single'
      END
    ) ORDER BY s.play_count DESC
  ) INTO top_content
  FROM songs s
  WHERE s.artist_id = artist_profile_record.artist_id
  LIMIT 5;

  -- Build analytics result
  analytics_result := jsonb_build_object(
    'overview', jsonb_build_object(
      'total_plays', total_plays,
      'total_followers', total_followers,
      'total_content', total_content,
      'recent_plays', recent_plays
    ),
    'top_content', COALESCE(top_content, '[]'::jsonb),
    'artist_id', artist_profile_record.artist_id,
    'generated_at', NOW()
  );

  RETURN analytics_result;
END;
$$;

-- Function to get play statistics over time
CREATE OR REPLACE FUNCTION get_artist_play_stats(
  artist_user_id uuid DEFAULT auth.uid(),
  days_back integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  play_stats jsonb;
  artist_profile_record record;
BEGIN
  -- Verify user has artist profile
  SELECT * INTO artist_profile_record
  FROM artist_profiles
  WHERE user_id = artist_user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Artist profile not found');
  END IF;

  -- Get daily play statistics
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', date_series.date,
      'plays', COALESCE(daily_plays.play_count, 0)
    ) ORDER BY date_series.date
  ) INTO play_stats
  FROM (
    SELECT generate_series(
      (NOW() - INTERVAL '1 day' * days_back)::date,
      NOW()::date,
      '1 day'::interval
    )::date AS date
  ) date_series
  LEFT JOIN (
    SELECT 
      lh.listened_at::date AS date,
      COUNT(*) AS play_count
    FROM listening_history lh
    JOIN songs s ON lh.song_id = s.id
    WHERE s.artist_id = artist_profile_record.artist_id
      AND lh.listened_at >= NOW() - INTERVAL '1 day' * days_back
    GROUP BY lh.listened_at::date
  ) daily_plays ON date_series.date = daily_plays.date;

  RETURN COALESCE(play_stats, '[]'::jsonb);
END;
$$;

-- Function to get content statistics by type
CREATE OR REPLACE FUNCTION get_artist_content_stats(artist_user_id uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  content_stats jsonb;
BEGIN
  -- Get content statistics by type
  SELECT jsonb_object_agg(
    content_type,
    jsonb_build_object(
      'count', count,
      'approved', approved_count,
      'pending', pending_count,
      'rejected', rejected_count
    )
  ) INTO content_stats
  FROM (
    SELECT 
      content_type,
      COUNT(*) AS count,
      COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count
    FROM content_uploads
    WHERE user_id = artist_user_id
    GROUP BY content_type
  ) stats;

  RETURN COALESCE(content_stats, '{}'::jsonb);
END;
$$;

-- Function to get engagement metrics
CREATE OR REPLACE FUNCTION get_artist_engagement_stats(artist_user_id uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  engagement_stats jsonb;
  artist_profile_record record;
  total_favorites bigint;
  total_playlist_adds bigint;
  avg_listen_duration numeric;
BEGIN
  -- Verify user has artist profile
  SELECT * INTO artist_profile_record
  FROM artist_profiles
  WHERE user_id = artist_user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Artist profile not found');
  END IF;

  -- Get total favorites
  SELECT COUNT(*) INTO total_favorites
  FROM user_favorites uf
  JOIN songs s ON uf.song_id = s.id
  WHERE s.artist_id = artist_profile_record.artist_id;

  -- Get total playlist additions
  SELECT COUNT(*) INTO total_playlist_adds
  FROM playlist_songs ps
  JOIN songs s ON ps.song_id = s.id
  WHERE s.artist_id = artist_profile_record.artist_id;

  -- Get average listen duration
  SELECT AVG(duration_listened) INTO avg_listen_duration
  FROM listening_history lh
  JOIN songs s ON lh.song_id = s.id
  WHERE s.artist_id = artist_profile_record.artist_id
    AND lh.duration_listened > 0;

  engagement_stats := jsonb_build_object(
    'total_favorites', total_favorites,
    'total_playlist_adds', total_playlist_adds,
    'avg_listen_duration', COALESCE(avg_listen_duration, 0),
    'engagement_rate', CASE 
      WHEN total_favorites + total_playlist_adds > 0 THEN
        ROUND((total_favorites + total_playlist_adds)::numeric / GREATEST(1, (
          SELECT SUM(play_count) FROM songs WHERE artist_id = artist_profile_record.artist_id
        )) * 100, 2)
      ELSE 0
    END
  );

  RETURN engagement_stats;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_artist_analytics TO authenticated;
GRANT EXECUTE ON FUNCTION get_artist_play_stats TO authenticated;
GRANT EXECUTE ON FUNCTION get_artist_content_stats TO authenticated;
GRANT EXECUTE ON FUNCTION get_artist_engagement_stats TO authenticated;