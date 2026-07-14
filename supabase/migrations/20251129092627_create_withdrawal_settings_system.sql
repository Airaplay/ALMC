/*
  # Create Withdrawal Settings Management System

  1. New Tables
    - `withdrawal_settings`
      - `id` (uuid, primary key)
      - `exchange_rate` (decimal, live balance to USD conversion rate)
      - `withdrawal_fee_type` (text, 'percentage' or 'fixed')
      - `withdrawal_fee_value` (decimal, fee amount or percentage)
      - `withdrawals_enabled` (boolean, master toggle)
      - `disabled_reason` (text, optional reason when disabled)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `last_updated_by` (uuid, admin user id)

    - `withdrawal_settings_audit_log`
      - `id` (uuid, primary key)
      - `admin_id` (uuid, admin who made the change)
      - `action` (text, 'create' or 'update')
      - `previous_values` (jsonb, previous settings)
      - `new_values` (jsonb, new settings)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Only admins can read/write settings
    - All changes are logged to audit table

  3. Functions
    - `admin_get_withdrawal_settings()` - Get current settings
    - `admin_update_withdrawal_settings()` - Update settings with audit logging
    - `get_current_exchange_rate()` - Get current exchange rate for public use
    - `are_withdrawals_enabled()` - Check if withdrawals are enabled
*/

-- Create withdrawal_settings table
CREATE TABLE IF NOT EXISTS withdrawal_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_rate decimal(10, 4) NOT NULL DEFAULT 1.0 CHECK (exchange_rate > 0),
  withdrawal_fee_type text NOT NULL DEFAULT 'percentage' CHECK (withdrawal_fee_type IN ('percentage', 'fixed')),
  withdrawal_fee_value decimal(10, 4) NOT NULL DEFAULT 0.0 CHECK (withdrawal_fee_value >= 0),
  withdrawals_enabled boolean NOT NULL DEFAULT true,
  disabled_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_updated_by uuid REFERENCES auth.users(id)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_withdrawal_settings_updated_at ON withdrawal_settings(updated_at DESC);

-- Enable RLS
ALTER TABLE withdrawal_settings ENABLE ROW LEVEL SECURITY;

-- Create policies for withdrawal_settings
CREATE POLICY "Admins can read withdrawal settings"
  ON withdrawal_settings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert withdrawal settings"
  ON withdrawal_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can update withdrawal settings"
  ON withdrawal_settings
  FOR UPDATE
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

-- Create withdrawal_settings_audit_log table
CREATE TABLE IF NOT EXISTS withdrawal_settings_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL CHECK (action IN ('create', 'update', 'toggle')),
  previous_values jsonb,
  new_values jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create index for audit log queries
CREATE INDEX IF NOT EXISTS idx_withdrawal_settings_audit_admin ON withdrawal_settings_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawal_settings_audit_created ON withdrawal_settings_audit_log(created_at DESC);

-- Enable RLS
ALTER TABLE withdrawal_settings_audit_log ENABLE ROW LEVEL SECURITY;

-- Create policies for audit log
CREATE POLICY "Admins can read withdrawal settings audit log"
  ON withdrawal_settings_audit_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert audit log"
  ON withdrawal_settings_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Function to get current withdrawal settings (admin only)
CREATE OR REPLACE FUNCTION admin_get_withdrawal_settings()
RETURNS TABLE (
  id uuid,
  exchange_rate decimal,
  withdrawal_fee_type text,
  withdrawal_fee_value decimal,
  withdrawals_enabled boolean,
  disabled_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  last_updated_by uuid,
  admin_email text,
  admin_display_name text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    ws.id,
    ws.exchange_rate,
    ws.withdrawal_fee_type,
    ws.withdrawal_fee_value,
    ws.withdrawals_enabled,
    ws.disabled_reason,
    ws.created_at,
    ws.updated_at,
    ws.last_updated_by,
    u.email as admin_email,
    u.display_name as admin_display_name
  FROM withdrawal_settings ws
  LEFT JOIN users u ON u.id = ws.last_updated_by
  ORDER BY ws.updated_at DESC
  LIMIT 1;
END;
$$;

-- Function to update withdrawal settings (admin only)
CREATE OR REPLACE FUNCTION admin_update_withdrawal_settings(
  p_exchange_rate decimal DEFAULT NULL,
  p_withdrawal_fee_type text DEFAULT NULL,
  p_withdrawal_fee_value decimal DEFAULT NULL,
  p_withdrawals_enabled boolean DEFAULT NULL,
  p_disabled_reason text DEFAULT NULL
)
RETURNS json
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin_id uuid;
  v_settings_id uuid;
  v_previous_values jsonb;
  v_new_values jsonb;
  v_current_settings record;
BEGIN
  -- Get admin user ID
  v_admin_id := auth.uid();

  -- Verify admin role
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = v_admin_id
    AND users.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Validate inputs
  IF p_exchange_rate IS NOT NULL AND p_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'Exchange rate must be greater than 0';
  END IF;

  IF p_withdrawal_fee_type IS NOT NULL AND p_withdrawal_fee_type NOT IN ('percentage', 'fixed') THEN
    RAISE EXCEPTION 'Withdrawal fee type must be either "percentage" or "fixed"';
  END IF;

  IF p_withdrawal_fee_value IS NOT NULL AND p_withdrawal_fee_value < 0 THEN
    RAISE EXCEPTION 'Withdrawal fee value cannot be negative';
  END IF;

  IF p_withdrawal_fee_type = 'percentage' AND p_withdrawal_fee_value IS NOT NULL AND p_withdrawal_fee_value > 100 THEN
    RAISE EXCEPTION 'Withdrawal fee percentage cannot exceed 100%%';
  END IF;

  -- Get current settings
  SELECT * INTO v_current_settings
  FROM withdrawal_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_current_settings IS NULL THEN
    -- Create initial settings
    INSERT INTO withdrawal_settings (
      exchange_rate,
      withdrawal_fee_type,
      withdrawal_fee_value,
      withdrawals_enabled,
      disabled_reason,
      last_updated_by
    )
    VALUES (
      COALESCE(p_exchange_rate, 1.0),
      COALESCE(p_withdrawal_fee_type, 'percentage'),
      COALESCE(p_withdrawal_fee_value, 0.0),
      COALESCE(p_withdrawals_enabled, true),
      p_disabled_reason,
      v_admin_id
    )
    RETURNING id INTO v_settings_id;

    -- Create audit log for creation
    v_new_values := jsonb_build_object(
      'exchange_rate', COALESCE(p_exchange_rate, 1.0),
      'withdrawal_fee_type', COALESCE(p_withdrawal_fee_type, 'percentage'),
      'withdrawal_fee_value', COALESCE(p_withdrawal_fee_value, 0.0),
      'withdrawals_enabled', COALESCE(p_withdrawals_enabled, true),
      'disabled_reason', p_disabled_reason
    );

    INSERT INTO withdrawal_settings_audit_log (
      admin_id,
      action,
      previous_values,
      new_values
    )
    VALUES (
      v_admin_id,
      'create',
      NULL,
      v_new_values
    );
  ELSE
    -- Update existing settings
    v_settings_id := v_current_settings.id;

    -- Store previous values for audit
    v_previous_values := jsonb_build_object(
      'exchange_rate', v_current_settings.exchange_rate,
      'withdrawal_fee_type', v_current_settings.withdrawal_fee_type,
      'withdrawal_fee_value', v_current_settings.withdrawal_fee_value,
      'withdrawals_enabled', v_current_settings.withdrawals_enabled,
      'disabled_reason', v_current_settings.disabled_reason
    );

    UPDATE withdrawal_settings
    SET
      exchange_rate = COALESCE(p_exchange_rate, exchange_rate),
      withdrawal_fee_type = COALESCE(p_withdrawal_fee_type, withdrawal_fee_type),
      withdrawal_fee_value = COALESCE(p_withdrawal_fee_value, withdrawal_fee_value),
      withdrawals_enabled = COALESCE(p_withdrawals_enabled, withdrawals_enabled),
      disabled_reason = CASE
        WHEN p_disabled_reason IS NOT NULL THEN p_disabled_reason
        WHEN p_withdrawals_enabled = true THEN NULL
        ELSE disabled_reason
      END,
      updated_at = now(),
      last_updated_by = v_admin_id
    WHERE id = v_settings_id;

    -- Store new values for audit
    SELECT jsonb_build_object(
      'exchange_rate', exchange_rate,
      'withdrawal_fee_type', withdrawal_fee_type,
      'withdrawal_fee_value', withdrawal_fee_value,
      'withdrawals_enabled', withdrawals_enabled,
      'disabled_reason', disabled_reason
    ) INTO v_new_values
    FROM withdrawal_settings
    WHERE id = v_settings_id;

    -- Create audit log for update
    INSERT INTO withdrawal_settings_audit_log (
      admin_id,
      action,
      previous_values,
      new_values
    )
    VALUES (
      v_admin_id,
      'update',
      v_previous_values,
      v_new_values
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', 'Withdrawal settings updated successfully',
    'settings_id', v_settings_id
  );
END;
$$;

-- Function to get current exchange rate (public, for withdrawal calculations)
CREATE OR REPLACE FUNCTION get_current_exchange_rate()
RETURNS decimal
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate decimal;
BEGIN
  SELECT exchange_rate INTO v_rate
  FROM withdrawal_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  -- Return default rate if not set
  RETURN COALESCE(v_rate, 1.0);
END;
$$;

-- Function to check if withdrawals are enabled (public)
CREATE OR REPLACE FUNCTION are_withdrawals_enabled()
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT withdrawals_enabled INTO v_enabled
  FROM withdrawal_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  -- Return true by default if not set
  RETURN COALESCE(v_enabled, true);
END;
$$;

-- Function to get withdrawal fee configuration (public)
CREATE OR REPLACE FUNCTION get_withdrawal_fee_config()
RETURNS TABLE (
  fee_type text,
  fee_value decimal
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    withdrawal_fee_type as fee_type,
    withdrawal_fee_value as fee_value
  FROM withdrawal_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  -- Return default if not set
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'percentage'::text, 0.0::decimal;
  END IF;
END;
$$;

-- Insert default withdrawal settings if none exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM withdrawal_settings) THEN
    INSERT INTO withdrawal_settings (
      exchange_rate,
      withdrawal_fee_type,
      withdrawal_fee_value,
      withdrawals_enabled
    )
    VALUES (
      1.0,
      'percentage',
      0.0,
      true
    );
  END IF;
END $$;

-- Grant execute permissions to authenticated users for public functions
GRANT EXECUTE ON FUNCTION get_current_exchange_rate() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION are_withdrawals_enabled() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_withdrawal_fee_config() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION admin_get_withdrawal_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_withdrawal_settings(decimal, text, decimal, boolean, text) TO authenticated;
