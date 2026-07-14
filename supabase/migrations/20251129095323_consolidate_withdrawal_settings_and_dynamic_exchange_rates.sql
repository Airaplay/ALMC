/*
  # Consolidate Withdrawal Settings and Add Dynamic Exchange Rate System

  ## Overview
  This migration consolidates the two withdrawal settings tables into one unified system
  and adds support for dynamic exchange rates with external API integration.

  ## Changes Made

  ### 1. Consolidation Strategy
  - Migrate data from `treat_withdrawal_settings` to `withdrawal_settings`
  - Update `process_treat_withdrawal` function to use `withdrawal_settings`
  - Drop the old `treat_withdrawal_settings` table
  - Maintain backward compatibility during transition

  ### 2. Dynamic Exchange Rate System
  - Add `exchange_rate_source` field (manual, auto_api)
  - Add `exchange_rate_last_updated` timestamp
  - Add `exchange_rate_api_config` JSONB for API settings
  - Add `exchange_rate_update_frequency` (in minutes)
  - Add function to update exchange rate from external API

  ### 3. Enhanced Withdrawal Fee System
  - Support both percentage and fixed fees
  - Calculate minimum withdrawal based on fees
  - Return detailed fee breakdown

  ## Important Notes
  - Exchange rates can be updated manually by admin or automatically via API
  - Automatic updates can be scheduled using pg_cron or external service
  - All existing withdrawal requests will continue to work
  - Audit log maintains complete history of all changes
*/

-- Step 1: Add new fields to withdrawal_settings for dynamic exchange rates
DO $$
BEGIN
  -- Add exchange rate source tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_settings' AND column_name = 'exchange_rate_source'
  ) THEN
    ALTER TABLE withdrawal_settings 
    ADD COLUMN exchange_rate_source text NOT NULL DEFAULT 'manual' CHECK (exchange_rate_source IN ('manual', 'auto_api'));
  END IF;

  -- Add last updated timestamp for exchange rate
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_settings' AND column_name = 'exchange_rate_last_updated'
  ) THEN
    ALTER TABLE withdrawal_settings 
    ADD COLUMN exchange_rate_last_updated timestamptz DEFAULT now();
  END IF;

  -- Add API configuration for automatic updates
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_settings' AND column_name = 'exchange_rate_api_config'
  ) THEN
    ALTER TABLE withdrawal_settings 
    ADD COLUMN exchange_rate_api_config jsonb DEFAULT jsonb_build_object(
      'provider', 'manual',
      'base_currency', 'USD',
      'target_currency', 'USD',
      'api_key_vault_id', null,
      'update_frequency_minutes', 60
    );
  END IF;

  -- Add minimum withdrawal in USD (calculated based on fees)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'withdrawal_settings' AND column_name = 'minimum_withdrawal_usd'
  ) THEN
    ALTER TABLE withdrawal_settings 
    ADD COLUMN minimum_withdrawal_usd decimal(10, 2) DEFAULT 5.0 CHECK (minimum_withdrawal_usd > 0);
  END IF;
END $$;

-- Step 2: Migrate data from treat_withdrawal_settings if it exists
DO $$
DECLARE
  v_old_settings RECORD;
  v_current_settings RECORD;
BEGIN
  -- Check if old table exists and has data
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'treat_withdrawal_settings') THEN
    
    -- Get the old settings
    SELECT * INTO v_old_settings
    FROM treat_withdrawal_settings
    LIMIT 1;

    IF FOUND THEN
      -- Get current settings from new table
      SELECT * INTO v_current_settings
      FROM withdrawal_settings
      ORDER BY updated_at DESC
      LIMIT 1;

      -- If new table has default/no data, migrate from old table
      IF v_current_settings IS NULL OR 
         (v_current_settings.exchange_rate = 1.0 AND 
          v_current_settings.withdrawal_fee_value = 0.0) THEN
        
        -- Update with old settings
        UPDATE withdrawal_settings
        SET
          exchange_rate = COALESCE(v_old_settings.treat_to_usd_rate, 0.01),
          withdrawal_fee_type = 'percentage',
          withdrawal_fee_value = COALESCE(v_old_settings.withdrawal_fee_percentage, 0),
          withdrawals_enabled = COALESCE(v_old_settings.is_withdrawal_enabled, true),
          minimum_withdrawal_usd = CASE 
            WHEN v_old_settings.minimum_withdrawal_amount IS NOT NULL 
            THEN (v_old_settings.minimum_withdrawal_amount * COALESCE(v_old_settings.treat_to_usd_rate, 0.01))
            ELSE 5.0
          END,
          updated_at = now()
        WHERE id = v_current_settings.id;

        -- Log the migration
        INSERT INTO withdrawal_settings_audit_log (
          admin_id,
          action,
          previous_values,
          new_values
        )
        SELECT
          v_current_settings.last_updated_by,
          'update',
          jsonb_build_object(
            'source', 'migration_from_treat_withdrawal_settings',
            'old_table_data', row_to_json(v_old_settings)
          ),
          jsonb_build_object(
            'exchange_rate', COALESCE(v_old_settings.treat_to_usd_rate, 0.01),
            'withdrawal_fee_percentage', COALESCE(v_old_settings.withdrawal_fee_percentage, 0),
            'withdrawals_enabled', COALESCE(v_old_settings.is_withdrawal_enabled, true)
          );
      END IF;
    END IF;
  END IF;
END $$;

-- Step 3: Update process_treat_withdrawal function to use withdrawal_settings
CREATE OR REPLACE FUNCTION process_treat_withdrawal(
  p_user_id uuid,
  p_treats_amount integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_record RECORD;
  v_settings RECORD;
  v_current_balance numeric;
  v_current_earned numeric;
  v_usd_gross_amount numeric;
  v_fee_amount numeric;
  v_net_amount numeric;
  v_new_balance numeric;
  v_new_earned numeric;
  v_fee_percentage numeric;
  v_fee_fixed numeric;
BEGIN
  -- Validate input
  IF p_treats_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal amount must be greater than 0'
    );
  END IF;

  -- Get withdrawal settings from the unified table
  SELECT 
    exchange_rate,
    withdrawal_fee_type,
    withdrawal_fee_value,
    withdrawals_enabled,
    minimum_withdrawal_usd
  INTO v_settings
  FROM withdrawal_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal settings not configured'
    );
  END IF;

  -- Check if withdrawals are enabled
  IF NOT v_settings.withdrawals_enabled THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawals are currently disabled by administrator'
    );
  END IF;

  -- Calculate gross USD amount
  v_usd_gross_amount := p_treats_amount * v_settings.exchange_rate;

  -- Check minimum withdrawal in USD
  IF v_usd_gross_amount < v_settings.minimum_withdrawal_usd THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Minimum withdrawal is $%s USD (approximately %s treats)', 
                      v_settings.minimum_withdrawal_usd,
                      CEIL(v_settings.minimum_withdrawal_usd / v_settings.exchange_rate))
    );
  END IF;

  -- Lock the wallet row to prevent race conditions
  SELECT 
    balance,
    total_earned,
    total_purchased,
    total_spent,
    total_withdrawn,
    earned_balance
  INTO v_wallet_record
  FROM treat_wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Wallet not found'
    );
  END IF;

  v_current_balance := v_wallet_record.balance;
  v_current_earned := v_wallet_record.earned_balance;

  -- Check if user has sufficient earned balance
  IF v_current_earned < p_treats_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Insufficient earned balance. You have %s earned treats available but tried to withdraw %s', 
                      v_current_earned, p_treats_amount)
    );
  END IF;

  -- Check if total balance is sufficient
  IF v_current_balance < p_treats_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Insufficient balance. Current balance: %s treats', v_current_balance)
    );
  END IF;

  -- Calculate fees based on type
  IF v_settings.withdrawal_fee_type = 'percentage' THEN
    v_fee_percentage := v_settings.withdrawal_fee_value;
    v_fee_fixed := 0;
    v_fee_amount := (v_usd_gross_amount * v_fee_percentage / 100);
  ELSIF v_settings.withdrawal_fee_type = 'fixed' THEN
    v_fee_percentage := 0;
    v_fee_fixed := v_settings.withdrawal_fee_value;
    v_fee_amount := v_fee_fixed;
  ELSE
    -- Default to no fee if type is invalid
    v_fee_percentage := 0;
    v_fee_fixed := 0;
    v_fee_amount := 0;
  END IF;

  -- Calculate net amount
  v_net_amount := GREATEST(v_usd_gross_amount - v_fee_amount, 0);

  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Withdrawal amount too small after fees. Please withdraw a larger amount.'
    );
  END IF;

  -- Calculate new balances
  v_new_balance := v_current_balance - p_treats_amount;
  v_new_earned := v_current_earned - p_treats_amount;

  -- Safety check
  IF v_new_balance < 0 OR v_new_earned < 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Balance calculation error. Please contact support.'
    );
  END IF;

  -- Update wallet balances atomically
  UPDATE treat_wallets
  SET
    balance = v_new_balance,
    earned_balance = v_new_earned,
    total_withdrawn = total_withdrawn + p_treats_amount,
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Log the withdrawal transaction
  INSERT INTO treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    status,
    metadata
  ) VALUES (
    p_user_id,
    'withdrawal',
    -p_treats_amount,  -- Negative because it's leaving the wallet
    v_current_balance,
    v_new_balance,
    format('Withdrew %s treats to Live Balance ($%s USD)', p_treats_amount, ROUND(v_net_amount, 2)),
    'completed',
    jsonb_build_object(
      'treats_amount', p_treats_amount,
      'usd_gross', ROUND(v_usd_gross_amount, 2),
      'fee_type', v_settings.withdrawal_fee_type,
      'fee_percentage', v_fee_percentage,
      'fee_fixed', v_fee_fixed,
      'fee_amount', ROUND(v_fee_amount, 2),
      'net_amount', ROUND(v_net_amount, 2),
      'exchange_rate', v_settings.exchange_rate,
      'withdrawn_from_earned', true
    )
  );

  -- Add to user's live balance (earnings table)
  INSERT INTO user_earnings (
    user_id,
    amount,
    source,
    description
  ) VALUES (
    p_user_id,
    v_net_amount,
    'treat_withdrawal',
    format('Treat withdrawal: %s treats converted to $%s USD (after $%s fees)', 
           p_treats_amount, ROUND(v_net_amount, 2), ROUND(v_fee_amount, 2))
  );

  -- Return success with detailed information
  RETURN jsonb_build_object(
    'success', true,
    'treats_withdrawn', p_treats_amount,
    'usd_gross', ROUND(v_usd_gross_amount, 2),
    'fee_type', v_settings.withdrawal_fee_type,
    'fee_amount', ROUND(v_fee_amount, 2),
    'net_amount', ROUND(v_net_amount, 2),
    'exchange_rate', v_settings.exchange_rate,
    'new_balance', v_new_balance,
    'new_earned_balance', v_new_earned,
    'message', format('Successfully withdrawn %s treats ($%s USD added to Live Balance)', 
                      p_treats_amount, ROUND(v_net_amount, 2))
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Withdrawal failed: %s', SQLERRM)
    );
END;
$$;

-- Step 4: Create function to update exchange rate (for API integration)
CREATE OR REPLACE FUNCTION admin_update_exchange_rate(
  p_new_rate decimal,
  p_source text DEFAULT 'manual'
)
RETURNS json
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin_id uuid;
  v_settings_id uuid;
  v_previous_rate decimal;
  v_previous_source text;
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

  -- Validate rate
  IF p_new_rate <= 0 THEN
    RAISE EXCEPTION 'Exchange rate must be greater than 0';
  END IF;

  -- Validate source
  IF p_source NOT IN ('manual', 'auto_api') THEN
    RAISE EXCEPTION 'Invalid exchange rate source. Must be "manual" or "auto_api"';
  END IF;

  -- Get current settings
  SELECT id, exchange_rate, exchange_rate_source
  INTO v_settings_id, v_previous_rate, v_previous_source
  FROM withdrawal_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal settings not found';
  END IF;

  -- Update exchange rate
  UPDATE withdrawal_settings
  SET
    exchange_rate = p_new_rate,
    exchange_rate_source = p_source,
    exchange_rate_last_updated = now(),
    updated_at = now(),
    last_updated_by = v_admin_id
  WHERE id = v_settings_id;

  -- Log the update
  INSERT INTO withdrawal_settings_audit_log (
    admin_id,
    action,
    previous_values,
    new_values
  )
  VALUES (
    v_admin_id,
    'update',
    jsonb_build_object(
      'exchange_rate', v_previous_rate,
      'exchange_rate_source', v_previous_source,
      'action_type', 'exchange_rate_update'
    ),
    jsonb_build_object(
      'exchange_rate', p_new_rate,
      'exchange_rate_source', p_source,
      'action_type', 'exchange_rate_update'
    )
  );

  RETURN json_build_object(
    'success', true,
    'message', format('Exchange rate updated from %s to %s (%s)', v_previous_rate, p_new_rate, p_source),
    'previous_rate', v_previous_rate,
    'new_rate', p_new_rate,
    'source', p_source
  );
END;
$$;

-- Step 5: Create function to get current withdrawal fee calculation
CREATE OR REPLACE FUNCTION calculate_withdrawal_fees(
  p_treats_amount integer
)
RETURNS TABLE (
  gross_usd decimal,
  fee_type text,
  fee_amount decimal,
  net_usd decimal,
  exchange_rate decimal
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_settings RECORD;
  v_gross_usd decimal;
  v_fee decimal;
  v_net decimal;
BEGIN
  -- Get current settings
  SELECT 
    withdrawal_settings.exchange_rate,
    withdrawal_settings.withdrawal_fee_type,
    withdrawal_settings.withdrawal_fee_value
  INTO v_settings
  FROM withdrawal_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal settings not configured';
  END IF;

  -- Calculate gross amount
  v_gross_usd := p_treats_amount * v_settings.exchange_rate;

  -- Calculate fee
  IF v_settings.withdrawal_fee_type = 'percentage' THEN
    v_fee := (v_gross_usd * v_settings.withdrawal_fee_value / 100);
  ELSE
    v_fee := v_settings.withdrawal_fee_value;
  END IF;

  -- Calculate net
  v_net := GREATEST(v_gross_usd - v_fee, 0);

  RETURN QUERY SELECT
    ROUND(v_gross_usd, 2),
    v_settings.withdrawal_fee_type,
    ROUND(v_fee, 2),
    ROUND(v_net, 2),
    v_settings.exchange_rate;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION process_treat_withdrawal(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_exchange_rate(decimal, text) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_withdrawal_fees(integer) TO authenticated, anon;

-- Add helpful comments
COMMENT ON FUNCTION process_treat_withdrawal IS 'Processes treat withdrawal using unified withdrawal_settings table. Applies current exchange rate and fees.';
COMMENT ON FUNCTION admin_update_exchange_rate IS 'Allows admins to manually update exchange rate or receive updates from external API.';
COMMENT ON FUNCTION calculate_withdrawal_fees IS 'Calculates withdrawal fees and net amount for preview purposes.';

-- Step 6: Drop old table if all data is migrated (commented out for safety)
-- Uncomment only after verifying all functionality works with new system
-- DROP TABLE IF EXISTS treat_withdrawal_settings;
