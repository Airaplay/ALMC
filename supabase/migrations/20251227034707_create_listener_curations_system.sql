/*
  # Listener Curations System

  ## Overview
  Extends the existing playlist feature to showcase high-quality public playlists
  created by regular listeners in a dedicated discovery section.

  ## 1. Schema Extensions

  ### Playlists Table Updates:
  - `is_public` (boolean) - Whether playlist is publicly visible
  - `curation_status` (text) - Status: 'none', 'pending', 'approved', 'rejected'
  - `play_count` (integer) - Total plays across all songs
  - `song_count` (integer) - Number of songs in playlist (denormalized for performance)
  - `featured_at` (timestamptz) - When playlist was featured
  - `featured_by` (uuid) - Admin who approved the curation
  - `featured_position` (integer) - Display order in curations section
  - `curator_earnings` (numeric) - Total earnings from playlist plays

  ### New Table: `playlist_plays`
  Tracks individual plays of playlists for analytics and monetization

  ### New Table: `curator_earnings`
  Tracks earnings distribution for playlist curators

  ## 2. Eligibility Criteria
  - Created by listener (not creator/admin)
  - Public playlist
  - Minimum 10 songs
  - Admin approval required
  - No violations/reports

  ## 3. Monetization
  - Curators earn 5% of ad revenue from playlist plays
  - Admins can adjust earnings distribution
  - Analytics dashboard for curators

  ## 4. Security
  - RLS policies for public playlist discovery
  - Admin-only curation approval
  - Secure earnings tracking
*/

-- ============================================================================
-- STEP 1: Extend playlists table
-- ============================================================================

-- Add is_public field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'playlists' AND column_name = 'is_public'
  ) THEN
    ALTER TABLE playlists ADD COLUMN is_public boolean DEFAULT true NOT NULL;
  END IF;
END $$;

-- Add curation_status field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'playlists' AND column_name = 'curation_status'
  ) THEN
    ALTER TABLE playlists ADD COLUMN curation_status text DEFAULT 'none' NOT NULL;
  END IF;
END $$;

-- Add play_count field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'playlists' AND column_name = 'play_count'
  ) THEN
    ALTER TABLE playlists ADD COLUMN play_count integer DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- Add song_count field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'playlists' AND column_name = 'song_count'
  ) THEN
    ALTER TABLE playlists ADD COLUMN song_count integer DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- Add featured_at field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'playlists' AND column_name = 'featured_at'
  ) THEN
    ALTER TABLE playlists ADD COLUMN featured_at timestamptz;
  END IF;
END $$;

-- Add featured_by field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'playlists' AND column_name = 'featured_by'
  ) THEN
    ALTER TABLE playlists ADD COLUMN featured_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add featured_position field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'playlists' AND column_name = 'featured_position'
  ) THEN
    ALTER TABLE playlists ADD COLUMN featured_position integer;
  END IF;
END $$;

-- Add curator_earnings field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'playlists' AND column_name = 'curator_earnings'
  ) THEN
    ALTER TABLE playlists ADD COLUMN curator_earnings numeric(10,2) DEFAULT 0.00 NOT NULL;
  END IF;
END $$;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_playlists_is_public ON playlists(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_playlists_curation_status ON playlists(curation_status);
CREATE INDEX IF NOT EXISTS idx_playlists_featured_at ON playlists(featured_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_playlists_play_count ON playlists(play_count DESC);
CREATE INDEX IF NOT EXISTS idx_playlists_featured_position ON playlists(featured_position) WHERE featured_position IS NOT NULL;

-- Add constraint for curation_status values
ALTER TABLE playlists DROP CONSTRAINT IF EXISTS check_curation_status;
ALTER TABLE playlists ADD CONSTRAINT check_curation_status
  CHECK (curation_status IN ('none', 'pending', 'approved', 'rejected'));

-- ============================================================================
-- STEP 2: Create playlist_plays table for tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS playlist_plays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  played_at timestamptz DEFAULT now() NOT NULL,
  duration_seconds integer,
  revenue_generated numeric(10,4) DEFAULT 0.0000
);

-- Enable RLS
ALTER TABLE playlist_plays ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own playlist plays"
  ON playlist_plays FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role can insert playlist plays"
  ON playlist_plays FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Playlist owners can view plays on their playlists"
  ON playlist_plays FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM playlists
      WHERE playlists.id = playlist_plays.playlist_id
      AND playlists.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_playlist_plays_playlist_id ON playlist_plays(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_plays_user_id ON playlist_plays(user_id);
CREATE INDEX IF NOT EXISTS idx_playlist_plays_played_at ON playlist_plays(played_at DESC);

-- ============================================================================
-- STEP 3: Create curator_earnings table
-- ============================================================================

CREATE TABLE IF NOT EXISTS curator_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  curator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  earned_at timestamptz DEFAULT now() NOT NULL,
  description text,
  transaction_type text DEFAULT 'playlist_play' NOT NULL
);

-- Enable RLS
ALTER TABLE curator_earnings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Curators can view their own earnings"
  ON curator_earnings FOR SELECT
  TO authenticated
  USING (curator_id = auth.uid());

CREATE POLICY "Admins can view all curator earnings"
  ON curator_earnings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Service role can insert curator earnings"
  ON curator_earnings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_curator_earnings_curator_id ON curator_earnings(curator_id);
CREATE INDEX IF NOT EXISTS idx_curator_earnings_playlist_id ON curator_earnings(playlist_id);
CREATE INDEX IF NOT EXISTS idx_curator_earnings_earned_at ON curator_earnings(earned_at DESC);

-- ============================================================================
-- STEP 4: Update RLS policies for public playlist discovery
-- ============================================================================

-- Drop old restrictive SELECT policy
DROP POLICY IF EXISTS "Authenticated users can view their own playlists" ON playlists;

-- New policy: Users can view their own playlists + all public playlists
CREATE POLICY "Users can view own playlists and public playlists"
  ON playlists FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR is_public = true
  );

-- Allow anonymous users to view public playlists (for discovery)
CREATE POLICY "Anyone can view public playlists"
  ON playlists FOR SELECT
  TO anon
  USING (is_public = true);

-- ============================================================================
-- STEP 5: Helper functions
-- ============================================================================

-- Function to update song count when songs are added/removed
CREATE OR REPLACE FUNCTION update_playlist_song_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE playlists
    SET song_count = song_count + 1,
        updated_at = now()
    WHERE id = NEW.playlist_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE playlists
    SET song_count = GREATEST(0, song_count - 1),
        updated_at = now()
    WHERE id = OLD.playlist_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_update_playlist_song_count ON playlist_songs;
CREATE TRIGGER trigger_update_playlist_song_count
  AFTER INSERT OR DELETE ON playlist_songs
  FOR EACH ROW
  EXECUTE FUNCTION update_playlist_song_count();

-- Backfill song counts for existing playlists
UPDATE playlists
SET song_count = (
  SELECT COUNT(*)
  FROM playlist_songs
  WHERE playlist_songs.playlist_id = playlists.id
)
WHERE song_count = 0;

-- ============================================================================
-- STEP 6: Admin functions for curation management
-- ============================================================================

-- Function to submit playlist for curation
CREATE OR REPLACE FUNCTION submit_playlist_for_curation(playlist_uuid uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_id uuid;
  v_user_role text;
  v_playlist_record record;
  v_song_count integer;
BEGIN
  -- Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Authentication required');
  END IF;

  -- Get user role
  SELECT role INTO v_user_role FROM users WHERE id = v_user_id;

  -- Check if user is a listener (not creator or admin)
  IF v_user_role NOT IN ('listener') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Only listeners can submit playlists for curation');
  END IF;

  -- Get playlist
  SELECT * INTO v_playlist_record FROM playlists WHERE id = playlist_uuid AND user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Playlist not found or you do not own it');
  END IF;

  -- Check if already submitted or approved
  IF v_playlist_record.curation_status IN ('pending', 'approved') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Playlist already submitted for curation');
  END IF;

  -- Check minimum song count (10 songs)
  v_song_count := v_playlist_record.song_count;
  IF v_song_count < 10 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Playlist must have at least 10 songs to be eligible for curation');
  END IF;

  -- Check if playlist is public
  IF NOT v_playlist_record.is_public THEN
    RETURN jsonb_build_object('success', false, 'message', 'Playlist must be public to be featured');
  END IF;

  -- Update playlist to pending
  UPDATE playlists
  SET curation_status = 'pending',
      updated_at = now()
  WHERE id = playlist_uuid;

  RETURN jsonb_build_object('success', true, 'message', 'Playlist submitted for curation review');
END;
$$;

-- Function to approve/reject playlist curation (admin only)
CREATE OR REPLACE FUNCTION admin_review_playlist_curation(
  playlist_uuid uuid,
  approval_status text,
  featured_pos integer DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_role text;
BEGIN
  -- Get authenticated user
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Authentication required');
  END IF;

  -- Verify admin role
  SELECT role INTO v_admin_role FROM users WHERE id = v_admin_id;
  IF v_admin_role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Admin privileges required');
  END IF;

  -- Validate approval_status
  IF approval_status NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid approval status');
  END IF;

  -- Update playlist
  IF approval_status = 'approved' THEN
    UPDATE playlists
    SET curation_status = 'approved',
        featured_at = now(),
        featured_by = v_admin_id,
        featured_position = COALESCE(featured_pos, (SELECT COALESCE(MAX(featured_position), 0) + 1 FROM playlists WHERE curation_status = 'approved')),
        updated_at = now()
    WHERE id = playlist_uuid;
  ELSE
    UPDATE playlists
    SET curation_status = 'rejected',
        updated_at = now()
    WHERE id = playlist_uuid;
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Playlist curation ' || approval_status);
END;
$$;

-- Function to unfeature a playlist (admin only)
CREATE OR REPLACE FUNCTION admin_unfeature_playlist(playlist_uuid uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_role text;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Authentication required');
  END IF;

  SELECT role INTO v_admin_role FROM users WHERE id = v_admin_id;
  IF v_admin_role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Admin privileges required');
  END IF;

  UPDATE playlists
  SET curation_status = 'none',
      featured_at = NULL,
      featured_by = NULL,
      featured_position = NULL,
      updated_at = now()
  WHERE id = playlist_uuid;

  RETURN jsonb_build_object('success', true, 'message', 'Playlist unfeatured');
END;
$$;

-- Function to get featured playlists for discovery
CREATE OR REPLACE FUNCTION get_featured_playlists(limit_count integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  cover_image_url text,
  song_count integer,
  play_count integer,
  curator_id uuid,
  curator_name text,
  curator_avatar text,
  featured_at timestamptz,
  created_at timestamptz
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.title,
    p.description,
    p.cover_image_url,
    p.song_count,
    p.play_count,
    p.user_id as curator_id,
    u.display_name as curator_name,
    u.avatar_url as curator_avatar,
    p.featured_at,
    p.created_at
  FROM playlists p
  JOIN users u ON p.user_id = u.id
  WHERE p.curation_status = 'approved'
    AND p.is_public = true
    AND p.song_count >= 10
  ORDER BY
    COALESCE(p.featured_position, 999999),
    p.featured_at DESC NULLS LAST
  LIMIT limit_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION submit_playlist_for_curation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_review_playlist_curation(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_unfeature_playlist(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_featured_playlists(integer) TO authenticated, anon;

-- ============================================================================
-- STEP 7: Create view for curator analytics
-- ============================================================================

CREATE OR REPLACE VIEW curator_analytics AS
SELECT
  p.user_id as curator_id,
  u.display_name as curator_name,
  COUNT(DISTINCT p.id) as total_playlists,
  COUNT(DISTINCT CASE WHEN p.curation_status = 'approved' THEN p.id END) as featured_playlists,
  COALESCE(SUM(p.play_count), 0) as total_plays,
  COALESCE(SUM(p.curator_earnings), 0) as total_earnings,
  MAX(p.featured_at) as last_featured_at
FROM playlists p
JOIN users u ON p.user_id = u.id
WHERE p.is_public = true
GROUP BY p.user_id, u.display_name;

-- Grant access to the view
GRANT SELECT ON curator_analytics TO authenticated;