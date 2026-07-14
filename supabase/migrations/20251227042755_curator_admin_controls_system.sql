/*
  # Curator Admin Controls System

  ## Overview
  Comprehensive admin controls for managing Listener Curations system including:
  - Global enable/disable toggle
  - Minimum requirements configuration
  - Revenue split management
  - Featured playlists system
  - Per-playlist monetization control
  - Per-user monetization control
  - Analytics and reporting

  ## Features
  1. **Global Settings**
     - Enable/disable Listener Curations platform-wide
     - Minimum songs required for eligibility
     - Minimum song plays required
     - Revenue split percentage

  2. **Featured Playlists**
     - Manual featuring by admin
     - Featured order priority
     - Featured status independent of monetization

  3. **Monetization Controls**
     - Disable earnings for specific playlists
     - Disable earnings for specific users
     - Independent of playlist visibility

  4. **Analytics Views**
     - Top playlists by plays
     - Top playlists by engagement
     - Curator performance metrics

  ## Tables Created/Modified
  - curator_settings: Enhanced with new settings
  - featured_curated_playlists: Featured playlist management
  - curator_monetization_blocks: Block specific playlists/users

  ## Functions Created
  - admin_get_top_curated_playlists: Analytics
  - admin_feature_playlist: Feature management
  - admin_block_curator_monetization: Monetization control
*/

-- ============================================================================
-- STEP 1: Enhance curator_settings table
-- ============================================================================

-- Add new settings if not exists
DO $$
BEGIN
  -- Insert or update curator_revenue_split
  INSERT INTO curator_settings (setting_key, setting_value, updated_at)
  VALUES (
    'curator_revenue_split',
    jsonb_build_object(
      'enabled', true,
      'percentage', 5,
      'description', 'Percentage of ad revenue shared with curators'
    ),
    now()
  )
  ON CONFLICT (setting_key) DO NOTHING;

  -- Insert curator eligibility requirements
  INSERT INTO curator_settings (setting_key, setting_value, updated_at)
  VALUES (
    'curator_eligibility',
    jsonb_build_object(
      'min_songs', 10,
      'min_song_plays', 0,
      'description', 'Minimum requirements for playlist curation eligibility'
    ),
    now()
  )
  ON CONFLICT (setting_key) DO NOTHING;

  -- Insert global curator toggle
  INSERT INTO curator_settings (setting_key, setting_value, updated_at)
  VALUES (
    'curator_global_status',
    jsonb_build_object(
      'enabled', true,
      'description', 'Global enable/disable for Listener Curations system'
    ),
    now()
  )
  ON CONFLICT (setting_key) DO NOTHING;
END $$;

-- ============================================================================
-- STEP 2: Create featured curated playlists table
-- ============================================================================

CREATE TABLE IF NOT EXISTS featured_curated_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  featured_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  featured_order integer DEFAULT 0,
  featured_at timestamptz DEFAULT now() NOT NULL,
  unfeatured_at timestamptz,
  is_active boolean DEFAULT true,
  admin_notes text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE featured_curated_playlists ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view active featured playlists"
  ON featured_curated_playlists FOR SELECT
  TO authenticated, anon
  USING (is_active = true);

CREATE POLICY "Admins can manage featured playlists"
  ON featured_curated_playlists FOR ALL
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

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_featured_playlists_playlist ON featured_curated_playlists(playlist_id);
CREATE INDEX IF NOT EXISTS idx_featured_playlists_active ON featured_curated_playlists(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_featured_playlists_order ON featured_curated_playlists(featured_order) WHERE is_active = true;

-- Add unique constraint for active featured playlists
CREATE UNIQUE INDEX IF NOT EXISTS idx_featured_playlists_unique_active 
  ON featured_curated_playlists(playlist_id) 
  WHERE is_active = true;

-- ============================================================================
-- STEP 3: Create curator monetization blocks table
-- ============================================================================

CREATE TABLE IF NOT EXISTS curator_monetization_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_type text NOT NULL CHECK (block_type IN ('playlist', 'user')),
  playlist_id uuid REFERENCES playlists(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  block_reason text,
  blocked_at timestamptz DEFAULT now() NOT NULL,
  unblocked_at timestamptz,
  is_active boolean DEFAULT true,
  CHECK (
    (block_type = 'playlist' AND playlist_id IS NOT NULL AND user_id IS NULL) OR
    (block_type = 'user' AND user_id IS NOT NULL AND playlist_id IS NULL)
  )
);

-- Enable RLS
ALTER TABLE curator_monetization_blocks ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can view all monetization blocks"
  ON curator_monetization_blocks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage monetization blocks"
  ON curator_monetization_blocks FOR ALL
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

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_monetization_blocks_playlist ON curator_monetization_blocks(playlist_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_monetization_blocks_user ON curator_monetization_blocks(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_monetization_blocks_type ON curator_monetization_blocks(block_type);

-- ============================================================================
-- STEP 4: Create admin function to get top curated playlists
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_top_curated_playlists(
  p_sort_by text DEFAULT 'plays',
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  playlist_id uuid,
  playlist_title text,
  curator_id uuid,
  curator_name text,
  total_plays bigint,
  unique_listeners bigint,
  total_earnings numeric,
  avg_session_duration numeric,
  engagement_score numeric,
  curation_status text,
  is_featured boolean,
  is_monetization_blocked boolean,
  song_count integer,
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
    p.user_id,
    u.display_name,
    COALESCE(p.play_count, 0)::bigint as total_plays,
    COUNT(DISTINCT pls.listener_id)::bigint as unique_listeners,
    COALESCE(p.curator_earnings, 0) as total_earnings,
    COALESCE(AVG(pls.total_duration_seconds), 0) as avg_session_duration,
    (
      COALESCE(p.play_count, 0) * 1.0 +
      COUNT(DISTINCT pls.listener_id) * 5.0 +
      COALESCE(AVG(pls.total_duration_seconds), 0) / 60.0
    ) as engagement_score,
    p.curation_status,
    EXISTS (
      SELECT 1 FROM featured_curated_playlists fcp
      WHERE fcp.playlist_id = p.id AND fcp.is_active = true
    ) as is_featured,
    EXISTS (
      SELECT 1 FROM curator_monetization_blocks cmb
      WHERE cmb.playlist_id = p.id AND cmb.is_active = true
    ) as is_monetization_blocked,
    p.song_count,
    p.created_at
  FROM playlists p
  JOIN users u ON p.user_id = u.id
  LEFT JOIN playlist_listening_sessions pls ON pls.playlist_id = p.id
  WHERE p.curation_status IN ('approved', 'pending', 'rejected')
    AND p.is_public = true
  GROUP BY p.id, p.title, p.user_id, u.display_name, p.play_count, p.curator_earnings, p.curation_status, p.song_count, p.created_at
  ORDER BY
    CASE
      WHEN p_sort_by = 'plays' THEN COALESCE(p.play_count, 0)
      WHEN p_sort_by = 'earnings' THEN COALESCE(p.curator_earnings, 0)
      WHEN p_sort_by = 'engagement' THEN (
        COALESCE(p.play_count, 0) * 1.0 +
        COUNT(DISTINCT pls.listener_id) * 5.0 +
        COALESCE(AVG(pls.total_duration_seconds), 0) / 60.0
      )
      ELSE COALESCE(p.play_count, 0)
    END DESC
  LIMIT p_limit;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_get_top_curated_playlists(text, integer) TO authenticated;

-- ============================================================================
-- STEP 5: Create admin function to feature/unfeature playlist
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_feature_playlist(
  p_playlist_id uuid,
  p_action text,
  p_admin_notes text DEFAULT NULL,
  p_featured_order integer DEFAULT 0
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin_id uuid;
  v_playlist_exists boolean;
  v_current_featured record;
BEGIN
  -- Get admin user ID
  v_admin_id := auth.uid();

  -- Verify admin role
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = v_admin_id AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Admin access required');
  END IF;

  -- Check if playlist exists
  SELECT EXISTS (
    SELECT 1 FROM playlists WHERE id = p_playlist_id
  ) INTO v_playlist_exists;

  IF NOT v_playlist_exists THEN
    RETURN jsonb_build_object('success', false, 'message', 'Playlist not found');
  END IF;

  -- Check current featured status
  SELECT * INTO v_current_featured
  FROM featured_curated_playlists
  WHERE playlist_id = p_playlist_id AND is_active = true;

  IF p_action = 'feature' THEN
    IF v_current_featured.id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Playlist already featured');
    END IF;

    -- Feature the playlist
    INSERT INTO featured_curated_playlists (
      playlist_id,
      featured_by,
      featured_order,
      admin_notes,
      is_active
    ) VALUES (
      p_playlist_id,
      v_admin_id,
      p_featured_order,
      p_admin_notes,
      true
    );

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Playlist featured successfully',
      'action', 'featured'
    );

  ELSIF p_action = 'unfeature' THEN
    IF v_current_featured.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Playlist not currently featured');
    END IF;

    -- Unfeature the playlist
    UPDATE featured_curated_playlists
    SET 
      is_active = false,
      unfeatured_at = now()
    WHERE playlist_id = p_playlist_id AND is_active = true;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Playlist unfeatured successfully',
      'action', 'unfeatured'
    );

  ELSIF p_action = 'update_order' THEN
    IF v_current_featured.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Playlist not currently featured');
    END IF;

    -- Update featured order
    UPDATE featured_curated_playlists
    SET featured_order = p_featured_order
    WHERE playlist_id = p_playlist_id AND is_active = true;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Featured order updated successfully',
      'action', 'order_updated'
    );

  ELSE
    RETURN jsonb_build_object('success', false, 'message', 'Invalid action. Use: feature, unfeature, or update_order');
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', 'Error managing featured status: ' || SQLERRM
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_feature_playlist(uuid, text, text, integer) TO authenticated;

-- ============================================================================
-- STEP 6: Create admin function to block/unblock monetization
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_block_curator_monetization(
  p_block_type text,
  p_target_id uuid,
  p_action text,
  p_block_reason text DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin_id uuid;
  v_existing_block record;
BEGIN
  -- Get admin user ID
  v_admin_id := auth.uid();

  -- Verify admin role
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = v_admin_id AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Admin access required');
  END IF;

  -- Validate block type
  IF p_block_type NOT IN ('playlist', 'user') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid block type. Use: playlist or user');
  END IF;

  -- Check existing block
  IF p_block_type = 'playlist' THEN
    SELECT * INTO v_existing_block
    FROM curator_monetization_blocks
    WHERE playlist_id = p_target_id AND is_active = true;
  ELSE
    SELECT * INTO v_existing_block
    FROM curator_monetization_blocks
    WHERE user_id = p_target_id AND is_active = true;
  END IF;

  IF p_action = 'block' THEN
    IF v_existing_block.id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Monetization already blocked');
    END IF;

    -- Create block
    IF p_block_type = 'playlist' THEN
      INSERT INTO curator_monetization_blocks (
        block_type,
        playlist_id,
        blocked_by,
        block_reason,
        is_active
      ) VALUES (
        'playlist',
        p_target_id,
        v_admin_id,
        p_block_reason,
        true
      );
    ELSE
      INSERT INTO curator_monetization_blocks (
        block_type,
        user_id,
        blocked_by,
        block_reason,
        is_active
      ) VALUES (
        'user',
        p_target_id,
        v_admin_id,
        p_block_reason,
        true
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Monetization blocked successfully',
      'action', 'blocked'
    );

  ELSIF p_action = 'unblock' THEN
    IF v_existing_block.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'No active monetization block found');
    END IF;

    -- Remove block
    UPDATE curator_monetization_blocks
    SET 
      is_active = false,
      unblocked_at = now()
    WHERE id = v_existing_block.id;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Monetization unblocked successfully',
      'action', 'unblocked'
    );

  ELSE
    RETURN jsonb_build_object('success', false, 'message', 'Invalid action. Use: block or unblock');
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', 'Error managing monetization block: ' || SQLERRM
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_block_curator_monetization(text, uuid, text, text) TO authenticated;

-- ============================================================================
-- STEP 7: Update process_curator_ad_revenue to check blocks
-- ============================================================================

-- Drop the existing function
DROP FUNCTION IF EXISTS process_curator_ad_revenue(uuid, uuid, numeric, uuid, integer);

-- Recreate with block checks
CREATE OR REPLACE FUNCTION process_curator_ad_revenue(
  p_playlist_id uuid,
  p_listener_id uuid,
  p_ad_revenue numeric,
  p_ad_impression_id uuid DEFAULT NULL,
  p_session_duration integer DEFAULT 0
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_curator_id uuid;
  v_curator_role text;
  v_revenue_split numeric;
  v_curator_share numeric;
  v_settings_enabled boolean;
  v_global_enabled boolean;
  v_playlist_status text;
  v_impression_record record;
  v_last_play timestamptz;
  v_balance_before numeric;
  v_balance_after numeric;
  v_fraud_check jsonb;
  v_is_valid boolean;
  v_validation_score numeric;
  v_fraud_flag record;
BEGIN
  -- Get playlist and curator info
  SELECT 
    p.user_id,
    p.curation_status,
    u.role
  INTO v_curator_id, v_playlist_status, v_curator_role
  FROM playlists p
  JOIN users u ON p.user_id = u.id
  WHERE p.id = p_playlist_id;

  -- Validation: Playlist must exist
  IF v_curator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Playlist not found');
  END IF;

  -- Check global curator status
  SELECT (setting_value->>'enabled')::boolean INTO v_global_enabled
  FROM curator_settings
  WHERE setting_key = 'curator_global_status';

  IF v_global_enabled IS FALSE THEN
    RETURN jsonb_build_object('success', false, 'message', 'Listener Curations disabled globally', 'blocked_reason', 'global_disabled');
  END IF;

  -- Check if playlist monetization is blocked
  IF EXISTS (
    SELECT 1 FROM curator_monetization_blocks
    WHERE playlist_id = p_playlist_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Monetization blocked for this playlist', 'blocked_reason', 'playlist_blocked');
  END IF;

  -- Check if user monetization is blocked
  IF EXISTS (
    SELECT 1 FROM curator_monetization_blocks
    WHERE user_id = v_curator_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Monetization blocked for this user', 'blocked_reason', 'user_blocked');
  END IF;

  -- Validation: Playlist must be approved for curation
  IF v_playlist_status != 'approved' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Playlist not approved for monetization');
  END IF;

  -- Validation: Prevent self-listening earnings
  IF v_curator_id = p_listener_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Self-listening not eligible for earnings', 'blocked_reason', 'own_content');
  END IF;

  -- Validation: Curator must be a listener (not creator/admin)
  IF v_curator_role NOT IN ('listener') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Only listener curators are eligible for earnings');
  END IF;

  -- ANTI-FRAUD CHECK 1: Minimum session duration (5 minutes = 300 seconds)
  IF p_session_duration > 0 AND p_session_duration < 300 THEN
    RETURN jsonb_build_object(
      'success', false, 
      'message', 'Session duration below minimum threshold',
      'blocked_reason', 'insufficient_duration',
      'duration_required', 300,
      'duration_provided', p_session_duration
    );
  END IF;

  -- ANTI-FRAUD CHECK 2: Check for duplicate play within 24 hours
  SELECT played_at INTO v_last_play
  FROM playlist_ad_impressions
  WHERE playlist_id = p_playlist_id
    AND listener_id = p_listener_id
    AND played_at > (now() - interval '24 hours')
  ORDER BY played_at DESC
  LIMIT 1;

  IF v_last_play IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false, 
      'message', 'Duplicate play within 24 hours',
      'blocked_reason', 'duplicate_play',
      'last_play_at', v_last_play
    );
  END IF;

  -- ANTI-FRAUD CHECK 3: Check if playlist is flagged
  SELECT * INTO v_fraud_flag
  FROM curator_fraud_flags
  WHERE playlist_id = p_playlist_id
    AND reviewed = false
    AND earnings_paused = true
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Earnings paused - playlist under review',
      'blocked_reason', 'flagged_playlist',
      'flag_severity', v_fraud_flag.severity
    );
  END IF;

  -- ANTI-FRAUD CHECK 4: Run comprehensive fraud pattern detection
  v_fraud_check := detect_playlist_fraud_patterns(
    p_playlist_id,
    p_listener_id,
    p_session_duration
  );

  v_is_valid := (v_fraud_check->>'is_valid')::boolean;
  v_validation_score := (v_fraud_check->>'validation_score')::numeric;

  -- Block earnings if fraud detected
  IF NOT v_is_valid OR v_validation_score < 50 THEN
    -- Auto-flag if validation score is critically low
    IF v_validation_score < 30 THEN
      PERFORM auto_flag_suspicious_playlist(p_playlist_id, v_fraud_check);
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'message', 'Fraudulent pattern detected',
      'blocked_reason', 'fraud_detected',
      'fraud_check', v_fraud_check
    );
  END IF;

  -- Get curator revenue split settings
  SELECT 
    (setting_value->>'enabled')::boolean,
    (setting_value->>'percentage')::numeric
  INTO v_settings_enabled, v_revenue_split
  FROM curator_settings
  WHERE setting_key = 'curator_revenue_split';

  -- Use defaults if not found
  v_settings_enabled := COALESCE(v_settings_enabled, true);
  v_revenue_split := COALESCE(v_revenue_split, 5);

  -- Check if curator monetization is enabled
  IF NOT v_settings_enabled THEN
    RETURN jsonb_build_object('success', false, 'message', 'Curator monetization disabled');
  END IF;

  -- Calculate curator share
  v_curator_share := ROUND((p_ad_revenue * v_revenue_split / 100)::numeric, 2);

  -- Get current balance
  SELECT balance INTO v_balance_before
  FROM treat_wallets
  WHERE user_id = v_curator_id;

  -- Record validated listening session
  INSERT INTO playlist_listening_sessions (
    playlist_id,
    curator_id,
    listener_id,
    session_start,
    session_end,
    total_duration_seconds,
    is_validated,
    validation_score
  ) VALUES (
    p_playlist_id,
    v_curator_id,
    p_listener_id,
    now() - (p_session_duration || ' seconds')::interval,
    now(),
    p_session_duration,
    true,
    v_validation_score
  );

  -- Create playlist ad impression record
  INSERT INTO playlist_ad_impressions (
    playlist_id,
    curator_id,
    listener_id,
    ad_impression_id,
    ad_revenue,
    curator_share,
    processed,
    played_at
  ) VALUES (
    p_playlist_id,
    v_curator_id,
    p_listener_id,
    p_ad_impression_id,
    p_ad_revenue,
    v_curator_share,
    true,
    now()
  )
  RETURNING * INTO v_impression_record;

  -- Credit curator's Treat wallet (silent - no notification)
  UPDATE treat_wallets
  SET 
    balance = balance + v_curator_share,
    earned_balance = earned_balance + v_curator_share,
    updated_at = now()
  WHERE user_id = v_curator_id
  RETURNING balance INTO v_balance_after;

  -- Record transaction in treat_transactions
  INSERT INTO treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    metadata,
    status
  ) VALUES (
    v_curator_id,
    'curator_earnings',
    v_curator_share,
    v_balance_before,
    v_balance_after,
    'Playlist curation earnings',
    jsonb_build_object(
      'playlist_id', p_playlist_id,
      'listener_id', p_listener_id,
      'ad_revenue', p_ad_revenue,
      'revenue_split_percentage', v_revenue_split,
      'session_duration', p_session_duration,
      'validation_score', v_validation_score,
      'fraud_check_passed', true,
      'silent', true
    ),
    'completed'
  );

  -- Update curator_earnings table for analytics
  INSERT INTO curator_earnings (
    playlist_id,
    curator_id,
    amount,
    earned_at,
    description,
    transaction_type
  ) VALUES (
    p_playlist_id,
    v_curator_id,
    v_curator_share,
    now(),
    'Ad revenue from validated playlist session',
    'ad_impression'
  );

  -- Update playlist total earnings (silent)
  UPDATE playlists
  SET 
    curator_earnings = curator_earnings + v_curator_share,
    play_count = play_count + 1,
    updated_at = now()
  WHERE id = p_playlist_id;

  RETURN jsonb_build_object(
    'success', true,
    'curator_id', v_curator_id,
    'curator_share', v_curator_share,
    'revenue_split_percentage', v_revenue_split,
    'validation_score', v_validation_score,
    'fraud_checks_passed', true,
    'session_duration', p_session_duration,
    'message', 'Curator earnings processed successfully'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', 'Error processing curator revenue: ' || SQLERRM
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION process_curator_ad_revenue(uuid, uuid, numeric, uuid, integer) TO authenticated, anon;

-- ============================================================================
-- STEP 8: Comments
-- ============================================================================

COMMENT ON TABLE featured_curated_playlists IS 'Admin-featured curated playlists for homepage display';
COMMENT ON TABLE curator_monetization_blocks IS 'Admin controls to block monetization for specific playlists or users';
COMMENT ON FUNCTION admin_get_top_curated_playlists IS 'Get top curated playlists by plays, earnings, or engagement';
COMMENT ON FUNCTION admin_feature_playlist IS 'Admin function to feature/unfeature playlists';
COMMENT ON FUNCTION admin_block_curator_monetization IS 'Admin function to block/unblock monetization for playlists or users';
