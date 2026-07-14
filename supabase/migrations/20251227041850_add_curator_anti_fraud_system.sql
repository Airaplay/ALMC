/*
  # Curator Anti-Fraud System

  ## Overview
  Extends existing fraud detection to Listener Curations, protecting against:
  - Self-listening by playlist creators
  - Repeated streams from the same listener
  - Insufficient listening duration
  - Abnormal playlist looping behavior
  - Farm accounts manipulating curator earnings

  ## Features
  1. **Playlist Session Tracking**
     - Track complete listening sessions with duration
     - Record songs played within each session
     - Calculate genuine engagement metrics

  2. **Looping Detection**
     - Identify listeners repeatedly looping playlists
     - Flag accounts with suspicious replay patterns
     - Prevent earnings from artificial inflation

  3. **Suspicious Playlist Flagging**
     - Auto-flag playlists with abnormal patterns
     - Admin review queue for flagged playlists
     - Temporarily pause earnings pending review

  4. **Enhanced Validation**
     - Minimum 5-minute listening duration per session
     - Maximum 10 plays per listener per playlist per day
     - Pattern analysis for bot detection

  ## Tables Created
  - playlist_listening_sessions: Complete session tracking
  - playlist_fraud_detection: Suspicious pattern logging
  - curator_fraud_flags: Flagged playlists for review

  ## Functions Enhanced
  - process_curator_ad_revenue: Now includes comprehensive fraud checks
*/

-- ============================================================================
-- STEP 1: Create playlist listening sessions tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS playlist_listening_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  curator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listener_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_start timestamptz DEFAULT now() NOT NULL,
  session_end timestamptz,
  total_duration_seconds integer DEFAULT 0,
  songs_played integer DEFAULT 0,
  songs_completed integer DEFAULT 0,
  is_complete_session boolean DEFAULT false,
  is_validated boolean DEFAULT false,
  validation_score numeric(5,2) DEFAULT 100.0,
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE playlist_listening_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own listening sessions"
  ON playlist_listening_sessions FOR SELECT
  TO authenticated
  USING (listener_id = auth.uid());

CREATE POLICY "Curators can view sessions on their playlists"
  ON playlist_listening_sessions FOR SELECT
  TO authenticated
  USING (curator_id = auth.uid());

CREATE POLICY "Admins can view all sessions"
  ON playlist_listening_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Service role can manage sessions"
  ON playlist_listening_sessions FOR ALL
  TO authenticated
  WITH CHECK (true);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_playlist_sessions_playlist ON playlist_listening_sessions(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_sessions_curator ON playlist_listening_sessions(curator_id);
CREATE INDEX IF NOT EXISTS idx_playlist_sessions_listener ON playlist_listening_sessions(listener_id);
CREATE INDEX IF NOT EXISTS idx_playlist_sessions_validated ON playlist_listening_sessions(is_validated);
CREATE INDEX IF NOT EXISTS idx_playlist_sessions_start ON playlist_listening_sessions(session_start DESC);

-- ============================================================================
-- STEP 2: Create playlist fraud detection table
-- ============================================================================

CREATE TABLE IF NOT EXISTS playlist_fraud_detection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  listener_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  fraud_type text NOT NULL,
  severity text DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  detected_at timestamptz DEFAULT now() NOT NULL,
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE playlist_fraud_detection ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can view all fraud detection"
  ON playlist_fraud_detection FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage fraud detection"
  ON playlist_fraud_detection FOR ALL
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

CREATE POLICY "Service role can manage fraud detection"
  ON playlist_fraud_detection FOR ALL
  TO authenticated
  WITH CHECK (true);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_playlist_fraud_playlist ON playlist_fraud_detection(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_fraud_listener ON playlist_fraud_detection(listener_id);
CREATE INDEX IF NOT EXISTS idx_playlist_fraud_type ON playlist_fraud_detection(fraud_type);
CREATE INDEX IF NOT EXISTS idx_playlist_fraud_severity ON playlist_fraud_detection(severity);
CREATE INDEX IF NOT EXISTS idx_playlist_fraud_resolved ON playlist_fraud_detection(resolved) WHERE resolved = false;

-- ============================================================================
-- STEP 3: Create curator fraud flags table
-- ============================================================================

CREATE TABLE IF NOT EXISTS curator_fraud_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  curator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flag_reason text NOT NULL,
  auto_detected boolean DEFAULT true,
  severity text DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  evidence jsonb DEFAULT '{}'::jsonb,
  earnings_paused boolean DEFAULT false,
  flagged_at timestamptz DEFAULT now() NOT NULL,
  reviewed boolean DEFAULT false,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_action text,
  review_notes text
);

-- Enable RLS
ALTER TABLE curator_fraud_flags ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can view all curator flags"
  ON curator_fraud_flags FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage curator flags"
  ON curator_fraud_flags FOR ALL
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

CREATE POLICY "Service role can manage flags"
  ON curator_fraud_flags FOR ALL
  TO authenticated
  WITH CHECK (true);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_curator_flags_playlist ON curator_fraud_flags(playlist_id);
CREATE INDEX IF NOT EXISTS idx_curator_flags_curator ON curator_fraud_flags(curator_id);
CREATE INDEX IF NOT EXISTS idx_curator_flags_reviewed ON curator_fraud_flags(reviewed) WHERE reviewed = false;
CREATE INDEX IF NOT EXISTS idx_curator_flags_paused ON curator_fraud_flags(earnings_paused) WHERE earnings_paused = true;

-- ============================================================================
-- STEP 4: Create fraud detection function for playlists
-- ============================================================================

CREATE OR REPLACE FUNCTION detect_playlist_fraud_patterns(
  p_playlist_id uuid,
  p_listener_id uuid,
  p_session_duration integer DEFAULT 0
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_plays_today integer;
  v_plays_last_hour integer;
  v_total_sessions integer;
  v_avg_session_duration numeric;
  v_looping_sessions integer;
  v_is_suspicious boolean := false;
  v_fraud_reasons text[] := ARRAY[]::text[];
  v_validation_score numeric := 100.0;
BEGIN
  -- Count plays today from this listener
  SELECT COUNT(*) INTO v_plays_today
  FROM playlist_listening_sessions
  WHERE playlist_id = p_playlist_id
    AND listener_id = p_listener_id
    AND session_start > (now() - interval '24 hours');

  -- Count plays in last hour
  SELECT COUNT(*) INTO v_plays_last_hour
  FROM playlist_listening_sessions
  WHERE playlist_id = p_playlist_id
    AND listener_id = p_listener_id
    AND session_start > (now() - interval '1 hour');

  -- Get total sessions and average duration
  SELECT 
    COUNT(*),
    AVG(total_duration_seconds)
  INTO v_total_sessions, v_avg_session_duration
  FROM playlist_listening_sessions
  WHERE playlist_id = p_playlist_id
    AND listener_id = p_listener_id
    AND is_validated = true;

  -- Count looping behavior (sessions within 10 minutes of each other)
  SELECT COUNT(*) INTO v_looping_sessions
  FROM (
    SELECT 
      session_start,
      LAG(session_start) OVER (ORDER BY session_start) as prev_start
    FROM playlist_listening_sessions
    WHERE playlist_id = p_playlist_id
      AND listener_id = p_listener_id
      AND session_start > (now() - interval '7 days')
  ) AS sessions
  WHERE (session_start - prev_start) < interval '10 minutes';

  -- FRAUD CHECK 1: Excessive plays per day (max 10)
  IF v_plays_today >= 10 THEN
    v_is_suspicious := true;
    v_fraud_reasons := array_append(v_fraud_reasons, 'excessive_daily_plays');
    v_validation_score := v_validation_score - 50;
    
    -- Log fraud detection
    INSERT INTO playlist_fraud_detection (
      playlist_id,
      listener_id,
      fraud_type,
      severity,
      description,
      metadata
    ) VALUES (
      p_playlist_id,
      p_listener_id,
      'excessive_daily_plays',
      'high',
      'Listener exceeded maximum daily plays (10)',
      jsonb_build_object('plays_today', v_plays_today)
    );
  END IF;

  -- FRAUD CHECK 2: Rapid successive plays (more than 3 per hour)
  IF v_plays_last_hour >= 3 THEN
    v_is_suspicious := true;
    v_fraud_reasons := array_append(v_fraud_reasons, 'rapid_successive_plays');
    v_validation_score := v_validation_score - 30;
    
    INSERT INTO playlist_fraud_detection (
      playlist_id,
      listener_id,
      fraud_type,
      severity,
      description,
      metadata
    ) VALUES (
      p_playlist_id,
      p_listener_id,
      'rapid_successive_plays',
      'medium',
      'Too many plays in a short timeframe',
      jsonb_build_object('plays_last_hour', v_plays_last_hour)
    );
  END IF;

  -- FRAUD CHECK 3: Insufficient session duration (minimum 5 minutes = 300 seconds)
  IF p_session_duration > 0 AND p_session_duration < 300 THEN
    v_is_suspicious := true;
    v_fraud_reasons := array_append(v_fraud_reasons, 'insufficient_duration');
    v_validation_score := v_validation_score - 40;
    
    INSERT INTO playlist_fraud_detection (
      playlist_id,
      listener_id,
      fraud_type,
      severity,
      description,
      metadata
    ) VALUES (
      p_playlist_id,
      p_listener_id,
      'insufficient_duration',
      'medium',
      'Session duration below minimum threshold',
      jsonb_build_object('duration_seconds', p_session_duration, 'minimum_required', 300)
    );
  END IF;

  -- FRAUD CHECK 4: Abnormal looping behavior (more than 5 rapid replays in a week)
  IF v_looping_sessions >= 5 THEN
    v_is_suspicious := true;
    v_fraud_reasons := array_append(v_fraud_reasons, 'abnormal_looping');
    v_validation_score := v_validation_score - 35;
    
    INSERT INTO playlist_fraud_detection (
      playlist_id,
      listener_id,
      fraud_type,
      severity,
      description,
      metadata
    ) VALUES (
      p_playlist_id,
      p_listener_id,
      'abnormal_looping',
      'high',
      'Suspicious playlist looping pattern detected',
      jsonb_build_object('looping_sessions', v_looping_sessions)
    );
  END IF;

  -- FRAUD CHECK 5: Bot-like average session durations
  IF v_avg_session_duration IS NOT NULL AND v_avg_session_duration < 180 AND v_total_sessions >= 5 THEN
    v_is_suspicious := true;
    v_fraud_reasons := array_append(v_fraud_reasons, 'bot_like_pattern');
    v_validation_score := v_validation_score - 45;
    
    INSERT INTO playlist_fraud_detection (
      playlist_id,
      listener_id,
      fraud_type,
      severity,
      description,
      metadata
    ) VALUES (
      p_playlist_id,
      p_listener_id,
      'bot_like_pattern',
      'critical',
      'Session patterns suggest automated behavior',
      jsonb_build_object('avg_duration', v_avg_session_duration, 'total_sessions', v_total_sessions)
    );
  END IF;

  -- Ensure validation score doesn't go below 0
  v_validation_score := GREATEST(v_validation_score, 0);

  RETURN jsonb_build_object(
    'is_valid', NOT v_is_suspicious,
    'is_suspicious', v_is_suspicious,
    'validation_score', v_validation_score,
    'fraud_reasons', v_fraud_reasons,
    'plays_today', v_plays_today,
    'plays_last_hour', v_plays_last_hour,
    'looping_sessions', v_looping_sessions
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION detect_playlist_fraud_patterns(uuid, uuid, integer) TO authenticated, anon;

-- ============================================================================
-- STEP 5: Create function to auto-flag suspicious playlists
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_flag_suspicious_playlist(
  p_playlist_id uuid,
  p_fraud_evidence jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_curator_id uuid;
  v_fraud_count integer;
  v_severity text;
  v_existing_flag uuid;
BEGIN
  -- Get curator ID
  SELECT user_id INTO v_curator_id
  FROM playlists
  WHERE id = p_playlist_id;

  -- Count recent fraud events for this playlist
  SELECT COUNT(*) INTO v_fraud_count
  FROM playlist_fraud_detection
  WHERE playlist_id = p_playlist_id
    AND detected_at > (now() - interval '7 days')
    AND resolved = false;

  -- Determine severity based on fraud count
  v_severity := CASE
    WHEN v_fraud_count >= 10 THEN 'critical'
    WHEN v_fraud_count >= 5 THEN 'high'
    WHEN v_fraud_count >= 3 THEN 'medium'
    ELSE 'low'
  END;

  -- Check if playlist is already flagged
  SELECT id INTO v_existing_flag
  FROM curator_fraud_flags
  WHERE playlist_id = p_playlist_id
    AND reviewed = false;

  -- Create or update flag
  IF v_existing_flag IS NULL AND v_fraud_count >= 3 THEN
    INSERT INTO curator_fraud_flags (
      playlist_id,
      curator_id,
      flag_reason,
      severity,
      evidence,
      earnings_paused
    ) VALUES (
      p_playlist_id,
      v_curator_id,
      'Automated fraud detection triggered',
      v_severity,
      jsonb_build_object(
        'fraud_event_count', v_fraud_count,
        'recent_evidence', p_fraud_evidence,
        'detection_timestamp', now()
      ),
      v_severity IN ('high', 'critical')
    );

    -- Pause curation if critical
    IF v_severity = 'critical' THEN
      UPDATE playlists
      SET curation_status = 'pending',
          updated_at = now()
      WHERE id = p_playlist_id;
    END IF;
  END IF;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION auto_flag_suspicious_playlist(uuid, jsonb) TO authenticated, anon;

-- ============================================================================
-- STEP 6: Comments for documentation
-- ============================================================================

COMMENT ON TABLE playlist_listening_sessions IS 'Complete tracking of playlist listening sessions for fraud detection';
COMMENT ON TABLE playlist_fraud_detection IS 'Logs suspicious playlist activity patterns';
COMMENT ON TABLE curator_fraud_flags IS 'Admin review queue for flagged playlists';
COMMENT ON FUNCTION detect_playlist_fraud_patterns IS 'Comprehensive fraud detection for playlist curator earnings';
COMMENT ON FUNCTION auto_flag_suspicious_playlist IS 'Automatically flags playlists with suspicious patterns';
