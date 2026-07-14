/*
  # Top 1% Listeners Club System

  ## Overview
  Creates a system to track and display which artists a user is in the top 1% of listeners for,
  based on play counts and Treat contributions. This gamifies loyalty and creates status for super fans.

  ## New Tables

  ### `artist_listener_stats`
  - `id` (uuid, primary key)
  - `artist_id` (uuid, references artist_profiles) - The artist
  - `user_id` (uuid, references users) - The listener
  - `total_plays` (integer, default 0) - Total plays of artist's content
  - `total_treats_sent` (integer, default 0) - Total Treats sent to artist
  - `loyalty_score` (integer, default 0) - Calculated score (plays + treats weighted)
  - `rank_position` (integer) - User's rank among artist's listeners
  - `is_top_1_percent` (boolean, default false) - Whether user is in top 1%
  - `last_updated` (timestamptz)
  - `created_at` (timestamptz)

  ### `top_listeners_snapshots`
  - `id` (uuid, primary key)
  - `artist_id` (uuid, references artist_profiles)
  - `snapshot_date` (date) - Date of snapshot
  - `total_listeners` (integer) - Total unique listeners for artist
  - `top_1_percent_threshold` (integer) - Loyalty score needed for top 1%
  - `created_at` (timestamptz)

  ## Functions

  ### `update_listener_stats(p_user_id uuid, p_artist_id uuid, p_plays_increment integer, p_treats_increment integer)`
  Updates listener stats when user plays content or sends Treats

  ### `calculate_top_1_percent_rankings(p_artist_id uuid)`
  Calculates and updates top 1% status for all listeners of an artist

  ### `refresh_all_top_1_percent_rankings()`
  Recalculates rankings for all artists (scheduled job)

  ### `get_user_top_1_percent_artists(p_user_id uuid)`
  Returns all artists where user is in top 1% with rank details

  ## Security
  - Enable RLS on all tables
  - Users can read their own stats
  - Only system functions can update rankings
  - Public read access for displaying badges on profiles

  ## Indexes
  - Composite index on (artist_id, user_id) for fast lookups
  - Index on loyalty_score for ranking calculations
  - Index on is_top_1_percent for quick filtering
*/

-- Create artist_listener_stats table
CREATE TABLE IF NOT EXISTS artist_listener_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_plays integer DEFAULT 0 CHECK (total_plays >= 0),
  total_treats_sent integer DEFAULT 0 CHECK (total_treats_sent >= 0),
  loyalty_score integer DEFAULT 0 CHECK (loyalty_score >= 0),
  rank_position integer,
  is_top_1_percent boolean DEFAULT false,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(artist_id, user_id)
);

-- Create top_listeners_snapshots table
CREATE TABLE IF NOT EXISTS top_listeners_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  total_listeners integer DEFAULT 0,
  top_1_percent_threshold integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(artist_id, snapshot_date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_artist_listener_stats_artist_user ON artist_listener_stats(artist_id, user_id);
CREATE INDEX IF NOT EXISTS idx_artist_listener_stats_user ON artist_listener_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_artist_listener_stats_loyalty_score ON artist_listener_stats(artist_id, loyalty_score DESC);
CREATE INDEX IF NOT EXISTS idx_artist_listener_stats_top_1_percent ON artist_listener_stats(user_id, is_top_1_percent) WHERE is_top_1_percent = true;
CREATE INDEX IF NOT EXISTS idx_top_listeners_snapshots_artist_date ON top_listeners_snapshots(artist_id, snapshot_date DESC);

-- Enable RLS
ALTER TABLE artist_listener_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE top_listeners_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS Policies for artist_listener_stats
CREATE POLICY "Users can view their own listener stats"
  ON artist_listener_stats FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view top 1% status for public profiles"
  ON artist_listener_stats FOR SELECT
  TO authenticated, anon
  USING (is_top_1_percent = true);

-- RLS Policies for top_listeners_snapshots
CREATE POLICY "Anyone can view listener snapshots"
  ON top_listeners_snapshots FOR SELECT
  TO authenticated, anon
  USING (true);

-- Function: Update listener stats
CREATE OR REPLACE FUNCTION update_listener_stats(
  p_user_id uuid,
  p_artist_id uuid,
  p_plays_increment integer DEFAULT 0,
  p_treats_increment integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loyalty_score integer;
BEGIN
  -- Don't track if user is the artist themselves
  IF p_user_id = (SELECT user_id FROM artist_profiles WHERE id = p_artist_id) THEN
    RETURN;
  END IF;

  -- Calculate loyalty score (plays count as 1 point each, Treats as 10 points each)
  v_loyalty_score := p_plays_increment + (p_treats_increment * 10);

  -- Insert or update listener stats
  INSERT INTO artist_listener_stats (
    artist_id,
    user_id,
    total_plays,
    total_treats_sent,
    loyalty_score,
    last_updated
  ) VALUES (
    p_artist_id,
    p_user_id,
    p_plays_increment,
    p_treats_increment,
    v_loyalty_score,
    now()
  )
  ON CONFLICT (artist_id, user_id)
  DO UPDATE SET
    total_plays = artist_listener_stats.total_plays + p_plays_increment,
    total_treats_sent = artist_listener_stats.total_treats_sent + p_treats_increment,
    loyalty_score = artist_listener_stats.loyalty_score + v_loyalty_score,
    last_updated = now();
END;
$$;

-- Function: Calculate top 1% rankings for an artist
CREATE OR REPLACE FUNCTION calculate_top_1_percent_rankings(p_artist_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_listeners integer;
  v_top_1_percent_count integer;
  v_threshold_score integer;
BEGIN
  -- Count total unique listeners for this artist
  SELECT COUNT(*)
  INTO v_total_listeners
  FROM artist_listener_stats
  WHERE artist_id = p_artist_id;

  -- Calculate top 1% count (minimum 1 listener)
  v_top_1_percent_count := GREATEST(CEIL(v_total_listeners * 0.01), 1);

  -- Get the threshold score for top 1%
  SELECT COALESCE(MIN(loyalty_score), 0)
  INTO v_threshold_score
  FROM (
    SELECT loyalty_score
    FROM artist_listener_stats
    WHERE artist_id = p_artist_id
    ORDER BY loyalty_score DESC
    LIMIT v_top_1_percent_count
  ) top_scores;

  -- Update all listeners' top 1% status and rank
  WITH ranked_listeners AS (
    SELECT
      id,
      ROW_NUMBER() OVER (ORDER BY loyalty_score DESC, created_at ASC) as rank
    FROM artist_listener_stats
    WHERE artist_id = p_artist_id
  )
  UPDATE artist_listener_stats als
  SET
    rank_position = rl.rank,
    is_top_1_percent = (als.loyalty_score >= v_threshold_score AND rl.rank <= v_top_1_percent_count),
    last_updated = now()
  FROM ranked_listeners rl
  WHERE als.id = rl.id;

  -- Create snapshot
  INSERT INTO top_listeners_snapshots (
    artist_id,
    snapshot_date,
    total_listeners,
    top_1_percent_threshold
  ) VALUES (
    p_artist_id,
    CURRENT_DATE,
    v_total_listeners,
    v_threshold_score
  )
  ON CONFLICT (artist_id, snapshot_date)
  DO UPDATE SET
    total_listeners = v_total_listeners,
    top_1_percent_threshold = v_threshold_score;
END;
$$;

-- Function: Refresh all top 1% rankings (for scheduled jobs)
CREATE OR REPLACE FUNCTION refresh_all_top_1_percent_rankings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_artist RECORD;
BEGIN
  -- Loop through all artists who have listeners
  FOR v_artist IN
    SELECT DISTINCT artist_id
    FROM artist_listener_stats
  LOOP
    PERFORM calculate_top_1_percent_rankings(v_artist.artist_id);
  END LOOP;
END;
$$;

-- Function: Get user's top 1% artists
CREATE OR REPLACE FUNCTION get_user_top_1_percent_artists(p_user_id uuid)
RETURNS TABLE(
  artist_id uuid,
  artist_name text,
  artist_photo text,
  is_verified boolean,
  total_plays integer,
  total_treats_sent integer,
  loyalty_score integer,
  rank_position integer,
  total_listeners integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ap.id as artist_id,
    ap.stage_name as artist_name,
    ap.profile_photo_url as artist_photo,
    ap.is_verified,
    als.total_plays,
    als.total_treats_sent,
    als.loyalty_score,
    als.rank_position,
    (
      SELECT COUNT(*)::integer
      FROM artist_listener_stats als2
      WHERE als2.artist_id = ap.id
    ) as total_listeners
  FROM artist_listener_stats als
  JOIN artist_profiles ap ON ap.id = als.artist_id
  WHERE als.user_id = p_user_id
    AND als.is_top_1_percent = true
  ORDER BY als.loyalty_score DESC, als.rank_position ASC;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION update_listener_stats(uuid, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_top_1_percent_rankings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_all_top_1_percent_rankings() TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_top_1_percent_artists(uuid) TO authenticated, anon;

-- Create trigger to update rankings when stats change significantly
CREATE OR REPLACE FUNCTION trigger_ranking_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only recalculate if loyalty score changed by more than 10 points
  IF TG_OP = 'INSERT' OR (NEW.loyalty_score - OLD.loyalty_score >= 10) THEN
    PERFORM calculate_top_1_percent_rankings(NEW.artist_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_rankings_on_stats_change
  AFTER INSERT OR UPDATE OF loyalty_score ON artist_listener_stats
  FOR EACH ROW
  EXECUTE FUNCTION trigger_ranking_update();
