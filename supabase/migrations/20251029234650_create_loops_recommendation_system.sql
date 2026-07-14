/*
  # Create Loops Recommendation System

  1. New Tables
    - `loop_interactions`
      - Tracks all user interactions with Loop videos (plays, likes, comments, shares, skips)
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to users)
      - `content_id` (uuid, foreign key to content_uploads)
      - `interaction_type` (text: 'play', 'like', 'comment', 'share', 'skip', 'profile_visit', 'rewatch', 'complete')
      - `watch_duration` (integer, seconds watched)
      - `video_duration` (integer, total video duration in seconds)
      - `completion_rate` (numeric, percentage watched)
      - `session_id` (uuid, to group interactions in same session)
      - `metadata` (jsonb, for hashtags, sounds, etc.)
      - `created_at` (timestamptz)

    - `user_interest_graph`
      - Stores computed user preferences and interests
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to users, unique)
      - `interest_scores` (jsonb, map of content_id to interest score)
      - `category_preferences` (jsonb, map of categories to scores)
      - `creator_preferences` (jsonb, map of creator_ids to scores)
      - `hashtag_preferences` (jsonb, map of hashtags to scores)
      - `avg_watch_duration` (integer, average watch duration)
      - `preferred_video_lengths` (jsonb, distribution of preferred lengths)
      - `last_updated` (timestamptz)
      - `created_at` (timestamptz)

    - `loop_recommendations`
      - Stores pre-computed recommendations for users
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to users)
      - `content_id` (uuid, foreign key to content_uploads)
      - `recommendation_score` (numeric, 0-100 score)
      - `reason` (text, why this was recommended)
      - `position` (integer, order in recommendation list)
      - `generated_at` (timestamptz)
      - `shown_at` (timestamptz, nullable)
      - `interacted` (boolean, default false)

  2. Functions
    - `update_user_interest_graph()` - Updates user interest graph based on interactions
    - `generate_loop_recommendations()` - Generates personalized recommendations
    - `get_smart_loop_feed()` - Gets the next batch of loops for a user

  3. Indexes
    - Optimized indexes for fast lookups and recommendations

  4. Security
    - Enable RLS on all tables
    - Users can only see/modify their own data
    - Admins have full access
*/

-- Create loop_interactions table
CREATE TABLE IF NOT EXISTS loop_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES content_uploads(id) ON DELETE CASCADE,
  interaction_type text NOT NULL CHECK (interaction_type IN ('play', 'like', 'unlike', 'comment', 'share', 'skip', 'profile_visit', 'rewatch', 'complete')),
  watch_duration integer DEFAULT 0,
  video_duration integer DEFAULT 0,
  completion_rate numeric DEFAULT 0 CHECK (completion_rate >= 0 AND completion_rate <= 100),
  session_id uuid DEFAULT gen_random_uuid(),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for loop_interactions
CREATE INDEX IF NOT EXISTS idx_loop_interactions_user_id ON loop_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_loop_interactions_content_id ON loop_interactions(content_id);
CREATE INDEX IF NOT EXISTS idx_loop_interactions_type ON loop_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_loop_interactions_session ON loop_interactions(session_id);
CREATE INDEX IF NOT EXISTS idx_loop_interactions_created_at ON loop_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loop_interactions_user_content ON loop_interactions(user_id, content_id);

-- Create user_interest_graph table
CREATE TABLE IF NOT EXISTS user_interest_graph (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_scores jsonb DEFAULT '{}'::jsonb,
  category_preferences jsonb DEFAULT '{}'::jsonb,
  creator_preferences jsonb DEFAULT '{}'::jsonb,
  hashtag_preferences jsonb DEFAULT '{}'::jsonb,
  avg_watch_duration integer DEFAULT 0,
  preferred_video_lengths jsonb DEFAULT '{"short": 0, "medium": 0, "long": 0}'::jsonb,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create indexes for user_interest_graph
CREATE INDEX IF NOT EXISTS idx_user_interest_graph_user_id ON user_interest_graph(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interest_graph_last_updated ON user_interest_graph(last_updated DESC);

-- Create loop_recommendations table
CREATE TABLE IF NOT EXISTS loop_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES content_uploads(id) ON DELETE CASCADE,
  recommendation_score numeric DEFAULT 50 CHECK (recommendation_score >= 0 AND recommendation_score <= 100),
  reason text,
  position integer DEFAULT 0,
  generated_at timestamptz DEFAULT now(),
  shown_at timestamptz,
  interacted boolean DEFAULT false,
  UNIQUE(user_id, content_id, generated_at)
);

-- Create indexes for loop_recommendations
CREATE INDEX IF NOT EXISTS idx_loop_recommendations_user_id ON loop_recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_loop_recommendations_content_id ON loop_recommendations(content_id);
CREATE INDEX IF NOT EXISTS idx_loop_recommendations_score ON loop_recommendations(recommendation_score DESC);
CREATE INDEX IF NOT EXISTS idx_loop_recommendations_position ON loop_recommendations(user_id, position);
CREATE INDEX IF NOT EXISTS idx_loop_recommendations_generated_at ON loop_recommendations(generated_at DESC);

-- Enable Row Level Security
ALTER TABLE loop_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_interest_graph ENABLE ROW LEVEL SECURITY;
ALTER TABLE loop_recommendations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for loop_interactions
CREATE POLICY "Users can view own interactions"
  ON loop_interactions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own interactions"
  ON loop_interactions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anonymous users can insert interactions"
  ON loop_interactions
  FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);

CREATE POLICY "Admins can view all interactions"
  ON loop_interactions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- RLS Policies for user_interest_graph
CREATE POLICY "Users can view own interest graph"
  ON user_interest_graph
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own interest graph"
  ON user_interest_graph
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all interest graphs"
  ON user_interest_graph
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- RLS Policies for loop_recommendations
CREATE POLICY "Users can view own recommendations"
  ON loop_recommendations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own recommendations"
  ON loop_recommendations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage recommendations"
  ON loop_recommendations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can manage all recommendations"
  ON loop_recommendations
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Function: Update user interest graph based on interactions
CREATE OR REPLACE FUNCTION update_user_interest_graph(
  p_user_id uuid,
  p_content_id uuid,
  p_interaction_type text,
  p_completion_rate numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_score_delta numeric;
  v_creator_id uuid;
BEGIN
  -- Calculate score delta based on interaction type
  v_score_delta := CASE p_interaction_type
    WHEN 'complete' THEN 10
    WHEN 'rewatch' THEN 8
    WHEN 'like' THEN 5
    WHEN 'comment' THEN 7
    WHEN 'share' THEN 9
    WHEN 'profile_visit' THEN 6
    WHEN 'play' THEN GREATEST(p_completion_rate / 10, 1)
    WHEN 'skip' THEN -3
    WHEN 'unlike' THEN -5
    ELSE 0
  END;

  -- Get creator ID
  SELECT user_id INTO v_creator_id
  FROM content_uploads
  WHERE id = p_content_id;

  -- Insert or update interest graph
  INSERT INTO user_interest_graph (user_id, interest_scores, creator_preferences, last_updated)
  VALUES (
    p_user_id,
    jsonb_build_object(p_content_id::text, v_score_delta),
    jsonb_build_object(v_creator_id::text, v_score_delta),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    interest_scores = COALESCE(user_interest_graph.interest_scores, '{}'::jsonb) || 
      jsonb_build_object(
        p_content_id::text, 
        COALESCE((user_interest_graph.interest_scores->>p_content_id::text)::numeric, 0) + v_score_delta
      ),
    creator_preferences = COALESCE(user_interest_graph.creator_preferences, '{}'::jsonb) || 
      jsonb_build_object(
        v_creator_id::text,
        COALESCE((user_interest_graph.creator_preferences->>v_creator_id::text)::numeric, 0) + v_score_delta
      ),
    last_updated = now();
END;
$$;

-- Function: Get smart loop feed for a user
CREATE OR REPLACE FUNCTION get_smart_loop_feed(
  p_user_id uuid,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  content_id uuid,
  recommendation_score numeric,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_has_history boolean;
BEGIN
  -- Check if user has interaction history
  SELECT EXISTS (
    SELECT 1 FROM loop_interactions
    WHERE user_id = p_user_id
    LIMIT 1
  ) INTO v_has_history;

  -- If user has no history, return trending/popular content
  IF NOT v_has_history THEN
    RETURN QUERY
    SELECT 
      cu.id,
      COALESCE(COUNT(DISTINCT li.id)::numeric * 10 + COUNT(DISTINCT l.id)::numeric * 5, 50) as score,
      'Trending content' as reason
    FROM content_uploads cu
    LEFT JOIN loop_interactions li ON li.content_id = cu.id AND li.created_at > now() - interval '7 days'
    LEFT JOIN likes l ON l.content_upload_id = cu.id
    WHERE cu.content_type = 'short_clip'
      AND cu.status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM loop_interactions li2
        WHERE li2.user_id = p_user_id
          AND li2.content_id = cu.id
          AND li2.interaction_type IN ('play', 'skip')
      )
    GROUP BY cu.id
    ORDER BY score DESC
    LIMIT p_limit
    OFFSET p_offset;
  ELSE
    -- Return personalized recommendations
    RETURN QUERY
    WITH user_interests AS (
      SELECT 
        (interest_scores)::jsonb as scores,
        (creator_preferences)::jsonb as creators
      FROM user_interest_graph
      WHERE user_id = p_user_id
    ),
    watched_content AS (
      SELECT DISTINCT content_id
      FROM loop_interactions
      WHERE user_id = p_user_id
        AND interaction_type IN ('play', 'skip', 'complete')
        AND created_at > now() - interval '7 days'
    )
    SELECT 
      cu.id,
      CASE
        WHEN ui.creators ? cu.user_id::text THEN 
          COALESCE((ui.creators->>cu.user_id::text)::numeric, 0) + 50
        ELSE 
          COALESCE(COUNT(DISTINCT li.id)::numeric * 2, 30)
      END as score,
      CASE
        WHEN ui.creators ? cu.user_id::text THEN 'From creators you like'
        ELSE 'Recommended for you'
      END as reason
    FROM content_uploads cu
    CROSS JOIN user_interests ui
    LEFT JOIN loop_interactions li ON li.content_id = cu.id AND li.created_at > now() - interval '3 days'
    WHERE cu.content_type = 'short_clip'
      AND cu.status = 'approved'
      AND cu.id NOT IN (SELECT content_id FROM watched_content)
    GROUP BY cu.id, cu.user_id, ui.creators, ui.scores
    ORDER BY score DESC
    LIMIT p_limit
    OFFSET p_offset;
  END IF;
END;
$$;