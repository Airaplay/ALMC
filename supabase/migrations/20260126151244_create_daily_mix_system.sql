/*
  # Daily Mix AI Playlist System

  ## Overview
  Creates a comprehensive AI-powered playlist system similar to Spotify's Discover Daily Mix.
  Generates personalized playlists per user based on listening behavior, collaborative filtering,
  and content-based recommendations.

  ## New Tables

  ### 1. `user_music_preferences`
  Stores computed user preferences and listening patterns

  ### 2. `daily_mix_playlists`
  Stores generated daily mix playlists

  ### 3. `daily_mix_tracks`
  Individual tracks in each mix with explanations

  ### 4. `track_features`
  Store computed features for content-based filtering

  ### 5. `similar_users`
  Store collaborative filtering data

  ### 6. `daily_mix_config`
  Admin configuration for the system

  ## Security
  - Enable RLS on all tables
  - Users can only access their own mixes and preferences
  - Admins can manage configuration
*/

-- Create user_music_preferences table
CREATE TABLE IF NOT EXISTS user_music_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  top_genres jsonb DEFAULT '[]'::jsonb,
  top_moods jsonb DEFAULT '[]'::jsonb,
  top_artists jsonb DEFAULT '[]'::jsonb,
  listening_time_patterns jsonb DEFAULT '{}'::jsonb,
  avg_session_duration integer DEFAULT 0,
  skip_rate decimal(5,4) DEFAULT 0,
  completion_rate decimal(5,4) DEFAULT 0,
  diversity_score decimal(5,4) DEFAULT 0.5,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create daily_mix_playlists table
CREATE TABLE IF NOT EXISTS daily_mix_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mix_number integer NOT NULL,
  title text NOT NULL,
  description text,
  genre_focus text,
  mood_focus text,
  cover_image_url text,
  track_count integer DEFAULT 0,
  generated_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '24 hours'),
  play_count integer DEFAULT 0,
  last_played_at timestamptz
);

-- Create daily_mix_tracks table
CREATE TABLE IF NOT EXISTS daily_mix_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mix_id uuid NOT NULL REFERENCES daily_mix_playlists(id) ON DELETE CASCADE,
  song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position integer NOT NULL,
  recommendation_score decimal(5,4) NOT NULL,
  explanation text NOT NULL,
  recommendation_type text NOT NULL,
  is_familiar boolean DEFAULT false,
  played boolean DEFAULT false,
  skipped boolean DEFAULT false,
  saved boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(mix_id, position)
);

-- Create track_features table
CREATE TABLE IF NOT EXISTS track_features (
  song_id uuid PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
  primary_genre_id uuid REFERENCES genres(id) ON DELETE SET NULL,
  primary_mood_id uuid REFERENCES moods(id) ON DELETE SET NULL,
  tempo text,
  energy_level integer CHECK (energy_level BETWEEN 1 AND 10),
  popularity_score decimal(10,4) DEFAULT 0,
  artist_id uuid REFERENCES users(id) ON DELETE SET NULL,
  similar_tracks jsonb DEFAULT '[]'::jsonb,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create similar_users table
CREATE TABLE IF NOT EXISTS similar_users (
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  similar_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  similarity_score decimal(5,4) NOT NULL CHECK (similarity_score BETWEEN 0 AND 1),
  computed_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, similar_user_id),
  CHECK (user_id != similar_user_id)
);

-- Create daily_mix_config table
CREATE TABLE IF NOT EXISTS daily_mix_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean DEFAULT true,
  mixes_per_user integer DEFAULT 3,
  tracks_per_mix integer DEFAULT 50,
  familiar_ratio decimal(3,2) DEFAULT 0.70,
  min_play_duration_seconds integer DEFAULT 30,
  skip_threshold_seconds integer DEFAULT 15,
  refresh_hour integer DEFAULT 6 CHECK (refresh_hour BETWEEN 0 AND 23),
  collaborative_filtering_weight decimal(3,2) DEFAULT 0.40,
  content_based_weight decimal(3,2) DEFAULT 0.40,
  trending_weight decimal(3,2) DEFAULT 0.20,
  diversity_bonus decimal(3,2) DEFAULT 0.10,
  quality_threshold decimal(3,2) DEFAULT 0.30,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Insert default configuration
INSERT INTO daily_mix_config (enabled)
VALUES (true)
ON CONFLICT DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_music_preferences_updated ON user_music_preferences(last_updated);
CREATE INDEX IF NOT EXISTS idx_daily_mix_playlists_user_id ON daily_mix_playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_mix_playlists_user_mix ON daily_mix_playlists(user_id, mix_number);
CREATE INDEX IF NOT EXISTS idx_daily_mix_playlists_expires ON daily_mix_playlists(expires_at);
CREATE INDEX IF NOT EXISTS idx_daily_mix_playlists_generated ON daily_mix_playlists(generated_at);
CREATE INDEX IF NOT EXISTS idx_daily_mix_tracks_mix_id ON daily_mix_tracks(mix_id);
CREATE INDEX IF NOT EXISTS idx_daily_mix_tracks_song_id ON daily_mix_tracks(song_id);
CREATE INDEX IF NOT EXISTS idx_daily_mix_tracks_position ON daily_mix_tracks(mix_id, position);
CREATE INDEX IF NOT EXISTS idx_track_features_genre ON track_features(primary_genre_id);
CREATE INDEX IF NOT EXISTS idx_track_features_mood ON track_features(primary_mood_id);
CREATE INDEX IF NOT EXISTS idx_track_features_artist ON track_features(artist_id);
CREATE INDEX IF NOT EXISTS idx_track_features_popularity ON track_features(popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_similar_users_user_id ON similar_users(user_id);
CREATE INDEX IF NOT EXISTS idx_similar_users_score ON similar_users(similarity_score DESC);

-- Enable Row Level Security
ALTER TABLE user_music_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_mix_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_mix_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE similar_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_mix_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_music_preferences
CREATE POLICY "Users can view own music preferences"
  ON user_music_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert music preferences"
  ON user_music_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can update music preferences"
  ON user_music_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for daily_mix_playlists
CREATE POLICY "Users can view own daily mixes"
  ON daily_mix_playlists FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert daily mixes"
  ON daily_mix_playlists FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily mixes"
  ON daily_mix_playlists FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own daily mixes"
  ON daily_mix_playlists FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for daily_mix_tracks
CREATE POLICY "Users can view tracks in their mixes"
  ON daily_mix_tracks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM daily_mix_playlists
      WHERE daily_mix_playlists.id = daily_mix_tracks.mix_id
      AND daily_mix_playlists.user_id = auth.uid()
    )
  );

CREATE POLICY "System can insert mix tracks"
  ON daily_mix_tracks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_mix_playlists
      WHERE daily_mix_playlists.id = daily_mix_tracks.mix_id
      AND daily_mix_playlists.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update tracks in their mixes"
  ON daily_mix_tracks FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM daily_mix_playlists
      WHERE daily_mix_playlists.id = daily_mix_tracks.mix_id
      AND daily_mix_playlists.user_id = auth.uid()
    )
  );

-- RLS Policies for track_features
CREATE POLICY "Anyone can view track features"
  ON track_features FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can manage track features"
  ON track_features FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- RLS Policies for similar_users
CREATE POLICY "Users can view their similar users"
  ON similar_users FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for daily_mix_config
CREATE POLICY "Anyone can view daily mix config"
  ON daily_mix_config FOR SELECT
  TO authenticated
  USING (true);

-- Create function to clean up expired mixes
CREATE OR REPLACE FUNCTION cleanup_expired_daily_mixes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM daily_mix_playlists
  WHERE expires_at < now() - interval '7 days';
END;
$$;

-- Create function to update track features from songs
CREATE OR REPLACE FUNCTION update_track_features_from_songs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO track_features (song_id, primary_genre_id, primary_mood_id, artist_id, popularity_score, last_updated)
  SELECT 
    s.id,
    (SELECT genre_id FROM song_genres WHERE song_id = s.id LIMIT 1),
    (SELECT mood_id FROM song_moods WHERE song_id = s.id ORDER BY confidence_score DESC LIMIT 1),
    CASE 
      WHEN EXISTS (SELECT 1 FROM users WHERE id = s.artist_id) THEN s.artist_id
      ELSE NULL
    END,
    CASE 
      WHEN (SELECT MAX(play_count) FROM songs) > 0 
      THEN COALESCE(s.play_count, 0)::decimal / (SELECT MAX(play_count) FROM songs)
      ELSE 0
    END,
    now()
  FROM songs s
  ON CONFLICT (song_id) 
  DO UPDATE SET
    primary_genre_id = EXCLUDED.primary_genre_id,
    primary_mood_id = EXCLUDED.primary_mood_id,
    artist_id = EXCLUDED.artist_id,
    popularity_score = EXCLUDED.popularity_score,
    last_updated = now();
END;
$$;

-- Initial population of track features
SELECT update_track_features_from_songs();
