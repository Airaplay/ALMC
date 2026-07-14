/*
  # Add 50 Songs Per Day Listening Milestone

  ## Overview
  Adds the missing "Super Active Listener" milestone for listening to 50+ songs in a day.
  This completes the listening engagement milestone progression: 5, 10, 20, 50 songs/day.

  ## New Activity
  - daily_listener_50: Listen to at least 50 songs in a day (50 points)

  ## Key Features
  - Independent milestone (not progressive)
  - Time-gated to once per day
  - Rewards consistent, high-volume engagement
  - Compliant with engagement pattern rewards
*/

-- Add the 50 songs/day listening engagement activity
INSERT INTO contribution_activities (activity_type, activity_name, description, base_reward_points, is_active)
VALUES
  ('daily_listener_50', 'Super Active Listener', 'Listen to at least 50 songs in a day', 50, true)
ON CONFLICT (activity_type) DO UPDATE SET
  activity_name = EXCLUDED.activity_name,
  description = EXCLUDED.description,
  base_reward_points = EXCLUDED.base_reward_points,
  is_active = EXCLUDED.is_active;

-- Update the track_listening_engagement function to include 50 songs milestone
CREATE OR REPLACE FUNCTION track_listening_engagement(
  p_user_id uuid,
  p_song_id uuid,
  p_completed boolean,
  p_genre text DEFAULT NULL,
  p_artist_total_plays integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_stats record;
  v_completion_rate decimal;
  v_streak_days integer;
BEGIN
  -- Get or create user stats
  INSERT INTO listener_engagement_stats (user_id, last_active_date)
  VALUES (p_user_id, v_today)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_stats
  FROM listener_engagement_stats
  WHERE user_id = p_user_id;

  -- Track song start/completion
  IF p_completed THEN
    UPDATE listener_engagement_stats
    SET
      daily_songs_completed = CASE
        WHEN last_active_date = v_today THEN daily_songs_completed + 1
        ELSE 1
      END,
      daily_songs_started = CASE
        WHEN last_active_date = v_today THEN daily_songs_started + 1
        ELSE 1
      END,
      last_active_date = v_today,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    UPDATE listener_engagement_stats
    SET
      daily_songs_started = CASE
        WHEN last_active_date = v_today THEN daily_songs_started + 1
        ELSE 1
      END,
      last_active_date = v_today,
      updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  -- Refresh stats after update
  SELECT * INTO v_stats
  FROM listener_engagement_stats
  WHERE user_id = p_user_id;

  -- Check for daily active listener (5+ songs) - BASIC MILESTONE
  IF v_stats.daily_songs_started >= 5 THEN
    IF NOT EXISTS (
      SELECT 1 FROM listener_contributions
      WHERE user_id = p_user_id
      AND activity_type = 'daily_active_listener'
      AND created_at >= v_today
    ) THEN
      PERFORM record_listener_contribution(
        p_user_id,
        'daily_active_listener',
        NULL,
        NULL,
        jsonb_build_object('songs_count', v_stats.daily_songs_started)
      );
    END IF;
  END IF;

  -- Check for dedicated listener (10+ songs) - INDEPENDENT MILESTONE
  IF v_stats.daily_songs_started >= 10 THEN
    IF NOT EXISTS (
      SELECT 1 FROM listener_contributions
      WHERE user_id = p_user_id
      AND activity_type = 'daily_listener_10'
      AND created_at >= v_today
    ) THEN
      PERFORM record_listener_contribution(
        p_user_id,
        'daily_listener_10',
        NULL,
        NULL,
        jsonb_build_object('songs_count', v_stats.daily_songs_started)
      );
    END IF;
  END IF;

  -- Check for super listener (20+ songs) - INDEPENDENT MILESTONE
  IF v_stats.daily_songs_started >= 20 THEN
    IF NOT EXISTS (
      SELECT 1 FROM listener_contributions
      WHERE user_id = p_user_id
      AND activity_type = 'daily_listener_20'
      AND created_at >= v_today
    ) THEN
      PERFORM record_listener_contribution(
        p_user_id,
        'daily_listener_20',
        NULL,
        NULL,
        jsonb_build_object('songs_count', v_stats.daily_songs_started)
      );
    END IF;
  END IF;

  -- Check for super active listener (50+ songs) - INDEPENDENT MILESTONE
  IF v_stats.daily_songs_started >= 50 THEN
    IF NOT EXISTS (
      SELECT 1 FROM listener_contributions
      WHERE user_id = p_user_id
      AND activity_type = 'daily_listener_50'
      AND created_at >= v_today
    ) THEN
      PERFORM record_listener_contribution(
        p_user_id,
        'daily_listener_50',
        NULL,
        NULL,
        jsonb_build_object('songs_count', v_stats.daily_songs_started)
      );
    END IF;
  END IF;

  -- Check completion rate (80%+) and award bonus
  IF v_stats.daily_songs_started >= 10 THEN
    v_completion_rate := v_stats.daily_songs_completed::decimal / v_stats.daily_songs_started;
    IF v_completion_rate >= 0.8 THEN
      IF NOT EXISTS (
        SELECT 1 FROM listener_contributions
        WHERE user_id = p_user_id
        AND activity_type = 'song_completion_bonus'
        AND created_at >= v_today
      ) THEN
        PERFORM record_listener_contribution(
          p_user_id,
          'song_completion_bonus',
          NULL,
          NULL,
          jsonb_build_object('completion_rate', v_completion_rate)
        );
      END IF;
    END IF;
  END IF;

  -- Track genre exploration (weekly)
  IF p_genre IS NOT NULL THEN
    IF NOT (v_stats.weekly_genres_listened @> jsonb_build_array(p_genre)) THEN
      UPDATE listener_engagement_stats
      SET weekly_genres_listened = weekly_genres_listened || jsonb_build_array(p_genre)
      WHERE user_id = p_user_id;

      -- Check if reached 5 genres this week
      IF jsonb_array_length(v_stats.weekly_genres_listened) + 1 >= 5 THEN
        IF NOT EXISTS (
          SELECT 1 FROM listener_contributions
          WHERE user_id = p_user_id
          AND activity_type = 'genre_explorer'
          AND created_at >= (v_today - INTERVAL '7 days')
        ) THEN
          PERFORM record_listener_contribution(
            p_user_id,
            'genre_explorer',
            NULL,
            NULL,
            jsonb_build_object('genres_count', jsonb_array_length(v_stats.weekly_genres_listened) + 1)
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- Track artist discovery (small artists)
  IF p_artist_total_plays IS NOT NULL AND p_artist_total_plays < 10000 THEN
    UPDATE listener_engagement_stats
    SET weekly_new_artists = weekly_new_artists + 1
    WHERE user_id = p_user_id;

    -- Refresh stats
    SELECT * INTO v_stats FROM listener_engagement_stats WHERE user_id = p_user_id;

    -- Check if discovered 5+ small artists this week
    IF v_stats.weekly_new_artists >= 5 THEN
      IF NOT EXISTS (
        SELECT 1 FROM listener_contributions
        WHERE user_id = p_user_id
        AND activity_type = 'artist_discovery'
        AND created_at >= (v_today - INTERVAL '7 days')
      ) THEN
        PERFORM record_listener_contribution(
          p_user_id,
          'artist_discovery',
          NULL,
          NULL,
          jsonb_build_object('artists_count', v_stats.weekly_new_artists)
        );
      END IF;
    END IF;
  END IF;

  -- Update listening streak
  IF v_stats.last_streak_check IS NULL OR v_stats.last_streak_check < v_today THEN
    -- Check if this is consecutive day
    IF v_stats.last_active_date = v_today - INTERVAL '1 day' THEN
      v_streak_days := v_stats.current_streak_days + 1;
    ELSIF v_stats.last_active_date = v_today THEN
      v_streak_days := v_stats.current_streak_days;
    ELSE
      v_streak_days := 1;
    END IF;

    -- Update streak
    UPDATE listener_engagement_stats
    SET
      current_streak_days = v_streak_days,
      longest_streak_days = GREATEST(longest_streak_days, v_streak_days),
      last_streak_check = v_today
    WHERE user_id = p_user_id;

    -- Award streak bonuses
    IF v_streak_days = 3 THEN
      PERFORM record_listener_contribution(p_user_id, 'listening_streak_3', NULL, NULL, jsonb_build_object('days', 3));
    ELSIF v_streak_days = 7 THEN
      PERFORM record_listener_contribution(p_user_id, 'listening_streak_7', NULL, NULL, jsonb_build_object('days', 7));
    ELSIF v_streak_days = 30 THEN
      PERFORM record_listener_contribution(p_user_id, 'listening_streak_30', NULL, NULL, jsonb_build_object('days', 30));
    END IF;
  END IF;

  -- Reset weekly stats if needed
  IF v_stats.last_weekly_reset IS NULL OR v_stats.last_weekly_reset < (v_today - INTERVAL '7 days') THEN
    UPDATE listener_engagement_stats
    SET
      weekly_genres_listened = '[]'::jsonb,
      weekly_new_artists = 0,
      last_weekly_reset = v_today
    WHERE user_id = p_user_id;
  END IF;

END;
$$;

-- Update function comment
COMMENT ON FUNCTION track_listening_engagement IS 'Tracks listening engagement and awards milestone-based points (5, 10, 20, 50 songs). Each milestone is independent and awarded once per day. Rewards quality listening behavior including completion rate, variety, and streaks.';