/*
  # Content Section Thresholds Management System

  This migration creates a flexible system for admins to control play count thresholds
  for different content sections independently.

  ## New Tables

  1. **content_section_thresholds**
     - Stores configurable thresholds for each content section
     - Admin can update thresholds without affecting other sections
     - Each section has independent min_play_count requirement
     - Includes metadata for admin tracking

  ## Sections Managed

  - featured_artists: Featured Artists section
  - global_trending: Global Trending songs tab
  - trending_near_you: Trending Near You tab
  - blowing_up: Tracks Blowing Up section
  - new_releases: New Releases section
  - trending_albums: Trending Albums section

  ## Security

  - RLS enabled
  - Public read access (for frontend to check thresholds)
  - Admin-only write access
  - Audit trail with updated_by and updated_at

  ## Benefits

  - Independent threshold control per section
  - No code changes needed to adjust visibility
  - Quality control at section level
  - Perfect for app scaling (start low, increase as content grows)
*/

-- ============================================================================
-- 1. CREATE: content_section_thresholds table
-- ============================================================================
CREATE TABLE IF NOT EXISTS content_section_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Section identification
  section_key text UNIQUE NOT NULL,
  section_name text NOT NULL,
  section_description text,

  -- Threshold configuration
  min_play_count integer NOT NULL DEFAULT 0 CHECK (min_play_count >= 0),

  -- Additional filters (optional, can be null for sections that don't use them)
  min_like_count integer DEFAULT 0 CHECK (min_like_count >= 0),
  time_window_days integer DEFAULT NULL CHECK (time_window_days IS NULL OR time_window_days > 0),

  -- Status
  is_enabled boolean DEFAULT true,

  -- Audit fields
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),

  -- Metadata
  notes text
);

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_content_section_thresholds_section_key
  ON content_section_thresholds(section_key);

CREATE INDEX IF NOT EXISTS idx_content_section_thresholds_enabled
  ON content_section_thresholds(is_enabled) WHERE is_enabled = true;

-- ============================================================================
-- 2. INSERT: Default threshold configurations
-- ============================================================================
INSERT INTO content_section_thresholds (
  section_key,
  section_name,
  section_description,
  min_play_count,
  min_like_count,
  time_window_days,
  is_enabled,
  notes
) VALUES
  (
    'featured_artists',
    'Featured Artists',
    'Artists featured on the home screen',
    100,
    10,
    NULL,
    true,
    'Higher threshold for premium placement'
  ),
  (
    'global_trending',
    'Global Trending',
    'Trending songs worldwide (no location filter)',
    50,
    5,
    14,
    true,
    'Songs trending globally in last 14 days'
  ),
  (
    'trending_near_you',
    'Trending Near You',
    'Songs trending in user''s country',
    30,
    3,
    14,
    true,
    'Country-specific trending with lower threshold'
  ),
  (
    'blowing_up',
    'Tracks Blowing Up',
    'Songs gaining rapid popularity',
    25,
    2,
    7,
    true,
    'Recent viral tracks in last 7 days'
  ),
  (
    'new_releases',
    'New Releases',
    'Recently uploaded songs',
    10,
    1,
    30,
    true,
    'Songs uploaded in last 30 days'
  ),
  (
    'trending_albums',
    'Trending Albums',
    'Albums with highest engagement',
    75,
    8,
    14,
    true,
    'Albums trending in last 14 days'
  )
ON CONFLICT (section_key) DO NOTHING;

-- ============================================================================
-- 3. RLS POLICIES
-- ============================================================================
ALTER TABLE content_section_thresholds ENABLE ROW LEVEL SECURITY;

-- Public read access (frontend needs to check thresholds)
CREATE POLICY "Public read content section thresholds"
  ON content_section_thresholds FOR SELECT
  TO public
  USING (true);

-- Admin insert
CREATE POLICY "Admin insert content section thresholds"
  ON content_section_thresholds FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admin update
CREATE POLICY "Admin update content section thresholds"
  ON content_section_thresholds FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admin delete (rare, but available)
CREATE POLICY "Admin delete content section thresholds"
  ON content_section_thresholds FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ============================================================================
-- 4. HELPER FUNCTIONS
-- ============================================================================

-- Function to get threshold for a specific section
CREATE OR REPLACE FUNCTION get_section_threshold(section_key_param text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  threshold_value integer;
BEGIN
  SELECT min_play_count INTO threshold_value
  FROM content_section_thresholds
  WHERE section_key = section_key_param
    AND is_enabled = true;

  -- Return 0 if section not found (no threshold)
  RETURN COALESCE(threshold_value, 0);
END;
$$;

-- Function to check if content meets section threshold
CREATE OR REPLACE FUNCTION meets_section_threshold(
  section_key_param text,
  play_count_param integer,
  like_count_param integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  threshold_config record;
BEGIN
  SELECT
    min_play_count,
    min_like_count,
    is_enabled
  INTO threshold_config
  FROM content_section_thresholds
  WHERE section_key = section_key_param;

  -- If section not found or disabled, allow all content
  IF NOT FOUND OR threshold_config.is_enabled = false THEN
    RETURN true;
  END IF;

  -- Check if content meets thresholds
  RETURN play_count_param >= threshold_config.min_play_count
     AND like_count_param >= threshold_config.min_like_count;
END;
$$;

-- Function for admin to update threshold
CREATE OR REPLACE FUNCTION admin_update_section_threshold(
  section_key_param text,
  min_play_count_param integer,
  min_like_count_param integer DEFAULT NULL,
  time_window_days_param integer DEFAULT NULL,
  is_enabled_param boolean DEFAULT NULL,
  notes_param text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  admin_check boolean;
  updated_row record;
BEGIN
  -- Verify admin role
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  ) INTO admin_check;

  IF NOT admin_check THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Update threshold
  UPDATE content_section_thresholds
  SET
    min_play_count = COALESCE(min_play_count_param, min_play_count),
    min_like_count = COALESCE(min_like_count_param, min_like_count),
    time_window_days = COALESCE(time_window_days_param, time_window_days),
    is_enabled = COALESCE(is_enabled_param, is_enabled),
    notes = COALESCE(notes_param, notes),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE section_key = section_key_param
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Section not found: %', section_key_param;
  END IF;

  RETURN json_build_object(
    'success', true,
    'section_key', updated_row.section_key,
    'section_name', updated_row.section_name,
    'min_play_count', updated_row.min_play_count,
    'min_like_count', updated_row.min_like_count,
    'time_window_days', updated_row.time_window_days,
    'is_enabled', updated_row.is_enabled,
    'updated_at', updated_row.updated_at
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_section_threshold(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION meets_section_threshold(text, integer, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION admin_update_section_threshold(text, integer, integer, integer, boolean, text) TO authenticated;

-- ============================================================================
-- 5. UPDATE TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION update_content_section_thresholds_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_content_section_thresholds_timestamp
  BEFORE UPDATE ON content_section_thresholds
  FOR EACH ROW
  EXECUTE FUNCTION update_content_section_thresholds_updated_at();

-- ============================================================================
-- 6. COMMENTS
-- ============================================================================
COMMENT ON TABLE content_section_thresholds IS 'Configurable play count thresholds for different content sections';
COMMENT ON COLUMN content_section_thresholds.section_key IS 'Unique identifier for the section';
COMMENT ON COLUMN content_section_thresholds.min_play_count IS 'Minimum play count required for content to appear in this section';
COMMENT ON COLUMN content_section_thresholds.min_like_count IS 'Minimum like count required (optional additional filter)';
COMMENT ON COLUMN content_section_thresholds.time_window_days IS 'Time window in days for counting plays (NULL = all time)';
COMMENT ON FUNCTION get_section_threshold(text) IS 'Get minimum play count threshold for a section';
COMMENT ON FUNCTION meets_section_threshold(text, integer, integer) IS 'Check if content meets section threshold requirements';
COMMENT ON FUNCTION admin_update_section_threshold(text, integer, integer, integer, boolean, text) IS 'Admin function to update section thresholds';
