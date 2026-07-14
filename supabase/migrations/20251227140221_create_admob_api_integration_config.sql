/*
  # Google AdMob Reporting API Integration

  This migration creates the infrastructure for connecting to Google AdMob Reporting API
  to automatically fetch and sync revenue data.

  ## New Tables

  1. **admob_api_config**
     - Stores API credentials and configuration
     - Publisher ID, OAuth credentials, sync settings
     - Only one active configuration allowed

  2. **admob_sync_history**
     - Tracks all sync operations
     - Status, errors, data fetched
     - Complete audit trail

  ## Security

  - Credentials stored securely (service account JSON encrypted)
  - Admin-only access
  - Complete audit logging
*/

-- ============================================================================
-- 1. CREATE: admob_api_config table
-- ============================================================================
CREATE TABLE IF NOT EXISTS admob_api_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- AdMob Account Details
  publisher_id text NOT NULL,
  account_name text,
  
  -- OAuth/Service Account Configuration
  -- For service account: store the entire JSON key (encrypted in production)
  auth_type text NOT NULL DEFAULT 'service_account' CHECK (auth_type IN ('service_account', 'oauth2')),
  
  -- Service account credentials (stored securely)
  service_account_email text,
  service_account_key_id text,
  -- In production, store in Supabase Vault or use environment variables
  credentials_encrypted text,
  
  -- OAuth2 tokens (if using OAuth flow)
  oauth_client_id text,
  oauth_client_secret_encrypted text,
  oauth_refresh_token_encrypted text,
  oauth_access_token_encrypted text,
  oauth_token_expiry timestamptz,
  
  -- Sync Configuration
  auto_sync_enabled boolean DEFAULT false,
  sync_frequency_hours integer DEFAULT 24 CHECK (sync_frequency_hours >= 1 AND sync_frequency_hours <= 168),
  last_sync_at timestamptz,
  next_sync_at timestamptz,
  
  -- Data Range Settings
  sync_days_back integer DEFAULT 7 CHECK (sync_days_back >= 1 AND sync_days_back <= 90),
  apply_safety_buffer boolean DEFAULT true,
  default_safety_buffer_percentage numeric(5, 2) DEFAULT 75.00 CHECK (default_safety_buffer_percentage BETWEEN 50 AND 90),
  
  -- Status
  connection_status text DEFAULT 'disconnected' CHECK (connection_status IN ('disconnected', 'connected', 'error', 'syncing')),
  last_error text,
  last_error_at timestamptz,
  
  -- App Info (for multi-app publishers)
  app_ids jsonb DEFAULT '[]'::jsonb,
  
  -- Active flag
  is_active boolean DEFAULT true,
  
  -- Audit
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- Ensure only one active configuration
CREATE UNIQUE INDEX IF NOT EXISTS idx_admob_api_config_active ON admob_api_config(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_admob_api_config_status ON admob_api_config(connection_status);

-- RLS Policies
ALTER TABLE admob_api_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read admob api config"
  ON admob_api_config FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admin insert admob api config"
  ON admob_api_config FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admin update admob api config"
  ON admob_api_config FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admin delete admob api config"
  ON admob_api_config FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

-- ============================================================================
-- 2. CREATE: admob_sync_history table
-- ============================================================================
CREATE TABLE IF NOT EXISTS admob_sync_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid REFERENCES admob_api_config(id) ON DELETE CASCADE,
  
  -- Sync Details
  sync_type text NOT NULL DEFAULT 'manual' CHECK (sync_type IN ('manual', 'scheduled', 'retry')),
  sync_status text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'in_progress', 'completed', 'failed', 'partial')),
  
  -- Time Range Fetched
  date_range_start date NOT NULL,
  date_range_end date NOT NULL,
  
  -- Results
  records_fetched integer DEFAULT 0,
  records_processed integer DEFAULT 0,
  records_failed integer DEFAULT 0,
  
  -- Revenue Summary
  total_revenue_fetched numeric(12, 6) DEFAULT 0,
  banner_revenue numeric(12, 6) DEFAULT 0,
  interstitial_revenue numeric(12, 6) DEFAULT 0,
  rewarded_revenue numeric(12, 6) DEFAULT 0,
  native_revenue numeric(12, 6) DEFAULT 0,
  
  -- Processing Details
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer,
  
  -- Error Tracking
  error_message text,
  error_details jsonb,
  retry_count integer DEFAULT 0,
  
  -- Raw Response (for debugging, can be null in production)
  raw_response jsonb,
  
  -- Audit
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_admob_sync_history_config ON admob_sync_history(config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admob_sync_history_status ON admob_sync_history(sync_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admob_sync_history_date_range ON admob_sync_history(date_range_start, date_range_end);

-- RLS Policies
ALTER TABLE admob_sync_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage admob sync history"
  ON admob_sync_history FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

-- ============================================================================
-- 3. FUNCTION: Update AdMob config connection status
-- ============================================================================
CREATE OR REPLACE FUNCTION update_admob_connection_status(
  p_config_id uuid,
  p_status text,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_user_role text;
BEGIN
  -- Verify admin status
  SELECT id, role INTO v_admin_id, v_user_role
  FROM users
  WHERE id = auth.uid();
  
  IF v_user_role != 'admin' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Admin privileges required'
    );
  END IF;
  
  -- Update the config
  UPDATE admob_api_config
  SET 
    connection_status = p_status,
    last_error = CASE WHEN p_status = 'error' THEN p_error ELSE NULL END,
    last_error_at = CASE WHEN p_status = 'error' THEN now() ELSE NULL END,
    updated_at = now(),
    updated_by = v_admin_id
  WHERE id = p_config_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'status', p_status
  );
END;
$$;

-- ============================================================================
-- 4. FUNCTION: Record AdMob sync completion
-- ============================================================================
CREATE OR REPLACE FUNCTION record_admob_sync_completion(
  p_sync_id uuid,
  p_status text,
  p_records_fetched integer,
  p_records_processed integer,
  p_total_revenue numeric,
  p_banner_revenue numeric DEFAULT 0,
  p_interstitial_revenue numeric DEFAULT 0,
  p_rewarded_revenue numeric DEFAULT 0,
  p_native_revenue numeric DEFAULT 0,
  p_error_message text DEFAULT NULL,
  p_error_details jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sync_record RECORD;
  v_duration integer;
BEGIN
  -- Get the sync record
  SELECT * INTO v_sync_record
  FROM admob_sync_history
  WHERE id = p_sync_id;
  
  IF v_sync_record IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Sync record not found'
    );
  END IF;
  
  -- Calculate duration
  v_duration := EXTRACT(EPOCH FROM (now() - v_sync_record.started_at))::integer;
  
  -- Update the sync record
  UPDATE admob_sync_history
  SET 
    sync_status = p_status,
    records_fetched = p_records_fetched,
    records_processed = p_records_processed,
    total_revenue_fetched = p_total_revenue,
    banner_revenue = p_banner_revenue,
    interstitial_revenue = p_interstitial_revenue,
    rewarded_revenue = p_rewarded_revenue,
    native_revenue = p_native_revenue,
    completed_at = now(),
    duration_seconds = v_duration,
    error_message = p_error_message,
    error_details = p_error_details
  WHERE id = p_sync_id;
  
  -- Update the config's last sync time if successful
  IF p_status = 'completed' THEN
    UPDATE admob_api_config
    SET 
      last_sync_at = now(),
      next_sync_at = now() + (sync_frequency_hours || ' hours')::interval,
      connection_status = 'connected',
      last_error = NULL,
      last_error_at = NULL
    WHERE id = v_sync_record.config_id;
  ELSIF p_status = 'failed' THEN
    UPDATE admob_api_config
    SET 
      connection_status = 'error',
      last_error = p_error_message,
      last_error_at = now()
    WHERE id = v_sync_record.config_id;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'sync_id', p_sync_id,
    'status', p_status,
    'duration_seconds', v_duration
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION update_admob_connection_status TO authenticated;
GRANT EXECUTE ON FUNCTION record_admob_sync_completion TO authenticated;
