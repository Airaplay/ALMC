/*
  # Fix Analytics Function - Content Likes Column Name

  1. Changes
    - Update get_creator_analytics_optimized() to use correct column name
    - content_id -> content_upload_id in content_likes table query

  2. Purpose
    - Fix "column content_id does not exist" error
    - Use actual column name from content_likes table schema
*/

-- Drop and recreate the function with correct column name
DROP FUNCTION IF EXISTS public.get_creator_analytics_optimized(uuid);

CREATE OR REPLACE FUNCTION public.get_creator_analytics_optimized(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_artist_id uuid;
  v_song_ids uuid[];
  v_content_ids uuid[];
  v_result jsonb;
  v_total_song_plays bigint := 0;
  v_total_content_plays bigint := 0;
  v_unique_listeners bigint := 0;
  v_total_likes bigint := 0;
  v_total_comments bigint := 0;
  v_playlist_adds bigint := 0;
  v_top_content jsonb;
  v_top_locations jsonb;
  v_recent_plays bigint := 0;
  v_previous_plays bigint := 0;
  v_recent_listeners bigint := 0;
  v_previous_listeners bigint := 0;
  v_seven_days_ago timestamp;
  v_fourteen_days_ago timestamp;
BEGIN
  -- Get artist profile
  SELECT artist_id INTO v_artist_id
  FROM public.artist_profiles
  WHERE user_id = p_user_id;

  IF v_artist_id IS NULL THEN
    RAISE EXCEPTION 'User is not a creator';
  END IF;

  -- Get song IDs
  SELECT array_agg(id) INTO v_song_ids
  FROM public.songs
  WHERE artist_id = v_artist_id;

  -- Get content IDs
  SELECT array_agg(id) INTO v_content_ids
  FROM public.content_uploads
  WHERE user_id = p_user_id AND status = 'approved';

  -- Get total plays from songs (from play_count column)
  SELECT COALESCE(SUM(play_count), 0) INTO v_total_song_plays
  FROM public.songs
  WHERE artist_id = v_artist_id;

  -- Get total plays from content (from play_count column)
  SELECT COALESCE(SUM(play_count), 0) INTO v_total_content_plays
  FROM public.content_uploads
  WHERE user_id = p_user_id AND status = 'approved';

  -- Get unique listeners (combine song and video listeners)
  WITH all_listeners AS (
    SELECT DISTINCT user_id
    FROM public.listening_history
    WHERE song_id = ANY(COALESCE(v_song_ids, ARRAY[]::uuid[]))
      AND user_id IS NOT NULL
    UNION
    SELECT DISTINCT user_id
    FROM public.video_playback_history
    WHERE content_id = ANY(COALESCE(v_content_ids, ARRAY[]::uuid[]))
      AND user_id IS NOT NULL
  )
  SELECT COUNT(*) INTO v_unique_listeners FROM all_listeners;

  -- Get total likes (songs from user_favorites + content from content_likes with correct column name)
  SELECT
    COALESCE((SELECT COUNT(*) FROM public.user_favorites WHERE song_id = ANY(COALESCE(v_song_ids, ARRAY[]::uuid[]))), 0) +
    COALESCE((SELECT COUNT(*) FROM public.content_likes WHERE content_upload_id = ANY(COALESCE(v_content_ids, ARRAY[]::uuid[]))), 0)
  INTO v_total_likes;

  -- Get total comments
  SELECT COUNT(*) INTO v_total_comments
  FROM public.content_comments
  WHERE content_id = ANY(COALESCE(ARRAY_CAT(v_song_ids, v_content_ids), ARRAY[]::uuid[]));

  -- Get playlist adds
  SELECT COUNT(*) INTO v_playlist_adds
  FROM public.playlist_songs
  WHERE song_id = ANY(COALESCE(v_song_ids, ARRAY[]::uuid[]));

  -- Get top performing content (top 5 by play count)
  WITH ranked_content AS (
    SELECT
      id,
      title,
      'song' as type,
      play_count,
      cover_url
    FROM public.songs
    WHERE artist_id = v_artist_id
    UNION ALL
    SELECT
      id,
      title,
      CASE
        WHEN content_type = 'short_clip' THEN 'short_clip'
        ELSE 'video'
      END as type,
      play_count,
      thumbnail_url as cover_url
    FROM public.content_uploads
    WHERE user_id = p_user_id AND status = 'approved'
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'title', title,
      'type', type,
      'playCount', play_count,
      'coverUrl', cover_url,
      'growthRate', 0
    ) ORDER BY play_count DESC
  ) INTO v_top_content
  FROM (
    SELECT * FROM ranked_content
    ORDER BY play_count DESC
    LIMIT 5
  ) top_5;

  -- Get top locations (prefer detected_country from playback history, fallback to user profile)
  WITH location_data AS (
    SELECT
      COALESCE(lh.detected_country, u.country) as country,
      lh.user_id
    FROM public.listening_history lh
    LEFT JOIN public.users u ON u.id = lh.user_id
    WHERE lh.song_id = ANY(COALESCE(v_song_ids, ARRAY[]::uuid[]))
      AND (lh.detected_country IS NOT NULL OR u.country IS NOT NULL)
    UNION ALL
    SELECT
      COALESCE(vph.detected_country, u.country) as country,
      vph.user_id
    FROM public.video_playback_history vph
    LEFT JOIN public.users u ON u.id = vph.user_id
    WHERE vph.content_id = ANY(COALESCE(v_content_ids, ARRAY[]::uuid[]))
      AND (vph.detected_country IS NOT NULL OR u.country IS NOT NULL)
  ),
  country_counts AS (
    SELECT
      country,
      COUNT(DISTINCT user_id) as listener_count
    FROM location_data
    WHERE country IS NOT NULL AND country != ''
    GROUP BY country
    ORDER BY listener_count DESC
  ),
  total_with_location AS (
    SELECT SUM(listener_count) as total FROM country_counts
  ),
  top_5 AS (
    SELECT
      country,
      listener_count,
      ROUND((listener_count::numeric / NULLIF((SELECT total FROM total_with_location), 0)) * 100) as percentage
    FROM country_counts
    LIMIT 5
  ),
  others AS (
    SELECT
      'Others' as country,
      SUM(listener_count) as listener_count,
      ROUND((SUM(listener_count)::numeric / NULLIF((SELECT total FROM total_with_location), 0)) * 100) as percentage
    FROM (
      SELECT * FROM country_counts
      OFFSET 5
    ) remaining
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'country', country,
      'count', listener_count,
      'percentage', percentage
    )
  ) INTO v_top_locations
  FROM (
    SELECT * FROM top_5
    UNION ALL
    SELECT * FROM others WHERE listener_count > 0
  ) all_locations;

  -- Calculate date ranges for growth
  v_seven_days_ago := NOW() - INTERVAL '7 days';
  v_fourteen_days_ago := NOW() - INTERVAL '14 days';

  -- Get recent plays (last 7 days)
  SELECT
    COALESCE((SELECT COUNT(*) FROM public.listening_history WHERE song_id = ANY(COALESCE(v_song_ids, ARRAY[]::uuid[])) AND listened_at >= v_seven_days_ago), 0) +
    COALESCE((SELECT COUNT(*) FROM public.video_playback_history WHERE content_id = ANY(COALESCE(v_content_ids, ARRAY[]::uuid[])) AND watched_at >= v_seven_days_ago), 0)
  INTO v_recent_plays;

  -- Get previous plays (7-14 days ago)
  SELECT
    COALESCE((SELECT COUNT(*) FROM public.listening_history WHERE song_id = ANY(COALESCE(v_song_ids, ARRAY[]::uuid[])) AND listened_at >= v_fourteen_days_ago AND listened_at < v_seven_days_ago), 0) +
    COALESCE((SELECT COUNT(*) FROM public.video_playback_history WHERE content_id = ANY(COALESCE(v_content_ids, ARRAY[]::uuid[])) AND watched_at >= v_fourteen_days_ago AND watched_at < v_seven_days_ago), 0)
  INTO v_previous_plays;

  -- Get recent unique listeners (last 7 days)
  WITH recent_listeners AS (
    SELECT DISTINCT user_id FROM public.listening_history
    WHERE song_id = ANY(COALESCE(v_song_ids, ARRAY[]::uuid[]))
      AND listened_at >= v_seven_days_ago
      AND user_id IS NOT NULL
    UNION
    SELECT DISTINCT user_id FROM public.video_playback_history
    WHERE content_id = ANY(COALESCE(v_content_ids, ARRAY[]::uuid[]))
      AND watched_at >= v_seven_days_ago
      AND user_id IS NOT NULL
  )
  SELECT COUNT(*) INTO v_recent_listeners FROM recent_listeners;

  -- Get previous unique listeners (7-14 days ago)
  WITH previous_listeners AS (
    SELECT DISTINCT user_id FROM public.listening_history
    WHERE song_id = ANY(COALESCE(v_song_ids, ARRAY[]::uuid[]))
      AND listened_at >= v_fourteen_days_ago
      AND listened_at < v_seven_days_ago
      AND user_id IS NOT NULL
    UNION
    SELECT DISTINCT user_id FROM public.video_playback_history
    WHERE content_id = ANY(COALESCE(v_content_ids, ARRAY[]::uuid[]))
      AND watched_at >= v_fourteen_days_ago
      AND watched_at < v_seven_days_ago
      AND user_id IS NOT NULL
  )
  SELECT COUNT(*) INTO v_previous_listeners FROM previous_listeners;

  -- Build result
  v_result := jsonb_build_object(
    'totalPlays', v_total_song_plays + v_total_content_plays,
    'uniqueListeners', v_unique_listeners,
    'totalLikes', v_total_likes,
    'totalComments', v_total_comments,
    'totalShares', 0,
    'playlistAdds', v_playlist_adds,
    'topContent', COALESCE(v_top_content, '[]'::jsonb),
    'topLocations', COALESCE(v_top_locations, '[{"country": "No location data available", "count": 0, "percentage": 0}]'::jsonb),
    'recentGrowth', jsonb_build_object(
      'playsGrowth', CASE WHEN v_previous_plays > 0
        THEN ROUND((v_recent_plays - v_previous_plays)::numeric / v_previous_plays * 100)
        ELSE 0
      END,
      'listenersGrowth', CASE WHEN v_previous_listeners > 0
        THEN ROUND((v_recent_listeners - v_previous_listeners)::numeric / v_previous_listeners * 100)
        ELSE 0
      END,
      'period', 'week'
    )
  );

  RETURN v_result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_creator_analytics_optimized(uuid) TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION public.get_creator_analytics_optimized IS
  'Optimized analytics function using correct column names: content_upload_id in content_likes table.';
