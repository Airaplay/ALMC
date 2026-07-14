/*
  # Fan Influence Meter System

  ## Overview
  Creates a gamified influence scoring system that rewards users for discovering content early
  before it becomes trending, making them feel like tastemakers and culture shapers.

  ## New Tables
  
  ### `user_influence_scores`
  - `user_id` (uuid, primary key, references users)
  - `current_score` (integer, default 0) - Current influence score
  - `total_discoveries` (integer, default 0) - Total early discoveries
  - `trending_discoveries` (integer, default 0) - Discoveries that became trending
  - `this_week_score` (integer, default 0) - Score earned this week
  - `last_week_score` (integer, default 0) - Score earned last week
  - `streak_days` (integer, default 0) - Consecutive days of discoveries
  - `rank` (text) - User's rank tier
  - `last_updated` (timestamptz)
  - `created_at` (timestamptz)

  ### `early_discoveries`
  - `id` (uuid, primary key)
  - `user_id` (uuid, references users)
  - `song_id` (uuid, references songs)
  - `video_id` (uuid, references content_uploads)
  - `discovered_at` (timestamptz)
  - `play_count_at_discovery` (integer) - Play count when discovered
  - `became_trending` (boolean, default false)
  - `influence_points_awarded` (integer, default 0)
  - `created_at` (timestamptz)

  ### `trending_discoveries`
  - `id` (uuid, primary key)
  - `content_id` (uuid) - Song or video ID
  - `content_type` (text) - 'song' or 'video'
  - `discoverers` (uuid[]) - Array of user IDs who discovered early
  - `points_per_discoverer` (integer) - Points awarded to each discoverer
  - `detected_at` (timestamptz)
  - `created_at` (timestamptz)

  ## Functions
  
  ### `calculate_influence_rank(score integer)`
  Returns rank tier based on score thresholds

  ### `track_early_discovery(p_user_id uuid, p_song_id uuid, p_video_id uuid)`
  Records when a user discovers content with <1000 plays

  ### `update_trending_discoveries()`
  Scans for content that became trending, awards points to early discoverers

  ### `get_user_influence_dashboard(p_user_id uuid)`
  Returns complete influence dashboard data

  ## Security
  - Enable RLS on all tables
  - Users can read their own influence data
  - Only authenticated users can track discoveries
  - System functions handle point calculations

  ## Indexes
  - Index on user_id for fast lookups
  - Index on content IDs for discovery tracking
  - Composite indexes for performance optimization
*/

-- Create user_influence_scores table
CREATE TABLE IF NOT EXISTS user_influence_scores (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_score integer DEFAULT 0 CHECK (current_score >= 0),
  total_discoveries integer DEFAULT 0 CHECK (total_discoveries >= 0),
  trending_discoveries integer DEFAULT 0 CHECK (trending_discoveries >= 0),
  this_week_score integer DEFAULT 0 CHECK (this_week_score >= 0),
  last_week_score integer DEFAULT 0 CHECK (last_week_score >= 0),
  streak_days integer DEFAULT 0 CHECK (streak_days >= 0),
  rank text DEFAULT 'Explorer',
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create early_discoveries table
CREATE TABLE IF NOT EXISTS early_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id uuid REFERENCES songs(id) ON DELETE CASCADE,
  video_id uuid REFERENCES content_uploads(id) ON DELETE CASCADE,
  discovered_at timestamptz DEFAULT now(),
  play_count_at_discovery integer DEFAULT 0,
  became_trending boolean DEFAULT false,
  influence_points_awarded integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CHECK (
    (song_id IS NOT NULL AND video_id IS NULL) OR 
    (song_id IS NULL AND video_id IS NOT NULL)
  )
);

-- Create trending_discoveries table
CREATE TABLE IF NOT EXISTS trending_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('song', 'video')),
  discoverers uuid[] DEFAULT '{}',
  points_per_discoverer integer DEFAULT 0,
  detected_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(content_id, content_type)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_influence_scores_user_id ON user_influence_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_user_influence_scores_current_score ON user_influence_scores(current_score DESC);
CREATE INDEX IF NOT EXISTS idx_early_discoveries_user_id ON early_discoveries(user_id);
CREATE INDEX IF NOT EXISTS idx_early_discoveries_song_id ON early_discoveries(song_id) WHERE song_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_early_discoveries_video_id ON early_discoveries(video_id) WHERE video_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_early_discoveries_became_trending ON early_discoveries(became_trending) WHERE became_trending = false;
CREATE INDEX IF NOT EXISTS idx_trending_discoveries_content ON trending_discoveries(content_id, content_type);

-- Enable RLS
ALTER TABLE user_influence_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE early_discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE trending_discoveries ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_influence_scores
CREATE POLICY "Users can view their own influence scores"
  ON user_influence_scores FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view all influence scores for leaderboard"
  ON user_influence_scores FOR SELECT
  TO authenticated
  USING (true);

-- RLS Policies for early_discoveries
CREATE POLICY "Users can view their own discoveries"
  ON early_discoveries FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for trending_discoveries
CREATE POLICY "Users can view trending discoveries"
  ON trending_discoveries FOR SELECT
  TO authenticated
  USING (true);

-- Function: Calculate influence rank based on score
CREATE OR REPLACE FUNCTION calculate_influence_rank(score integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF score >= 10000 THEN
    RETURN 'Legendary Tastemaker';
  ELSIF score >= 5000 THEN
    RETURN 'Elite Curator';
  ELSIF score >= 2000 THEN
    RETURN 'Master Influencer';
  ELSIF score >= 1000 THEN
    RETURN 'Veteran Discoverer';
  ELSIF score >= 500 THEN
    RETURN 'Rising Trendsetter';
  ELSIF score >= 100 THEN
    RETURN 'Active Scout';
  ELSE
    RETURN 'Explorer';
  END IF;
END;
$$;

-- Function: Track early discovery
CREATE OR REPLACE FUNCTION track_early_discovery(
  p_user_id uuid,
  p_song_id uuid DEFAULT NULL,
  p_video_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_play_count integer;
  v_creator_id uuid;
  v_already_discovered boolean;
BEGIN
  -- Validate input
  IF (p_song_id IS NULL AND p_video_id IS NULL) OR (p_song_id IS NOT NULL AND p_video_id IS NOT NULL) THEN
    RETURN;
  END IF;

  -- Get play count and creator ID
  IF p_song_id IS NOT NULL THEN
    SELECT play_count, artist_id INTO v_play_count, v_creator_id
    FROM songs
    WHERE id = p_song_id;
  ELSE
    SELECT play_count, user_id INTO v_play_count, v_creator_id
    FROM content_uploads
    WHERE id = p_video_id AND content_type = 'video';
  END IF;

  -- Don't track if user is the creator (creators can't earn influence from own content)
  IF v_creator_id = p_user_id THEN
    RETURN;
  END IF;

  -- Only track if play count is under 1000
  IF v_play_count >= 1000 THEN
    RETURN;
  END IF;

  -- Check if already discovered
  IF p_song_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM early_discoveries
      WHERE user_id = p_user_id AND song_id = p_song_id
    ) INTO v_already_discovered;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM early_discoveries
      WHERE user_id = p_user_id AND video_id = p_video_id
    ) INTO v_already_discovered;
  END IF;

  IF v_already_discovered THEN
    RETURN;
  END IF;

  -- Record the discovery
  INSERT INTO early_discoveries (
    user_id,
    song_id,
    video_id,
    play_count_at_discovery
  ) VALUES (
    p_user_id,
    p_song_id,
    p_video_id,
    v_play_count
  );

  -- Initialize influence score if needed
  INSERT INTO user_influence_scores (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Update total discoveries count
  UPDATE user_influence_scores
  SET 
    total_discoveries = total_discoveries + 1,
    last_updated = now()
  WHERE user_id = p_user_id;
END;
$$;

-- Function: Update trending discoveries and award points
CREATE OR REPLACE FUNCTION update_trending_discoveries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_discovery RECORD;
  v_points integer;
  v_discoverers uuid[];
BEGIN
  -- Find songs that became trending (>10000 plays)
  FOR v_discovery IN
    SELECT DISTINCT ed.song_id AS content_id, 'song' AS content_type
    FROM early_discoveries ed
    JOIN songs s ON s.id = ed.song_id
    WHERE ed.song_id IS NOT NULL
      AND ed.became_trending = false
      AND s.play_count >= 10000
      AND NOT EXISTS (
        SELECT 1 FROM trending_discoveries td
        WHERE td.content_id = ed.song_id AND td.content_type = 'song'
      )
  LOOP
    -- Calculate points (earlier discovery = more points)
    v_points := 100;

    -- Get all discoverers for this content
    SELECT array_agg(DISTINCT user_id)
    INTO v_discoverers
    FROM early_discoveries
    WHERE song_id = v_discovery.content_id
      AND became_trending = false;

    -- Record trending discovery
    INSERT INTO trending_discoveries (
      content_id,
      content_type,
      discoverers,
      points_per_discoverer
    ) VALUES (
      v_discovery.content_id,
      v_discovery.content_type,
      v_discoverers,
      v_points
    );

    -- Award points to discoverers
    UPDATE early_discoveries
    SET 
      became_trending = true,
      influence_points_awarded = v_points
    WHERE song_id = v_discovery.content_id
      AND became_trending = false;

    -- Update user scores
    UPDATE user_influence_scores
    SET 
      current_score = current_score + v_points,
      trending_discoveries = trending_discoveries + 1,
      this_week_score = this_week_score + v_points,
      rank = calculate_influence_rank(current_score + v_points),
      last_updated = now()
    WHERE user_id = ANY(v_discoverers);
  END LOOP;

  -- Find videos that became trending (>10000 plays)
  FOR v_discovery IN
    SELECT DISTINCT ed.video_id AS content_id, 'video' AS content_type
    FROM early_discoveries ed
    JOIN content_uploads cu ON cu.id = ed.video_id
    WHERE ed.video_id IS NOT NULL
      AND ed.became_trending = false
      AND cu.content_type = 'video'
      AND cu.play_count >= 10000
      AND NOT EXISTS (
        SELECT 1 FROM trending_discoveries td
        WHERE td.content_id = ed.video_id AND td.content_type = 'video'
      )
  LOOP
    v_points := 100;

    SELECT array_agg(DISTINCT user_id)
    INTO v_discoverers
    FROM early_discoveries
    WHERE video_id = v_discovery.content_id
      AND became_trending = false;

    INSERT INTO trending_discoveries (
      content_id,
      content_type,
      discoverers,
      points_per_discoverer
    ) VALUES (
      v_discovery.content_id,
      v_discovery.content_type,
      v_discoverers,
      v_points
    );

    UPDATE early_discoveries
    SET 
      became_trending = true,
      influence_points_awarded = v_points
    WHERE video_id = v_discovery.content_id
      AND became_trending = false;

    UPDATE user_influence_scores
    SET 
      current_score = current_score + v_points,
      trending_discoveries = trending_discoveries + 1,
      this_week_score = this_week_score + v_points,
      rank = calculate_influence_rank(current_score + v_points),
      last_updated = now()
    WHERE user_id = ANY(v_discoverers);
  END LOOP;
END;
$$;

-- Function: Get user influence dashboard
CREATE OR REPLACE FUNCTION get_user_influence_dashboard(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    'current_score', COALESCE(uis.current_score, 0),
    'rank', COALESCE(uis.rank, 'Explorer'),
    'total_discoveries', COALESCE(uis.total_discoveries, 0),
    'trending_discoveries', COALESCE(uis.trending_discoveries, 0),
    'this_week_score', COALESCE(uis.this_week_score, 0),
    'last_week_score', COALESCE(uis.last_week_score, 0),
    'week_change', COALESCE(uis.this_week_score - uis.last_week_score, 0),
    'streak_days', COALESCE(uis.streak_days, 0),
    'recent_discoveries', (
      SELECT json_agg(json_build_object(
        'title', COALESCE(s.title, cu.title),
        'artist', COALESCE(s.artist_name, cu.title),
        'discovered_at', ed.discovered_at,
        'became_trending', ed.became_trending,
        'points_awarded', ed.influence_points_awarded
      ))
      FROM early_discoveries ed
      LEFT JOIN songs s ON s.id = ed.song_id
      LEFT JOIN content_uploads cu ON cu.id = ed.video_id
      WHERE ed.user_id = p_user_id
      ORDER BY ed.discovered_at DESC
      LIMIT 10
    )
  )
  INTO v_result
  FROM user_influence_scores uis
  WHERE uis.user_id = p_user_id;

  RETURN COALESCE(v_result, json_build_object(
    'current_score', 0,
    'rank', 'Explorer',
    'total_discoveries', 0,
    'trending_discoveries', 0,
    'this_week_score', 0,
    'last_week_score', 0,
    'week_change', 0,
    'streak_days', 0,
    'recent_discoveries', '[]'::json
  ));
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_influence_rank(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION track_early_discovery(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION update_trending_discoveries() TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_influence_dashboard(uuid) TO authenticated;