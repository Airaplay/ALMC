/*
  # Collaboration Match Rotation System

  1. New Tables
    - `collaboration_match_pool`
      - Stores pool of up to 20 matches per artist
      - Regenerated every 24-48 hours
    - `collaboration_rotation_state`
      - Tracks current 4 visible matches
      - Stores last refresh timestamp
      - Auto-refreshes every 6 hours

  2. Features
    - 4 matches shown at a time from pool of 20
    - Auto-refresh every 6 hours with shuffle
    - Pool regenerated periodically for freshness
    - Prevents showing same matches repeatedly

  3. Security
    - Enable RLS on both tables
    - Users can only see their own rotation state
*/

-- Create collaboration match pool table
CREATE TABLE IF NOT EXISTS collaboration_match_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  matched_artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  compatibility_score integer NOT NULL,
  match_data jsonb NOT NULL,
  pool_position integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(artist_id, matched_artist_id)
);

-- Create rotation state table
CREATE TABLE IF NOT EXISTS collaboration_rotation_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  last_refresh_at timestamptz NOT NULL DEFAULT now(),
  next_refresh_at timestamptz NOT NULL DEFAULT (now() + interval '6 hours'),
  visible_match_ids uuid[] NOT NULL DEFAULT '{}',
  pool_regenerated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(artist_id)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_match_pool_artist ON collaboration_match_pool(artist_id);
CREATE INDEX IF NOT EXISTS idx_match_pool_matched_artist ON collaboration_match_pool(matched_artist_id);
CREATE INDEX IF NOT EXISTS idx_rotation_state_artist ON collaboration_rotation_state(artist_id);
CREATE INDEX IF NOT EXISTS idx_rotation_state_next_refresh ON collaboration_rotation_state(next_refresh_at);

-- Enable RLS
ALTER TABLE collaboration_match_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_rotation_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies for match pool
CREATE POLICY "Users can view their own match pool"
  ON collaboration_match_pool FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM artist_profiles
      WHERE artist_profiles.id = collaboration_match_pool.artist_id
      AND artist_profiles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own matches"
  ON collaboration_match_pool FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM artist_profiles
      WHERE artist_profiles.id = collaboration_match_pool.artist_id
      AND artist_profiles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own matches"
  ON collaboration_match_pool FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM artist_profiles
      WHERE artist_profiles.id = collaboration_match_pool.artist_id
      AND artist_profiles.user_id = auth.uid()
    )
  );

-- RLS Policies for rotation state
CREATE POLICY "Users can view their own rotation state"
  ON collaboration_rotation_state FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM artist_profiles
      WHERE artist_profiles.id = collaboration_rotation_state.artist_id
      AND artist_profiles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own rotation state"
  ON collaboration_rotation_state FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM artist_profiles
      WHERE artist_profiles.id = collaboration_rotation_state.artist_id
      AND artist_profiles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own rotation state"
  ON collaboration_rotation_state FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM artist_profiles
      WHERE artist_profiles.id = collaboration_rotation_state.artist_id
      AND artist_profiles.user_id = auth.uid()
    )
  );

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_collaboration_rotation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE TRIGGER update_collaboration_rotation_state_updated_at
  BEFORE UPDATE ON collaboration_rotation_state
  FOR EACH ROW
  EXECUTE FUNCTION update_collaboration_rotation_updated_at();
