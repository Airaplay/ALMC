/*
  # Silent Curator Monetization System

  ## Overview
  Enables automatic, silent monetization for approved Listener Curations playlists.
  Curators earn a percentage of ad revenue when their playlists are played by others.

  ## Features
  1. **Admin Configuration**
     - Configurable revenue split percentage for curators
     - Default: 5% of ad revenue goes to curator
     - Stored in curator_settings table

  2. **Silent Tracking**
     - Track playlist plays with ad context
     - No public earning indicators
     - Prevent self-listening earnings
     - Prevent duplicate earnings from repeat plays within 24 hours

  3. **Automatic Distribution**
     - Earnings automatically credited when ads display during playlist playback
     - Updates curator's Treat wallet balance silently
     - Records transaction in treat_transactions

  4. **Security**
     - RLS policies for privacy
     - Admin-only configuration access
     - Secure earnings distribution

  ## Tables Created
  - curator_settings: Admin configuration for curator monetization
  - playlist_ad_impressions: Track ad impressions during playlist playback

  ## Functions Created
  - process_curator_ad_revenue: Distribute earnings to curator when ad displays
  - track_playlist_play_with_ad: Track playlist play and process ad revenue
*/

-- ============================================================================
-- STEP 1: Create curator settings table for admin configuration
-- ============================================================================

CREATE TABLE IF NOT EXISTS curator_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value jsonb NOT NULL,
  description text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE curator_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage curator settings"
  ON curator_settings FOR ALL
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

CREATE POLICY "Authenticated users can view curator settings"
  ON curator_settings FOR SELECT
  TO authenticated
  USING (true);

-- Insert default curator revenue split setting
INSERT INTO curator_settings (setting_key, setting_value, description)
VALUES (
  'curator_revenue_split',
  '{"percentage": 5, "enabled": true}'::jsonb,
  'Percentage of ad revenue that goes to playlist curators'
)
ON CONFLICT (setting_key) DO NOTHING;

-- Add index
CREATE INDEX IF NOT EXISTS idx_curator_settings_key ON curator_settings(setting_key);

-- ============================================================================
-- STEP 2: Create playlist ad impressions tracking table
-- ============================================================================

CREATE TABLE IF NOT EXISTS playlist_ad_impressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  curator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listener_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ad_impression_id uuid REFERENCES ad_impressions(id) ON DELETE SET NULL,
  ad_revenue numeric(10,4) DEFAULT 0.0000,
  curator_share numeric(10,4) DEFAULT 0.0000,
  processed boolean DEFAULT false NOT NULL,
  played_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE playlist_ad_impressions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Curators can view their own playlist ad impressions"
  ON playlist_ad_impressions FOR SELECT
  TO authenticated
  USING (curator_id = auth.uid());

CREATE POLICY "Service role can insert playlist ad impressions"
  ON playlist_ad_impressions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can view all playlist ad impressions"
  ON playlist_ad_impressions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_playlist_ad_impressions_playlist ON playlist_ad_impressions(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_ad_impressions_curator ON playlist_ad_impressions(curator_id);
CREATE INDEX IF NOT EXISTS idx_playlist_ad_impressions_listener ON playlist_ad_impressions(listener_id);
CREATE INDEX IF NOT EXISTS idx_playlist_ad_impressions_processed ON playlist_ad_impressions(processed) WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_playlist_ad_impressions_played_at ON playlist_ad_impressions(played_at DESC);

-- ============================================================================
-- STEP 3: Create function to process curator ad revenue
-- ============================================================================

CREATE OR REPLACE FUNCTION process_curator_ad_revenue(
  p_playlist_id uuid,
  p_listener_id uuid,
  p_ad_revenue numeric,
  p_ad_impression_id uuid DEFAULT NULL
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
  v_playlist_status text;
  v_impression_record record;
  v_last_play timestamptz;
  v_balance_before numeric;
  v_balance_after numeric;
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

  -- Validation: Playlist must be approved for curation
  IF v_playlist_status != 'approved' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Playlist not approved for monetization');
  END IF;

  -- Validation: Prevent self-listening earnings
  IF v_curator_id = p_listener_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Self-listening not eligible for earnings');
  END IF;

  -- Validation: Curator must be a listener (not creator/admin)
  IF v_curator_role NOT IN ('listener') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Only listener curators are eligible for earnings');
  END IF;

  -- Check for duplicate play within 24 hours from same listener
  SELECT played_at INTO v_last_play
  FROM playlist_ad_impressions
  WHERE playlist_id = p_playlist_id
    AND listener_id = p_listener_id
    AND played_at > (now() - interval '24 hours')
  ORDER BY played_at DESC
  LIMIT 1;

  IF v_last_play IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Duplicate play within 24 hours');
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
    'Ad revenue from playlist play',
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
GRANT EXECUTE ON FUNCTION process_curator_ad_revenue(uuid, uuid, numeric, uuid) TO authenticated, anon;

-- ============================================================================
-- STEP 4: Create function to track playlist play with ad
-- ============================================================================

CREATE OR REPLACE FUNCTION track_playlist_play_with_ad(
  p_playlist_id uuid,
  p_ad_type text DEFAULT 'banner',
  p_ad_revenue numeric DEFAULT 0.0001
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_listener_id uuid;
  v_ad_impression_id uuid;
  v_result jsonb;
BEGIN
  -- Get authenticated user (listener)
  v_listener_id := auth.uid();
  
  IF v_listener_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Authentication required');
  END IF;

  -- Create ad impression record
  INSERT INTO ad_impressions (
    user_id,
    content_id,
    content_type,
    ad_type,
    impression_time,
    completed
  ) VALUES (
    v_listener_id,
    p_playlist_id,
    'playlist',
    p_ad_type,
    now(),
    true
  )
  RETURNING id INTO v_ad_impression_id;

  -- Process curator ad revenue
  SELECT process_curator_ad_revenue(
    p_playlist_id,
    v_listener_id,
    p_ad_revenue,
    v_ad_impression_id
  ) INTO v_result;

  -- Record playlist play
  INSERT INTO playlist_plays (
    playlist_id,
    user_id,
    played_at,
    revenue_generated
  ) VALUES (
    p_playlist_id,
    v_listener_id,
    now(),
    p_ad_revenue
  );

  RETURN jsonb_build_object(
    'success', true,
    'ad_impression_id', v_ad_impression_id,
    'curator_processing', v_result
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', 'Error tracking playlist play: ' || SQLERRM
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION track_playlist_play_with_ad(uuid, text, numeric) TO authenticated, anon;

-- ============================================================================
-- STEP 5: Create indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_playlists_curation_approved 
  ON playlists(curation_status) 
  WHERE curation_status = 'approved';

CREATE INDEX IF NOT EXISTS idx_treat_wallets_user_id 
  ON treat_wallets(user_id);

CREATE INDEX IF NOT EXISTS idx_treat_transactions_user_id 
  ON treat_transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_treat_transactions_type 
  ON treat_transactions(transaction_type);

-- ============================================================================
-- STEP 6: Comments for documentation
-- ============================================================================

COMMENT ON TABLE curator_settings IS 'Admin configuration for curator monetization settings';
COMMENT ON TABLE playlist_ad_impressions IS 'Tracks ad impressions during playlist playback for curator monetization';
COMMENT ON FUNCTION process_curator_ad_revenue IS 'Silently distributes ad revenue to playlist curators';
COMMENT ON FUNCTION track_playlist_play_with_ad IS 'Tracks playlist play and processes ad revenue for curator';
