/*
  # Enhanced Curator Revenue with Anti-Fraud

  ## Overview
  Replaces the curator revenue processing function with fraud-aware version that:
  - Validates listening sessions before crediting
  - Enforces minimum listening duration (5 minutes)
  - Detects and blocks fraudulent patterns
  - Auto-flags suspicious playlists
  - Blocks earnings on flagged playlists

  ## Changes
  - Drops old process_curator_ad_revenue function
  - Creates enhanced version with session duration parameter
  - Adds comprehensive fraud checks
  - Integrates fraud pattern detection
  - Records validated sessions
  - Blocks earnings when fraud detected
*/

-- ============================================================================
-- Drop old function and create enhanced version
-- ============================================================================

-- Drop the old function signature
DROP FUNCTION IF EXISTS process_curator_ad_revenue(uuid, uuid, numeric, uuid);

-- Enhanced curator revenue processing with anti-fraud
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
-- Update track_playlist_play_with_ad to include session duration
-- ============================================================================

-- Drop old function
DROP FUNCTION IF EXISTS track_playlist_play_with_ad(uuid, text, numeric);

-- Create enhanced version
CREATE OR REPLACE FUNCTION track_playlist_play_with_ad(
  p_playlist_id uuid,
  p_ad_type text DEFAULT 'banner',
  p_ad_revenue numeric DEFAULT 0.0001,
  p_session_duration integer DEFAULT 300
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

  -- Process curator ad revenue with session duration
  SELECT process_curator_ad_revenue(
    p_playlist_id,
    v_listener_id,
    p_ad_revenue,
    v_ad_impression_id,
    p_session_duration
  ) INTO v_result;

  -- Record playlist play
  INSERT INTO playlist_plays (
    playlist_id,
    user_id,
    played_at,
    duration_seconds,
    revenue_generated
  ) VALUES (
    p_playlist_id,
    v_listener_id,
    now(),
    p_session_duration,
    p_ad_revenue
  );

  RETURN jsonb_build_object(
    'success', true,
    'ad_impression_id', v_ad_impression_id,
    'session_duration', p_session_duration,
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
GRANT EXECUTE ON FUNCTION track_playlist_play_with_ad(uuid, text, numeric, integer) TO authenticated, anon;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON FUNCTION process_curator_ad_revenue IS 'Enhanced curator revenue processing with comprehensive anti-fraud checks';
COMMENT ON FUNCTION track_playlist_play_with_ad IS 'Track playlist play with ad and session duration for fraud detection';
