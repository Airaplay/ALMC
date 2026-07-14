/*
  # Create Collaboration Unlock System

  ## Overview
  Creates tables and functions to support Treat-based unlocking of additional collaboration matches.

  ## Tables Created
  1. collaboration_unlock_settings - Admin-configurable settings for unlock feature
     - Singleton table with single row for global settings
     - Controls number of free matches, unlock cost, and feature enable/disable

  2. collaboration_unlocks - Tracks which users have unlocked matches
     - Records user unlock purchases per rotation period
     - Automatically resets when matches rotate every 6 hours

  ## Security
  - RLS enabled on all tables
  - Admin-only write access to settings
  - Users can only view their own unlock records
  - Service role can insert unlock records

  ## Indexes
  - Performance indexes for common queries
  - Composite indexes for user + rotation lookups
*/

-- Create collaboration_unlock_settings table (singleton)
CREATE TABLE IF NOT EXISTS collaboration_unlock_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_enabled boolean NOT NULL DEFAULT true,
  free_matches_count integer NOT NULL DEFAULT 3 CHECK (free_matches_count >= 1 AND free_matches_count <= 10),
  unlock_cost_treats integer NOT NULL DEFAULT 10 CHECK (unlock_cost_treats >= 1 AND unlock_cost_treats <= 1000),
  max_unlockable_matches integer NOT NULL DEFAULT 1 CHECK (max_unlockable_matches >= 1 AND max_unlockable_matches <= 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  singleton_key boolean NOT NULL DEFAULT true UNIQUE,
  CONSTRAINT enforce_singleton CHECK (singleton_key = true)
);

-- Create collaboration_unlocks table
CREATE TABLE IF NOT EXISTS collaboration_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  rotation_period timestamptz NOT NULL,
  unlocked_count integer NOT NULL DEFAULT 1 CHECK (unlocked_count > 0),
  treat_cost integer NOT NULL CHECK (treat_cost > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, artist_id, rotation_period)
);

-- Create indexes for collaboration_unlock_settings
CREATE INDEX IF NOT EXISTS idx_collab_unlock_settings_updated_at
  ON collaboration_unlock_settings(updated_at DESC);

-- Create indexes for collaboration_unlocks
CREATE INDEX IF NOT EXISTS idx_collab_unlocks_user_id
  ON collaboration_unlocks(user_id);
CREATE INDEX IF NOT EXISTS idx_collab_unlocks_artist_id
  ON collaboration_unlocks(artist_id);
CREATE INDEX IF NOT EXISTS idx_collab_unlocks_rotation_period
  ON collaboration_unlocks(rotation_period DESC);
CREATE INDEX IF NOT EXISTS idx_collab_unlocks_user_rotation
  ON collaboration_unlocks(user_id, rotation_period);
CREATE INDEX IF NOT EXISTS idx_collab_unlocks_created_at
  ON collaboration_unlocks(created_at DESC);

-- Enable Row Level Security
ALTER TABLE collaboration_unlock_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_unlocks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for collaboration_unlock_settings
-- Everyone can view settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'collaboration_unlock_settings'
    AND policyname = 'Anyone can view collaboration unlock settings'
  ) THEN
    CREATE POLICY "Anyone can view collaboration unlock settings"
    ON collaboration_unlock_settings
    FOR SELECT
    TO authenticated, anon
    USING (true);
  END IF;
END $$;

-- Only admins can modify settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'collaboration_unlock_settings'
    AND policyname = 'Admins can modify collaboration unlock settings'
  ) THEN
    CREATE POLICY "Admins can modify collaboration unlock settings"
    ON collaboration_unlock_settings
    FOR ALL
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid()
        AND role = 'admin'
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid()
        AND role = 'admin'
      )
    );
  END IF;
END $$;

-- RLS Policies for collaboration_unlocks
-- Users can view their own unlocks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'collaboration_unlocks'
    AND policyname = 'Users can view their own collaboration unlocks'
  ) THEN
    CREATE POLICY "Users can view their own collaboration unlocks"
    ON collaboration_unlocks
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());
  END IF;
END $$;

-- Admins can view all unlocks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'collaboration_unlocks'
    AND policyname = 'Admins can view all collaboration unlocks'
  ) THEN
    CREATE POLICY "Admins can view all collaboration unlocks"
    ON collaboration_unlocks
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid()
        AND role = 'admin'
      )
    );
  END IF;
END $$;

-- Service role can insert unlocks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'collaboration_unlocks'
    AND policyname = 'Service role can insert collaboration unlocks'
  ) THEN
    CREATE POLICY "Service role can insert collaboration unlocks"
    ON collaboration_unlocks
    FOR INSERT
    TO service_role
    WITH CHECK (true);
  END IF;
END $$;

-- Insert default settings
INSERT INTO collaboration_unlock_settings (
  is_enabled,
  free_matches_count,
  unlock_cost_treats,
  max_unlockable_matches,
  singleton_key
)
VALUES (
  true,
  3,
  10,
  1,
  true
)
ON CONFLICT (singleton_key) DO NOTHING;

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_collaboration_unlock_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_collaboration_unlock_settings_updated_at
  ON collaboration_unlock_settings;
CREATE TRIGGER trigger_update_collaboration_unlock_settings_updated_at
  BEFORE UPDATE ON collaboration_unlock_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_collaboration_unlock_settings_updated_at();

-- Add helpful comments
COMMENT ON TABLE collaboration_unlock_settings IS 'Admin-configurable settings for collaboration match unlock feature. Singleton table.';
COMMENT ON TABLE collaboration_unlocks IS 'Tracks which users have unlocked additional collaboration matches for each rotation period.';
COMMENT ON COLUMN collaboration_unlock_settings.free_matches_count IS 'Number of matches shown for free (default: 3)';
COMMENT ON COLUMN collaboration_unlock_settings.unlock_cost_treats IS 'Cost in Treats to unlock additional matches (default: 10)';
COMMENT ON COLUMN collaboration_unlock_settings.max_unlockable_matches IS 'Maximum number of additional matches that can be unlocked (default: 1)';
COMMENT ON COLUMN collaboration_unlocks.rotation_period IS 'Timestamp of the rotation period start (matches refresh every 6 hours)';
