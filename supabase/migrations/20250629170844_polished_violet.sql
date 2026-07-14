/*
  # Earnings and Payout Management System

  1. New Tables
    - `withdrawal_requests` - Track user withdrawal requests
    - `payout_settings` - Store payout thresholds and percentage distributions

  2. Functions
    - Functions to manage withdrawal requests (approve/reject)
    - Functions to manage payout settings (create/update)
    - Functions to retrieve payout data for both admins and users

  3. Security
    - RLS policies for proper access control
    - Admin-only functions for managing payouts
    - User functions for requesting withdrawals
*/

-- Create withdrawal_requests table
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  wallet_address text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  request_date timestamptz DEFAULT now(),
  processed_date timestamptz,
  admin_notes text,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_id ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_request_date ON withdrawal_requests(request_date DESC);

-- RLS Policies for withdrawal_requests table
-- Users can view their own withdrawal requests
CREATE POLICY "Users can view their own withdrawal requests"
ON withdrawal_requests
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can create withdrawal requests
CREATE POLICY "Users can create withdrawal requests"
ON withdrawal_requests
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Admins can view all withdrawal requests
CREATE POLICY "Admins can view all withdrawal requests"
ON withdrawal_requests
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

-- Admins can update withdrawal requests
CREATE POLICY "Admins can update withdrawal requests"
ON withdrawal_requests
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

-- Create payout_settings table
CREATE TABLE IF NOT EXISTS payout_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_type text NOT NULL CHECK (setting_type IN ('global', 'country', 'user')),
  country_code text, -- NULL for global or user-specific settings
  user_id uuid REFERENCES users(id) ON DELETE CASCADE, -- NULL for global or country-specific settings
  payout_threshold numeric NOT NULL DEFAULT 10.0 CHECK (payout_threshold >= 1.0),
  artist_percentage numeric NOT NULL DEFAULT 45.0 CHECK (artist_percentage >= 0 AND artist_percentage <= 100),
  listener_percentage numeric NOT NULL DEFAULT 20.0 CHECK (listener_percentage >= 0 AND listener_percentage <= 100),
  platform_percentage numeric NOT NULL DEFAULT 35.0 CHECK (platform_percentage >= 0 AND platform_percentage <= 100),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  CONSTRAINT payout_settings_percentages_sum_check CHECK (artist_percentage + listener_percentage + platform_percentage = 100.0),
  CONSTRAINT payout_settings_type_constraint CHECK (
    (setting_type = 'global' AND country_code IS NULL AND user_id IS NULL) OR
    (setting_type = 'country' AND country_code IS NOT NULL AND user_id IS NULL) OR
    (setting_type = 'user' AND country_code IS NULL AND user_id IS NOT NULL)
  )
);

-- Create unique constraints separately to avoid the WHERE clause syntax error
CREATE UNIQUE INDEX idx_payout_settings_unique_global ON payout_settings (setting_type) 
WHERE setting_type = 'global';

CREATE UNIQUE INDEX idx_payout_settings_unique_country ON payout_settings (country_code) 
WHERE setting_type = 'country' AND country_code IS NOT NULL;

CREATE UNIQUE INDEX idx_payout_settings_unique_user ON payout_settings (user_id) 
WHERE setting_type = 'user' AND user_id IS NOT NULL;

-- Enable Row Level Security (RLS)
ALTER TABLE payout_settings ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_payout_settings_type ON payout_settings(setting_type);
CREATE INDEX IF NOT EXISTS idx_payout_settings_country ON payout_settings(country_code) WHERE country_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_settings_user ON payout_settings(user_id) WHERE user_id IS NOT NULL;

-- RLS Policies for payout_settings table
-- Public can read global and country-specific payout settings
CREATE POLICY "Public can read global and country payout settings"
ON payout_settings
FOR SELECT
TO public
USING (
  setting_type IN ('global', 'country')
);

-- Users can read their own user-specific payout settings
CREATE POLICY "Users can read their own payout settings"
ON payout_settings
FOR SELECT
TO authenticated
USING (
  setting_type = 'user' AND user_id = auth.uid()
);

-- Admins can manage all payout settings
CREATE POLICY "Admins can manage all payout settings"
ON payout_settings
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

-- Insert default global payout settings if not exists
DO $$
DECLARE
  admin_id uuid;
BEGIN
  -- Get an admin user ID if available
  SELECT id INTO admin_id
  FROM users
  WHERE role = 'admin'
  LIMIT 1;

  -- Only insert if we don't already have global settings
  IF NOT EXISTS (SELECT 1 FROM payout_settings WHERE setting_type = 'global') THEN
    INSERT INTO payout_settings (
      setting_type,
      payout_threshold,
      artist_percentage,
      listener_percentage,
      platform_percentage,
      created_by,
      updated_by
    ) VALUES (
      'global',
      10.0,
      45.0,
      20.0,
      35.0,
      admin_id,
      admin_id
    );
  END IF;
END $$;

-- Function to get withdrawal requests for admin
CREATE OR REPLACE FUNCTION admin_get_withdrawal_requests(status_filter text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_email text,
  user_display_name text,
  amount numeric,
  wallet_address text,
  status text,
  request_date timestamptz,
  processed_date timestamptz,
  admin_notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  is_admin boolean;
BEGIN
  -- Check if user is an admin
  SELECT (role = 'admin') INTO is_admin
  FROM users
  WHERE id = current_user_id;
  
  IF NOT is_admin THEN
    RAISE EXCEPTION 'Only administrators can access withdrawal requests';
  END IF;

  RETURN QUERY
  SELECT 
    wr.id,
    wr.user_id,
    u.email as user_email,
    u.display_name as user_display_name,
    wr.amount,
    wr.wallet_address,
    wr.status,
    wr.request_date,
    wr.processed_date,
    wr.admin_notes
  FROM withdrawal_requests wr
  JOIN users u ON wr.user_id = u.id
  WHERE 
    status_filter IS NULL OR wr.status = status_filter
  ORDER BY 
    CASE 
      WHEN wr.status = 'pending' THEN 0
      WHEN wr.status = 'approved' THEN 1
      ELSE 2
    END,
    wr.request_date DESC;
END;
$$;

-- Function to approve a withdrawal request
CREATE OR REPLACE FUNCTION admin_approve_withdrawal(request_uuid uuid, notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  is_admin boolean;
  withdrawal_record record;
  user_record record;
  result jsonb;
BEGIN
  -- Check if user is an admin
  SELECT (role = 'admin') INTO is_admin
  FROM users
  WHERE id = current_user_id;
  
  IF NOT is_admin THEN
    RETURN jsonb_build_object('error', 'Only administrators can approve withdrawals');
  END IF;

  -- Get withdrawal request
  SELECT * INTO withdrawal_record
  FROM withdrawal_requests
  WHERE id = request_uuid;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Withdrawal request not found');
  END IF;
  
  IF withdrawal_record.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Only pending withdrawals can be approved');
  END IF;
  
  -- Get user record
  SELECT * INTO user_record
  FROM users
  WHERE id = withdrawal_record.user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;
  
  -- Update withdrawal request
  UPDATE withdrawal_requests
  SET 
    status = 'approved',
    processed_date = now(),
    admin_notes = COALESCE(notes, admin_notes)
  WHERE id = request_uuid;
  
  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Withdrawal request approved successfully',
    'withdrawal_id', request_uuid,
    'user_id', withdrawal_record.user_id,
    'amount', withdrawal_record.amount,
    'processed_date', now()
  );
END;
$$;

-- Function to reject a withdrawal request
CREATE OR REPLACE FUNCTION admin_reject_withdrawal(request_uuid uuid, notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  is_admin boolean;
  withdrawal_record record;
  user_record record;
  result jsonb;
BEGIN
  -- Check if user is an admin
  SELECT (role = 'admin') INTO is_admin
  FROM users
  WHERE id = current_user_id;
  
  IF NOT is_admin THEN
    RETURN jsonb_build_object('error', 'Only administrators can reject withdrawals');
  END IF;

  -- Get withdrawal request
  SELECT * INTO withdrawal_record
  FROM withdrawal_requests
  WHERE id = request_uuid;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Withdrawal request not found');
  END IF;
  
  IF withdrawal_record.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Only pending withdrawals can be rejected');
  END IF;
  
  -- Get user record
  SELECT * INTO user_record
  FROM users
  WHERE id = withdrawal_record.user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;
  
  -- Update withdrawal request
  UPDATE withdrawal_requests
  SET 
    status = 'rejected',
    processed_date = now(),
    admin_notes = COALESCE(notes, admin_notes)
  WHERE id = request_uuid;
  
  -- Return funds to user
  UPDATE users
  SET 
    total_earnings = total_earnings + withdrawal_record.amount,
    updated_at = now()
  WHERE id = withdrawal_record.user_id;
  
  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Withdrawal request rejected and funds returned to user',
    'withdrawal_id', request_uuid,
    'user_id', withdrawal_record.user_id,
    'amount', withdrawal_record.amount,
    'processed_date', now()
  );
END;
$$;

-- Function to get payout settings
CREATE OR REPLACE FUNCTION admin_get_payout_settings(
  setting_type_filter text DEFAULT NULL,
  country_code_filter text DEFAULT NULL,
  user_id_filter uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  setting_type text,
  country_code text,
  user_id uuid,
  user_email text,
  user_display_name text,
  payout_threshold numeric,
  artist_percentage numeric,
  listener_percentage numeric,
  platform_percentage numeric,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  is_admin boolean;
BEGIN
  -- Check if user is an admin
  SELECT (role = 'admin') INTO is_admin
  FROM users
  WHERE id = current_user_id;
  
  IF NOT is_admin THEN
    RAISE EXCEPTION 'Only administrators can access payout settings';
  END IF;

  RETURN QUERY
  SELECT 
    ps.id,
    ps.setting_type,
    ps.country_code,
    ps.user_id,
    u.email as user_email,
    u.display_name as user_display_name,
    ps.payout_threshold,
    ps.artist_percentage,
    ps.listener_percentage,
    ps.platform_percentage,
    ps.created_at,
    ps.updated_at
  FROM payout_settings ps
  LEFT JOIN users u ON ps.user_id = u.id
  WHERE 
    (setting_type_filter IS NULL OR ps.setting_type = setting_type_filter) AND
    (country_code_filter IS NULL OR ps.country_code = country_code_filter) AND
    (user_id_filter IS NULL OR ps.user_id = user_id_filter)
  ORDER BY 
    CASE 
      WHEN ps.setting_type = 'global' THEN 0
      WHEN ps.setting_type = 'country' THEN 1
      ELSE 2
    END,
    ps.country_code,
    u.display_name;
END;
$$;

-- Function to update payout settings
CREATE OR REPLACE FUNCTION admin_update_payout_settings(
  setting_id uuid,
  new_payout_threshold numeric,
  new_artist_percentage numeric,
  new_listener_percentage numeric,
  new_platform_percentage numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  is_admin boolean;
  setting_record record;
  result jsonb;
BEGIN
  -- Check if user is an admin
  SELECT (role = 'admin') INTO is_admin
  FROM users
  WHERE id = current_user_id;
  
  IF NOT is_admin THEN
    RETURN jsonb_build_object('error', 'Only administrators can update payout settings');
  END IF;

  -- Validate percentages sum to 100
  IF (new_artist_percentage + new_listener_percentage + new_platform_percentage) != 100.0 THEN
    RETURN jsonb_build_object('error', 'Percentages must sum to 100%');
  END IF;
  
  -- Validate threshold is at least 1.0
  IF new_payout_threshold < 1.0 THEN
    RETURN jsonb_build_object('error', 'Payout threshold must be at least $1.00');
  END IF;
  
  -- Get setting record
  SELECT * INTO setting_record
  FROM payout_settings
  WHERE id = setting_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Payout setting not found');
  END IF;
  
  -- Update payout setting
  UPDATE payout_settings
  SET 
    payout_threshold = new_payout_threshold,
    artist_percentage = new_artist_percentage,
    listener_percentage = new_listener_percentage,
    platform_percentage = new_platform_percentage,
    updated_at = now(),
    updated_by = current_user_id
  WHERE id = setting_id;
  
  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Payout settings updated successfully',
    'setting_id', setting_id,
    'setting_type', setting_record.setting_type
  );
END;
$$;

-- Function to create new payout settings
CREATE OR REPLACE FUNCTION admin_create_payout_settings(
  new_setting_type text,
  new_country_code text DEFAULT NULL,
  new_user_id uuid DEFAULT NULL,
  new_payout_threshold numeric DEFAULT 10.0,
  new_artist_percentage numeric DEFAULT 45.0,
  new_listener_percentage numeric DEFAULT 20.0,
  new_platform_percentage numeric DEFAULT 35.0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  is_admin boolean;
  new_setting_id uuid;
  result jsonb;
BEGIN
  -- Check if user is an admin
  SELECT (role = 'admin') INTO is_admin
  FROM users
  WHERE id = current_user_id;
  
  IF NOT is_admin THEN
    RETURN jsonb_build_object('error', 'Only administrators can create payout settings');
  END IF;

  -- Validate setting type
  IF new_setting_type NOT IN ('global', 'country', 'user') THEN
    RETURN jsonb_build_object('error', 'Invalid setting type. Must be global, country, or user');
  END IF;
  
  -- Validate type-specific parameters
  IF new_setting_type = 'global' AND (new_country_code IS NOT NULL OR new_user_id IS NOT NULL) THEN
    RETURN jsonb_build_object('error', 'Global settings cannot have country code or user ID');
  END IF;
  
  IF new_setting_type = 'country' AND (new_country_code IS NULL OR new_user_id IS NOT NULL) THEN
    RETURN jsonb_build_object('error', 'Country settings must have country code and no user ID');
  END IF;
  
  IF new_setting_type = 'user' AND (new_country_code IS NOT NULL OR new_user_id IS NULL) THEN
    RETURN jsonb_build_object('error', 'User settings must have user ID and no country code');
  END IF;
  
  -- Validate percentages sum to 100
  IF (new_artist_percentage + new_listener_percentage + new_platform_percentage) != 100.0 THEN
    RETURN jsonb_build_object('error', 'Percentages must sum to 100%');
  END IF;
  
  -- Validate threshold is at least 1.0
  IF new_payout_threshold < 1.0 THEN
    RETURN jsonb_build_object('error', 'Payout threshold must be at least $1.00');
  END IF;
  
  -- Check for existing settings
  IF new_setting_type = 'global' AND EXISTS (SELECT 1 FROM payout_settings WHERE setting_type = 'global') THEN
    RETURN jsonb_build_object('error', 'Global settings already exist. Use update instead.');
  END IF;
  
  IF new_setting_type = 'country' AND EXISTS (SELECT 1 FROM payout_settings WHERE setting_type = 'country' AND country_code = new_country_code) THEN
    RETURN jsonb_build_object('error', 'Settings for this country already exist. Use update instead.');
  END IF;
  
  IF new_setting_type = 'user' AND EXISTS (SELECT 1 FROM payout_settings WHERE setting_type = 'user' AND user_id = new_user_id) THEN
    RETURN jsonb_build_object('error', 'Settings for this user already exist. Use update instead.');
  END IF;
  
  -- Create new payout setting
  INSERT INTO payout_settings (
    setting_type,
    country_code,
    user_id,
    payout_threshold,
    artist_percentage,
    listener_percentage,
    platform_percentage,
    created_by,
    updated_by
  ) VALUES (
    new_setting_type,
    new_country_code,
    new_user_id,
    new_payout_threshold,
    new_artist_percentage,
    new_listener_percentage,
    new_platform_percentage,
    current_user_id,
    current_user_id
  )
  RETURNING id INTO new_setting_id;
  
  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Payout settings created successfully',
    'setting_id', new_setting_id,
    'setting_type', new_setting_type
  );
END;
$$;

-- Function to get applicable payout settings for a user
CREATE OR REPLACE FUNCTION get_user_payout_settings(user_uuid uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_country text;
  user_settings record;
  country_settings record;
  global_settings record;
  applicable_settings jsonb;
BEGIN
  -- Get user's country
  SELECT country INTO user_country
  FROM users
  WHERE id = user_uuid;
  
  -- Try to get user-specific settings
  SELECT * INTO user_settings
  FROM payout_settings
  WHERE setting_type = 'user' AND user_id = user_uuid;
  
  IF FOUND THEN
    applicable_settings := jsonb_build_object(
      'setting_type', 'user',
      'payout_threshold', user_settings.payout_threshold,
      'artist_percentage', user_settings.artist_percentage,
      'listener_percentage', user_settings.listener_percentage,
      'platform_percentage', user_settings.platform_percentage
    );
    RETURN applicable_settings;
  END IF;
  
  -- Try to get country-specific settings
  IF user_country IS NOT NULL THEN
    SELECT * INTO country_settings
    FROM payout_settings
    WHERE setting_type = 'country' AND country_code = user_country;
    
    IF FOUND THEN
      applicable_settings := jsonb_build_object(
        'setting_type', 'country',
        'country_code', user_country,
        'payout_threshold', country_settings.payout_threshold,
        'artist_percentage', country_settings.artist_percentage,
        'listener_percentage', country_settings.listener_percentage,
        'platform_percentage', country_settings.platform_percentage
      );
      RETURN applicable_settings;
    END IF;
  END IF;
  
  -- Fall back to global settings
  SELECT * INTO global_settings
  FROM payout_settings
  WHERE setting_type = 'global';
  
  IF FOUND THEN
    applicable_settings := jsonb_build_object(
      'setting_type', 'global',
      'payout_threshold', global_settings.payout_threshold,
      'artist_percentage', global_settings.artist_percentage,
      'listener_percentage', global_settings.listener_percentage,
      'platform_percentage', global_settings.platform_percentage
    );
    RETURN applicable_settings;
  END IF;
  
  -- If no settings found, return default values
  RETURN jsonb_build_object(
    'setting_type', 'default',
    'payout_threshold', 10.0,
    'artist_percentage', 45.0,
    'listener_percentage', 20.0,
    'platform_percentage', 35.0
  );
END;
$$;

-- Modify the existing withdraw_user_funds function to create a withdrawal request
CREATE OR REPLACE FUNCTION withdraw_user_funds(amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_earnings numeric;
  user_wallet_address text;
  payout_threshold numeric;
  result jsonb;
BEGIN
  -- Check if user is authenticated
  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Authentication required');
  END IF;

  -- Validate amount
  IF amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Withdrawal amount must be greater than 0');
  END IF;

  -- Get current user earnings and wallet address
  SELECT total_earnings, wallet_address INTO current_earnings, user_wallet_address
  FROM users
  WHERE id = current_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  -- Check if user has sufficient funds
  IF current_earnings < amount THEN
    RETURN jsonb_build_object('error', 'Insufficient funds for withdrawal');
  END IF;

  -- Check if user has wallet address
  IF user_wallet_address IS NULL OR user_wallet_address = '' THEN
    RETURN jsonb_build_object('error', 'Wallet address required for withdrawal');
  END IF;

  -- Get applicable payout threshold
  SELECT (get_user_payout_settings(current_user_id)->>'payout_threshold')::numeric INTO payout_threshold;
  
  -- Check if withdrawal meets minimum threshold
  IF amount < payout_threshold THEN
    RETURN jsonb_build_object(
      'error', 
      format('Minimum withdrawal amount is $%s', payout_threshold)
    );
  END IF;

  -- Deduct amount from user earnings
  UPDATE users
  SET 
    total_earnings = total_earnings - amount,
    updated_at = now()
  WHERE id = current_user_id;

  -- Create withdrawal request
  INSERT INTO withdrawal_requests (
    user_id,
    amount,
    wallet_address,
    status,
    request_date
  ) VALUES (
    current_user_id,
    amount,
    user_wallet_address,
    'pending',
    now()
  );

  -- Return success
  RETURN jsonb_build_object(
    'success', true, 
    'message', 'Withdrawal request submitted successfully',
    'amount', amount,
    'remaining_balance', current_earnings - amount
  );
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION admin_get_withdrawal_requests(text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_approve_withdrawal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reject_withdrawal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_payout_settings(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_payout_settings(uuid, numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_create_payout_settings(text, text, uuid, numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_payout_settings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION withdraw_user_funds(numeric) TO authenticated;