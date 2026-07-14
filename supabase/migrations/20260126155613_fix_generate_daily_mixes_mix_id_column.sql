/*
  # Fix Daily Mix Generation Function - Use mix_id Column

  1. Updates function to use correct column name mix_id instead of playlist_id
*/

-- Drop and recreate the function with correct column name
DROP FUNCTION IF EXISTS generate_daily_mixes_for_user(uuid, jsonb);

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
  v_mix_count integer := 0;
  v_mixes_per_user integer;
  v_tracks_per_mix integer;
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

  v_mixes_per_user := COALESCE(v_config.mixes_per_user, 3);
  v_tracks_per_mix := COALESCE(v_config.tracks_per_mix, 30);

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
  IF (SELECT COUNT(*) FROM listening_history
      WHERE user_id = p_user_id
      AND listened_at > now() - interval '90 days'
      AND duration_listened >= COALESCE(v_config.min_play_duration_seconds, 30)) < 20 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient listening history'
    );
  END IF;

  -- Delete old mixes for this user
  DELETE FROM daily_mix_playlists
  WHERE user_id = p_user_id
  AND expires_at < now();

  -- Step 1: Create empty mix playlists
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
    NULL as genre_focus,
    NULL as mood_focus,
    v_tracks_per_mix
  FROM generate_series(1, v_mixes_per_user) series(num);

  -- Step 2: Generate and distribute recommendations
  WITH user_genres AS (
    SELECT
      sg.genre_id,
      g.name as genre_name,
      COUNT(*) as play_count
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    JOIN song_genres sg ON sg.song_id = s.id
    JOIN genres g ON g.id = sg.genre_id
    WHERE lh.user_id = p_user_id
    AND lh.listened_at > now() - interval '90 days'
    AND lh.duration_listened >= COALESCE(v_config.min_play_duration_seconds, 30)
    GROUP BY sg.genre_id, g.name
    ORDER BY play_count DESC
    LIMIT 5
  ),
  user_moods AS (
    SELECT
      sm.mood_id,
      m.name as mood_name,
      COUNT(*) as play_count
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    JOIN song_moods sm ON sm.song_id = s.id
    JOIN moods m ON m.id = sm.mood_id
    WHERE lh.user_id = p_user_id
    AND lh.listened_at > now() - interval '90 days'
    AND lh.duration_listened >= COALESCE(v_config.min_play_duration_seconds, 30)
    GROUP BY sm.mood_id, m.name
    ORDER BY play_count DESC
    LIMIT 5
  ),
  recommended_songs AS (
    SELECT DISTINCT
      s.id as song_id,
      (
        -- Content-based score: matches user's top genres
        COALESCE((SELECT COUNT(*) FROM song_genres sg WHERE sg.song_id = s.id AND sg.genre_id IN (SELECT genre_id FROM user_genres)), 0) * 0.4 +
        -- Content-based score: matches user's top moods
        COALESCE((SELECT COUNT(*) FROM song_moods sm WHERE sm.song_id = s.id AND sm.mood_id IN (SELECT mood_id FROM user_moods)), 0) * 0.3 +
        -- Trending score: global popularity
        (s.play_count::float / GREATEST(EXTRACT(EPOCH FROM (now() - s.created_at)) / 86400, 1)) * 0.2 +
        -- Diversity bonus
        CASE WHEN EXISTS (SELECT 1 FROM listening_history WHERE user_id = p_user_id AND song_id = s.id) THEN -0.3 ELSE 0.2 END
      ) as recommendation_score,
      CASE WHEN EXISTS (SELECT 1 FROM listening_history WHERE user_id = p_user_id AND song_id = s.id) THEN true ELSE false END as is_familiar
    FROM songs s
    WHERE s.audio_url IS NOT NULL
    AND s.artist_id != p_user_id
    AND (
      EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id AND sg.genre_id IN (SELECT genre_id FROM user_genres))
      OR EXISTS (SELECT 1 FROM song_moods sm WHERE sm.song_id = s.id AND sm.mood_id IN (SELECT mood_id FROM user_moods))
      OR s.play_count > 50
    )
    ORDER BY recommendation_score DESC
    LIMIT 200
  ),
  ranked_songs AS (
    SELECT
      song_id,
      recommendation_score,
      is_familiar,
      ROW_NUMBER() OVER (ORDER BY recommendation_score DESC) as song_rank
    FROM recommended_songs
  ),
  playlist_ids AS (
    SELECT id, mix_number
    FROM daily_mix_playlists
    WHERE user_id = p_user_id
    AND expires_at > now()
    ORDER BY mix_number
  ),
  distributed_tracks AS (
    SELECT
      song_id,
      recommendation_score,
      is_familiar,
      song_rank,
      ((song_rank - 1) % v_mixes_per_user) + 1 as target_mix,
      ((song_rank - 1) / v_mixes_per_user) + 1 as position_in_mix
    FROM ranked_songs
  )
  INSERT INTO daily_mix_tracks (mix_id, song_id, position, recommendation_score, explanation, is_familiar)
  SELECT
    p.id as mix_id,
    dt.song_id,
    dt.position_in_mix,
    dt.recommendation_score,
    CASE
      WHEN dt.is_familiar THEN 'Based on your listening history'
      ELSE 'Recommended for you'
    END as explanation,
    dt.is_familiar
  FROM distributed_tracks dt
  JOIN playlist_ids p ON p.mix_number = dt.target_mix
  WHERE dt.position_in_mix <= v_tracks_per_mix;

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

-- Grant execute permission
GRANT EXECUTE ON FUNCTION generate_daily_mixes_for_user TO authenticated, service_role;