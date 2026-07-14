/*
  # Fix admin functions for withdrawal and payout management

  1. Changes
    - Properly drop and recreate admin functions with correct signatures
    - Fix return types for admin_approve_withdrawal and admin_reject_withdrawal
    - Ensure proper parameter names for all functions
    - Add proper error handling and validation

  2. Security
    - All functions run with SECURITY DEFINER to ensure proper permissions
    - Admin role checks in all functions
    - Proper validation of input parameters
*/

-- Drop all existing functions first to avoid return type conflicts
DROP FUNCTION IF EXISTS admin_get_payout_settings(text, text, uuid);
DROP FUNCTION IF EXISTS admin_get_withdrawal_requests(text);
DROP FUNCTION IF EXISTS admin_approve_withdrawal(uuid, text);
DROP FUNCTION IF EXISTS admin_reject_withdrawal(uuid, text);
DROP FUNCTION IF EXISTS admin_update_payout_settings(uuid, numeric, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS admin_create_payout_settings(text, text, uuid, numeric, numeric, numeric, numeric);

-- Create the corrected admin_get_payout_settings function
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
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  -- Return payout settings with optional filters
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
    (setting_type_filter IS NULL OR ps.setting_type = setting_type_filter)
    AND (country_code_filter IS NULL OR ps.country_code = country_code_filter)
    AND (user_id_filter IS NULL OR ps.user_id = user_id_filter)
  ORDER BY 
    CASE ps.setting_type
      WHEN 'global' THEN 1
      WHEN 'country' THEN 2
      WHEN 'user' THEN 3
    END,
    ps.country_code NULLS LAST,
    u.display_name NULLS LAST,
    ps.created_at DESC;
END;
$$;

-- Create admin_get_withdrawal_requests function
CREATE OR REPLACE FUNCTION admin_get_withdrawal_requests(
  status_filter text DEFAULT NULL
)
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
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  -- Return withdrawal requests with optional status filter
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
    (status_filter IS NULL OR wr.status = status_filter)
  ORDER BY 
    CASE wr.status
      WHEN 'pending' THEN 1
      WHEN 'approved' THEN 2
      WHEN 'rejected' THEN 3
    END,
    wr.request_date DESC;
END;
$$;

-- Create admin_approve_withdrawal function
CREATE OR REPLACE FUNCTION admin_approve_withdrawal(
  request_id uuid,
  admin_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  -- Update the withdrawal request
  UPDATE withdrawal_requests 
  SET 
    status = 'approved',
    processed_date = now(),
    admin_notes = admin_approve_withdrawal.admin_notes
  WHERE id = request_id AND status = 'pending';

  -- Check if the update was successful
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Withdrawal request not found or already processed.');
  END IF;
  
  RETURN jsonb_build_object('success', true, 'message', 'Withdrawal request approved successfully');
END;
$$;

-- Create admin_reject_withdrawal function
CREATE OR REPLACE FUNCTION admin_reject_withdrawal(
  request_id uuid,
  admin_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  withdrawal_record record;
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  -- Get the withdrawal record
  SELECT * INTO withdrawal_record
  FROM withdrawal_requests
  WHERE id = request_id AND status = 'pending';
  
  -- Check if the withdrawal request exists
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Withdrawal request not found or already processed.');
  END IF;

  -- Update the withdrawal request
  UPDATE withdrawal_requests 
  SET 
    status = 'rejected',
    processed_date = now(),
    admin_notes = admin_reject_withdrawal.admin_notes
  WHERE id = request_id;
  
  -- Return funds to user
  UPDATE users
  SET 
    total_earnings = total_earnings + withdrawal_record.amount,
    updated_at = now()
  WHERE id = withdrawal_record.user_id;
  
  RETURN jsonb_build_object(
    'success', true, 
    'message', 'Withdrawal request rejected and funds returned to user',
    'amount', withdrawal_record.amount
  );
END;
$$;

-- Create admin_update_payout_settings function
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
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  -- Validate percentages sum to 100
  IF (new_artist_percentage + new_listener_percentage + new_platform_percentage) != 100 THEN
    RETURN jsonb_build_object('error', 'Percentages must sum to 100.');
  END IF;

  -- Validate threshold is positive
  IF new_payout_threshold < 1.0 THEN
    RETURN jsonb_build_object('error', 'Payout threshold must be at least $1.00.');
  END IF;

  -- Update the payout settings
  UPDATE payout_settings 
  SET 
    payout_threshold = new_payout_threshold,
    artist_percentage = new_artist_percentage,
    listener_percentage = new_listener_percentage,
    platform_percentage = new_platform_percentage,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = setting_id;

  -- Check if the update was successful
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Payout setting not found.');
  END IF;
  
  RETURN jsonb_build_object('success', true, 'message', 'Payout settings updated successfully');
END;
$$;

-- Create admin_create_payout_settings function
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
  new_setting_id uuid;
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  -- Validate setting type
  IF new_setting_type NOT IN ('global', 'country', 'user') THEN
    RETURN jsonb_build_object('error', 'Invalid setting type. Must be global, country, or user.');
  END IF;

  -- Validate type-specific requirements
  IF new_setting_type = 'global' AND (new_country_code IS NOT NULL OR new_user_id IS NOT NULL) THEN
    RETURN jsonb_build_object('error', 'Global settings cannot have country code or user ID.');
  END IF;
  
  IF new_setting_type = 'country' AND (new_country_code IS NULL OR new_user_id IS NOT NULL) THEN
    RETURN jsonb_build_object('error', 'Country settings must have country code and no user ID.');
  END IF;
  
  IF new_setting_type = 'user' AND (new_country_code IS NOT NULL OR new_user_id IS NULL) THEN
    RETURN jsonb_build_object('error', 'User settings must have user ID and no country code.');
  END IF;

  -- Validate percentages sum to 100
  IF (new_artist_percentage + new_listener_percentage + new_platform_percentage) != 100 THEN
    RETURN jsonb_build_object('error', 'Percentages must sum to 100.');
  END IF;

  -- Validate threshold is positive
  IF new_payout_threshold < 1.0 THEN
    RETURN jsonb_build_object('error', 'Payout threshold must be at least $1.00.');
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

  -- Insert the new payout settings
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
    auth.uid(),
    auth.uid()
  )
  RETURNING id INTO new_setting_id;

  RETURN jsonb_build_object(
    'success', true, 
    'message', 'Payout settings created successfully',
    'setting_id', new_setting_id
  );
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION admin_get_payout_settings(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_withdrawal_requests(text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_approve_withdrawal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reject_withdrawal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_payout_settings(uuid, numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_create_payout_settings(text, text, uuid, numeric, numeric, numeric, numeric) TO authenticated;