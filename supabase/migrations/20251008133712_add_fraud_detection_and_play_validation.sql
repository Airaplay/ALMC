/*
  # Add Fraud Detection and Play Validation System

  1. New Tables
    - `play_fraud_detection` - Tracks suspicious play patterns for fraud detection
      - `id` (uuid, primary key)
      - `user_id` (uuid, nullable for anonymous plays)
      - `content_id` (uuid, references songs or content_uploads)
      - `content_type` (text: 'song', 'video', 'clip')
      - `ip_address` (text, nullable)
      - `user_agent` (text, nullable)
      - `play_duration` (integer, seconds)
      - `flagged_reason` (text, nullable)
      - `is_suspicious` (boolean, default false)
      - `created_at` (timestamptz)
    
    - `user_play_statistics` - Aggregated user play statistics for pattern analysis
      - `user_id` (uuid, primary key)
      - `total_plays_today` (integer, default 0)
      - `total_plays_this_hour` (integer, default 0)
      - `unique_content_today` (integer, default 0)
      - `rapid_plays_count` (integer, default 0)
      - `last_play_at` (timestamptz)
      - `is_flagged` (boolean, default false)
      - `updated_at` (timestamptz)

  2. Changes to Existing Tables
    - `listening_history`
      - Add `ip_address` (text, nullable)
      - Add `user_agent` (text, nullable)
      - Add `is_validated` (boolean, default false)
      - Add `validation_score` (decimal, default 100.0) - 0-100 score for play quality

  3. New Functions
    - `validate_play_duration()` - Validates if play meets minimum duration (65 seconds for songs)
    - `detect_fraud_patterns()` - AI/ML-style pattern detection for suspicious activity
    - `increment_play_count_with_validation()` - Enhanced play count increment with fraud checks
    - `reset_hourly_play_stats()` - Resets hourly statistics
    - `flag_suspicious_user()` - Flags users with suspicious patterns

  4. Security
    - RLS enabled on all new tables
    - Admin-only access to fraud detection data
    - Service role functions for validation
*/

-- Create play_fraud_detection table
CREATE TABLE IF NOT EXISTS play_fraud_detection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  content_id uuid NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('song', 'video', 'clip')),
  ip_address text,
  user_agent text,
  play_duration integer NOT NULL,
  flagged_reason text,
  is_suspicious boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create user_play_statistics table
CREATE TABLE IF NOT EXISTS user_play_statistics (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_plays_today integer DEFAULT 0,
  total_plays_this_hour integer DEFAULT 0,
  unique_content_today integer DEFAULT 0,
  rapid_plays_count integer DEFAULT 0,
  last_play_at timestamptz,
  is_flagged boolean DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

-- Add new columns to listening_history
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'listening_history' AND column_name = 'ip_address'
  ) THEN
    ALTER TABLE listening_history 
    ADD COLUMN ip_address text,
    ADD COLUMN user_agent text,
    ADD COLUMN is_validated boolean DEFAULT false,
    ADD COLUMN validation_score decimal(5,2) DEFAULT 100.0;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_fraud_detection_user_id ON play_fraud_detection(user_id);
CREATE INDEX IF NOT EXISTS idx_fraud_detection_content ON play_fraud_detection(content_id, content_type);
CREATE INDEX IF NOT EXISTS idx_fraud_detection_suspicious ON play_fraud_detection(is_suspicious);
CREATE INDEX IF NOT EXISTS idx_fraud_detection_created_at ON play_fraud_detection(created_at);
CREATE INDEX IF NOT EXISTS idx_user_play_stats_flagged ON user_play_statistics(is_flagged);
CREATE INDEX IF NOT EXISTS idx_listening_history_validated ON listening_history(is_validated);

-- Enable RLS
ALTER TABLE play_fraud_detection ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_play_statistics ENABLE ROW LEVEL SECURITY;

-- RLS Policies for play_fraud_detection
CREATE POLICY "Admins can view all fraud detection data"
  ON play_fraud_detection
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Service role can manage fraud detection"
  ON play_fraud_detection
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS Policies for user_play_statistics
CREATE POLICY "Users can view own statistics"
  ON user_play_statistics
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all statistics"
  ON user_play_statistics
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Service role can manage statistics"
  ON user_play_statistics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to detect fraud patterns
CREATE OR REPLACE FUNCTION detect_fraud_patterns(
  p_user_id uuid,
  p_content_id uuid,
  p_content_type text,
  p_duration integer,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stats record;
  v_is_suspicious boolean := false;
  v_fraud_score decimal := 0.0;
  v_reasons text[] := ARRAY[]::text[];
  v_plays_last_5min integer;
  v_same_content_plays integer;
  v_time_since_last_play interval;
BEGIN
  -- Get or create user statistics
  INSERT INTO user_play_statistics (user_id, last_play_at)
  VALUES (p_user_id, now())
  ON CONFLICT (user_id) DO NOTHING;
  
  SELECT * INTO v_stats FROM user_play_statistics WHERE user_id = p_user_id;
  
  -- Check 1: Excessive plays in short time (more than 20 plays in 5 minutes)
  SELECT COUNT(*) INTO v_plays_last_5min
  FROM listening_history
  WHERE user_id = p_user_id
    AND listened_at > now() - interval '5 minutes';
  
  IF v_plays_last_5min > 20 THEN
    v_is_suspicious := true;
    v_fraud_score := v_fraud_score + 40.0;
    v_reasons := array_append(v_reasons, 'Excessive plays in 5 minutes');
  END IF;
  
  -- Check 2: Same content played too frequently (more than 10 times in 1 hour)
  SELECT COUNT(*) INTO v_same_content_plays
  FROM listening_history
  WHERE user_id = p_user_id
    AND listened_at > now() - interval '1 hour'
    AND (
      (p_content_type = 'song' AND song_id = p_content_id) OR
      (p_content_type IN ('video', 'clip') AND content_upload_id = p_content_id)
    );
  
  IF v_same_content_plays > 10 THEN
    v_is_suspicious := true;
    v_fraud_score := v_fraud_score + 30.0;
    v_reasons := array_append(v_reasons, 'Same content played excessively');
  END IF;
  
  -- Check 3: Rapid sequential plays (less than 5 seconds between plays)
  IF v_stats.last_play_at IS NOT NULL THEN
    v_time_since_last_play := now() - v_stats.last_play_at;
    IF v_time_since_last_play < interval '5 seconds' THEN
      v_is_suspicious := true;
      v_fraud_score := v_fraud_score + 25.0;
      v_reasons := array_append(v_reasons, 'Rapid sequential plays detected');
      
      -- Update rapid plays counter
      UPDATE user_play_statistics
      SET rapid_plays_count = rapid_plays_count + 1
      WHERE user_id = p_user_id;
    END IF;
  END IF;
  
  -- Check 4: Abnormal hourly activity (more than 100 plays per hour)
  IF v_stats.total_plays_this_hour > 100 THEN
    v_is_suspicious := true;
    v_fraud_score := v_fraud_score + 35.0;
    v_reasons := array_append(v_reasons, 'Abnormal hourly activity');
  END IF;
  
  -- Check 5: Low unique content ratio (playing same few songs repeatedly)
  IF v_stats.total_plays_today > 50 AND v_stats.unique_content_today < 5 THEN
    v_is_suspicious := true;
    v_fraud_score := v_fraud_score + 20.0;
    v_reasons := array_append(v_reasons, 'Low content diversity');
  END IF;
  
  -- Check 6: Multiple rapid plays from flagged users
  IF v_stats.is_flagged AND v_stats.rapid_plays_count > 5 THEN
    v_is_suspicious := true;
    v_fraud_score := v_fraud_score + 50.0;
    v_reasons := array_append(v_reasons, 'Previously flagged user with continued suspicious behavior');
  END IF;
  
  -- Log suspicious activity
  IF v_is_suspicious THEN
    INSERT INTO play_fraud_detection (
      user_id,
      content_id,
      content_type,
      ip_address,
      user_agent,
      play_duration,
      flagged_reason,
      is_suspicious
    ) VALUES (
      p_user_id,
      p_content_id,
      p_content_type,
      p_ip_address,
      p_user_agent,
      p_duration,
      array_to_string(v_reasons, ', '),
      true
    );
    
    -- Flag user if fraud score is very high
    IF v_fraud_score >= 60.0 THEN
      UPDATE user_play_statistics
      SET is_flagged = true
      WHERE user_id = p_user_id;
    END IF;
  END IF;
  
  -- Calculate validation score (100 = legitimate, 0 = fraudulent)
  RETURN jsonb_build_object(
    'is_valid', NOT v_is_suspicious OR v_fraud_score < 50.0,
    'is_suspicious', v_is_suspicious,
    'fraud_score', v_fraud_score,
    'validation_score', 100.0 - v_fraud_score,
    'reasons', v_reasons
  );
END;
$$;

-- Function to update user play statistics
CREATE OR REPLACE FUNCTION update_user_play_statistics(
  p_user_id uuid,
  p_content_id uuid,
  p_content_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_new_content boolean;
BEGIN
  -- Check if this is new content for today
  SELECT NOT EXISTS (
    SELECT 1 FROM listening_history
    WHERE user_id = p_user_id
      AND listened_at > date_trunc('day', now())
      AND (
        (p_content_type = 'song' AND song_id = p_content_id) OR
        (p_content_type IN ('video', 'clip') AND content_upload_id = p_content_id)
      )
  ) INTO v_is_new_content;
  
  -- Update statistics
  INSERT INTO user_play_statistics (
    user_id,
    total_plays_today,
    total_plays_this_hour,
    unique_content_today,
    last_play_at,
    updated_at
  ) VALUES (
    p_user_id,
    1,
    1,
    CASE WHEN v_is_new_content THEN 1 ELSE 0 END,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_plays_today = user_play_statistics.total_plays_today + 1,
    total_plays_this_hour = user_play_statistics.total_plays_this_hour + 1,
    unique_content_today = user_play_statistics.unique_content_today + CASE WHEN v_is_new_content THEN 1 ELSE 0 END,
    last_play_at = now(),
    updated_at = now();
END;
$$;

-- Function to reset hourly statistics (should be called via cron job)
CREATE OR REPLACE FUNCTION reset_hourly_play_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE user_play_statistics
  SET 
    total_plays_this_hour = 0,
    updated_at = now()
  WHERE last_play_at < date_trunc('hour', now());
END;
$$;

-- Function to reset daily statistics (should be called via cron job)
CREATE OR REPLACE FUNCTION reset_daily_play_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE user_play_statistics
  SET 
    total_plays_today = 0,
    unique_content_today = 0,
    rapid_plays_count = 0,
    updated_at = now()
  WHERE last_play_at < date_trunc('day', now());
END;
$$;

-- Enhanced increment play count with validation
CREATE OR REPLACE FUNCTION increment_play_count_validated(
  p_song_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_duration integer DEFAULT 0,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_validation_result jsonb;
  v_is_valid boolean;
BEGIN
  -- Validate minimum duration (65 seconds for songs)
  IF p_duration < 65 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'Duration less than required minimum (65 seconds)',
      'duration', p_duration
    );
  END IF;
  
  -- Run fraud detection if user is authenticated
  IF p_user_id IS NOT NULL THEN
    v_validation_result := detect_fraud_patterns(
      p_user_id,
      p_song_id,
      'song',
      p_duration,
      p_ip_address,
      p_user_agent
    );
    
    v_is_valid := (v_validation_result->>'is_valid')::boolean;
    
    -- Update play statistics
    PERFORM update_user_play_statistics(p_user_id, p_song_id, 'song');
    
    -- Only increment if valid
    IF v_is_valid THEN
      UPDATE songs
      SET play_count = COALESCE(play_count, 0) + 1
      WHERE id = p_song_id;
      
      RETURN jsonb_build_object(
        'success', true,
        'validation', v_validation_result
      );
    ELSE
      -- Don't increment but log the attempt
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'Play flagged as suspicious',
        'validation', v_validation_result
      );
    END IF;
  ELSE
    -- Anonymous user - apply basic validation only
    UPDATE songs
    SET play_count = COALESCE(play_count, 0) + 1
    WHERE id = p_song_id;
    
    RETURN jsonb_build_object(
      'success', true,
      'validation', jsonb_build_object('is_valid', true, 'anonymous', true)
    );
  END IF;
END;
$$;

-- Enhanced increment clip/video play count with validation
CREATE OR REPLACE FUNCTION increment_clip_play_count_validated(
  p_content_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_duration integer DEFAULT 0,
  p_content_type text DEFAULT 'clip',
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_validation_result jsonb;
  v_is_valid boolean;
  v_min_duration integer;
BEGIN
  -- Determine minimum duration based on content type
  v_min_duration := CASE 
    WHEN p_content_type = 'clip' THEN 5
    WHEN p_content_type = 'video' THEN 65
    ELSE 10
  END;
  
  -- Validate minimum duration
  IF p_duration < v_min_duration THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', format('Duration less than required minimum (%s seconds)', v_min_duration),
      'duration', p_duration
    );
  END IF;
  
  -- Run fraud detection if user is authenticated
  IF p_user_id IS NOT NULL THEN
    v_validation_result := detect_fraud_patterns(
      p_user_id,
      p_content_id,
      p_content_type,
      p_duration,
      p_ip_address,
      p_user_agent
    );
    
    v_is_valid := (v_validation_result->>'is_valid')::boolean;
    
    -- Update play statistics
    PERFORM update_user_play_statistics(p_user_id, p_content_id, p_content_type);
    
    -- Only increment if valid
    IF v_is_valid THEN
      UPDATE content_uploads
      SET play_count = COALESCE(play_count, 0) + 1
      WHERE id = p_content_id;
      
      RETURN jsonb_build_object(
        'success', true,
        'validation', v_validation_result
      );
    ELSE
      -- Don't increment but log the attempt
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'Play flagged as suspicious',
        'validation', v_validation_result
      );
    END IF;
  ELSE
    -- Anonymous user - apply basic validation only
    UPDATE content_uploads
    SET play_count = COALESCE(play_count, 0) + 1
    WHERE id = p_content_id;
    
    RETURN jsonb_build_object(
      'success', true,
      'validation', jsonb_build_object('is_valid', true, 'anonymous', true)
    );
  END IF;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION detect_fraud_patterns(uuid, uuid, text, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION detect_fraud_patterns(uuid, uuid, text, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION update_user_play_statistics(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_play_statistics(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION reset_hourly_play_stats() TO service_role;
GRANT EXECUTE ON FUNCTION reset_daily_play_stats() TO service_role;
GRANT EXECUTE ON FUNCTION increment_play_count_validated(uuid, uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_play_count_validated(uuid, uuid, integer, text, text) TO anon;
GRANT EXECUTE ON FUNCTION increment_play_count_validated(uuid, uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION increment_clip_play_count_validated(uuid, uuid, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_clip_play_count_validated(uuid, uuid, integer, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION increment_clip_play_count_validated(uuid, uuid, integer, text, text, text) TO service_role;
