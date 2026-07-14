/*
  # Add Listening Engagement Rewards

  ## Overview
  Add compliant listening-based contribution activities that reward
  ENGAGEMENT and DISCOVERY, not just passive consumption.

  ## Key Principle
  Rewards are for BEHAVIOR that adds value, not for ad impressions:
  - Daily active listening (not per-song)
  - Genre exploration (discovering variety)
  - Artist discovery (finding new talent)
  - Completion rate (genuine engagement)
  - Listening milestones (consistency)

  ## New Activities
  - Daily active listener (once per day)
  - Genre explorer (weekly bonus)
  - Artist supporter (discover emerging artists)
  - Song completion bonus (finish songs you start)
  - Listening streak (consecutive days)
*/

-- Add new listening-based contribution activities
INSERT INTO contribution_activities (activity_type, activity_name, description, base_reward_points, is_active)
VALUES
  -- Daily engagement (can only earn once per day)
  ('daily_active_listener', 'Daily Active Listener', 'Listen to at least 5 songs in a day', 10, true),
  
  -- Weekly variety bonus
  ('genre_explorer', 'Genre Explorer', 'Listen to songs from 5+ different genres in a week', 25, true),
  
  -- Discover new/small artists
  ('artist_discovery', 'Artist Discovery', 'Listen to 5+ songs from artists with <10k total plays', 20, true),
  
  -- Complete songs (not skipping)
  ('song_completion_bonus', 'Engaged Listener', 'Complete 80%+ of songs you start (daily)', 15, true),
  
  -- Listening streaks
  ('listening_streak_3', '3-Day Listening Streak', 'Listen actively for 3 consecutive days', 30, true),
  ('listening_streak_7', '7-Day Listening Streak', 'Listen actively for 7 consecutive days', 75, true),
  ('listening_streak_30', '30-Day Listening Streak', 'Listen actively for 30 consecutive days', 300, true),
  
  -- Support emerging artists (listen when they're small)
  ('early_supporter', 'Early Artist Supporter', 'Listen to artist who later reaches 100k plays', 100, true)
  
ON CONFLICT (activity_type) DO NOTHING;

-- Create table to track user listening stats for milestone detection
CREATE TABLE IF NOT EXISTS listener_engagement_stats (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_active_date date,
  current_streak_days integer DEFAULT 0,
  longest_streak_days integer DEFAULT 0,
  daily_songs_completed integer DEFAULT 0,
  daily_songs_started integer DEFAULT 0,
  weekly_genres_listened jsonb DEFAULT '[]'::jsonb,
  weekly_new_artists integer DEFAULT 0,
  last_streak_check date,
  last_weekly_reset date,
  updated_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_listener_stats_user ON listener_engagement_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_listener_stats_date ON listener_engagement_stats(last_active_date);

ALTER TABLE listener_engagement_stats ENABLE ROW LEVEL SECURITY;

-- Users can view their own stats
CREATE POLICY "Users can view own engagement stats"
  ON listener_engagement_stats FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- System can manage stats
CREATE POLICY "Service role can manage engagement stats"
  ON listener_engagement_stats FOR ALL
  WITH CHECK (true);

-- Function to track song completion and update engagement stats
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

  -- Check for daily active listener (5+ songs)
  IF v_stats.daily_songs_started >= 5 THEN
    -- Check if already awarded today
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

  -- Check completion rate (80%+) and award bonus
  IF v_stats.daily_songs_started >= 10 THEN
    v_completion_rate := v_stats.daily_songs_completed::decimal / v_stats.daily_songs_started;
    IF v_completion_rate >= 0.8 THEN
      -- Check if already awarded today
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
    -- Add genre to weekly list if not already there
    IF NOT (v_stats.weekly_genres_listened @> jsonb_build_array(p_genre)) THEN
      UPDATE listener_engagement_stats
      SET weekly_genres_listened = weekly_genres_listened || jsonb_build_array(p_genre)
      WHERE user_id = p_user_id;
      
      -- Check if reached 5 genres this week
      IF jsonb_array_length(v_stats.weekly_genres_listened) + 1 >= 5 THEN
        -- Check if already awarded this week
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION track_listening_engagement TO authenticated, service_role;

-- Add helpful comment
COMMENT ON FUNCTION track_listening_engagement IS 'Tracks listening engagement and awards milestone-based points (NOT per-song). Rewards quality listening behavior like completion rate, variety, and streaks.';
