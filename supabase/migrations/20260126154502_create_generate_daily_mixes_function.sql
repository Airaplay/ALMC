/*
  # Daily Mix Generation Function

  1. Creates database function to generate daily mixes for a user
     - Analyzes user listening history
     - Generates personalized recommendations
     - Creates mix playlists with tracks

  2. Purpose
     - Enables edge function to trigger mix generation
     - Centralizes complex logic in database
     - Ensures consistent mix quality
*/

-- Function to generate daily mixes for a single user
CREATE OR REPLACE FUNCTION generate_daily_mixes_for_user(
  p_user_id uuid,
  p_config jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config record;
  v_user_profile jsonb;
  v_mix_count integer := 0;
  v_result jsonb;
BEGIN
  -- Get configuration
  IF p_config IS NULL THEN
    SELECT * INTO v_config FROM daily_mix_config LIMIT 1;
  ELSE
    v_config := jsonb_populate_record(NULL::daily_mix_config, p_config);
  END IF;

  -- Check if system is enabled
  IF NOT v_config.enabled THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Daily mix system is disabled'
    );
  END IF;

  -- Check if user already has fresh mixes
  IF EXISTS (
    SELECT 1 FROM daily_mix_playlists
    WHERE user_id = p_user_id
    AND expires_at > now()
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'User already has fresh mixes',
      'mixes_created', 0
    );
  END IF;

  -- Check if user has sufficient listening history
  IF (SELECT COUNT(*) FROM playback_history
      WHERE user_id = p_user_id
      AND listened_at > now() - interval '90 days'
      AND duration_seconds >= v_config.min_play_duration_seconds) < 20 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient listening history'
    );
  END IF;

  -- Delete old mixes for this user
  DELETE FROM daily_mix_playlists
  WHERE user_id = p_user_id
  AND expires_at < now();

  -- Build user profile (simplified version)
  -- Get top genres from listening history
  WITH user_genres AS (
    SELECT
      sg.genre_id,
      g.name as genre_name,
      COUNT(*) as play_count,
      AVG(ph.duration_seconds::float / NULLIF(s.duration, 0)) as avg_completion
    FROM playback_history ph
    JOIN songs s ON s.id = ph.song_id
    JOIN song_genres sg ON sg.song_id = s.id
    JOIN genres g ON g.id = sg.genre_id
    WHERE ph.user_id = p_user_id
    AND ph.listened_at > now() - interval '90 days'
    AND ph.duration_seconds >= v_config.min_play_duration_seconds
    GROUP BY sg.genre_id, g.name
    ORDER BY play_count DESC, avg_completion DESC
    LIMIT 5
  ),
  user_moods AS (
    SELECT
      sm.mood_id,
      m.name as mood_name,
      COUNT(*) as play_count
    FROM playback_history ph
    JOIN songs s ON s.id = ph.song_id
    JOIN song_moods sm ON sm.song_id = s.id
    JOIN moods m ON m.id = sm.mood_id
    WHERE ph.user_id = p_user_id
    AND ph.listened_at > now() - interval '90 days'
    AND ph.duration_seconds >= v_config.min_play_duration_seconds
    GROUP BY sm.mood_id, m.name
    ORDER BY play_count DESC
    LIMIT 5
  ),
  -- Generate recommendations based on user preferences
  recommended_songs AS (
    SELECT DISTINCT
      s.id as song_id,
      s.title,
      s.artist_id,
      u.username as artist_name,
      s.cover_image_url,
      s.audio_url,
      s.duration,
      (
        -- Content-based score: matches user's top genres
        (SELECT COUNT(*) * 0.4 FROM song_genres sg
         WHERE sg.song_id = s.id
         AND sg.genre_id IN (SELECT genre_id FROM user_genres)) +
        -- Content-based score: matches user's top moods
        (SELECT COUNT(*) * 0.3 FROM song_moods sm
         WHERE sm.song_id = s.id
         AND sm.mood_id IN (SELECT mood_id FROM user_moods)) +
        -- Trending score: global popularity
        (s.play_count::float / GREATEST(EXTRACT(EPOCH FROM (now() - s.created_at)) / 86400, 1)) * 0.2 +
        -- Diversity bonus: penalize if user already listened
        CASE WHEN EXISTS (
          SELECT 1 FROM playback_history
          WHERE user_id = p_user_id AND song_id = s.id
        ) THEN -0.3 ELSE 0.2 END
      ) as recommendation_score,
      CASE WHEN EXISTS (
        SELECT 1 FROM playback_history
        WHERE user_id = p_user_id AND song_id = s.id
      ) THEN true ELSE false END as is_familiar,
      (SELECT genre_name FROM user_genres LIMIT 1) as match_genre,
      (SELECT mood_name FROM user_moods LIMIT 1) as match_mood
    FROM songs s
    JOIN users u ON u.id = s.artist_id
    WHERE s.is_public = true
    AND s.audio_url IS NOT NULL
    AND s.artist_id != p_user_id -- Don't recommend own songs
    AND (
      -- Has matching genres
      EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id AND sg.genre_id IN (SELECT genre_id FROM user_genres))
      OR
      -- Has matching moods
      EXISTS (SELECT 1 FROM song_moods sm WHERE sm.song_id = s.id AND sm.mood_id IN (SELECT user_id FROM user_moods))
      OR
      -- Is trending
      s.play_count > 100
    )
    ORDER BY recommendation_score DESC
    LIMIT 200
  )
  -- Create mixes
  INSERT INTO daily_mix_playlists (user_id, mix_number, title, description, genre_focus, mood_focus, track_count)
  SELECT
    p_user_id,
    series.num as mix_number,
    'Daily Mix ' || series.num,
    CASE
      WHEN series.num = 1 THEN 'Based on your recent favorites'
      WHEN series.num = 2 THEN 'Discover new music you''ll love'
      WHEN series.num = 3 THEN 'Trending tracks for you'
      ELSE 'Personalized for you'
    END as description,
    (SELECT genre_name FROM user_genres OFFSET (series.num - 1) LIMIT 1) as genre_focus,
    (SELECT mood_name FROM user_moods OFFSET (series.num - 1) LIMIT 1) as mood_focus,
    v_config.tracks_per_mix
  FROM generate_series(1, v_config.mixes_per_user) series(num)
  RETURNING id, mix_number INTO v_mix_count;

  -- Add tracks to each mix
  WITH playlist_ids AS (
    SELECT id, mix_number
    FROM daily_mix_playlists
    WHERE user_id = p_user_id
    AND expires_at > now()
  ),
  distributed_tracks AS (
    SELECT
      rs.song_id,
      rs.recommendation_score,
      rs.is_familiar,
      rs.match_genre,
      rs.match_mood,
      ROW_NUMBER() OVER (PARTITION BY (ROW_NUMBER() OVER (ORDER BY rs.recommendation_score DESC) - 1) % v_config.mixes_per_user ORDER BY rs.recommendation_score DESC) as track_position,
      (ROW_NUMBER() OVER (ORDER BY rs.recommendation_score DESC) - 1) % v_config.mixes_per_user + 1 as target_mix
    FROM recommended_songs rs
  )
  INSERT INTO daily_mix_tracks (playlist_id, song_id, position, recommendation_score, explanation)
  SELECT
    p.id as playlist_id,
    dt.song_id,
    dt.track_position,
    dt.recommendation_score,
    CASE
      WHEN dt.is_familiar THEN 'Based on your listening history'
      WHEN dt.match_genre IS NOT NULL THEN 'Matches your favorite genre: ' || dt.match_genre
      WHEN dt.match_mood IS NOT NULL THEN 'Matches your mood: ' || dt.match_mood
      ELSE 'Recommended for you'
    END as explanation
  FROM distributed_tracks dt
  JOIN playlist_ids p ON p.mix_number = dt.target_mix
  WHERE dt.track_position <= v_config.tracks_per_mix
  ORDER BY dt.target_mix, dt.track_position;

  -- Get the count of created mixes
  SELECT COUNT(*) INTO v_mix_count
  FROM daily_mix_playlists
  WHERE user_id = p_user_id
  AND expires_at > now();

  RETURN jsonb_build_object(
    'success', true,
    'mixes_created', v_mix_count,
    'user_id', p_user_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'user_id', p_user_id
  );
END;
$$;

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION generate_daily_mixes_for_user TO authenticated, service_role;