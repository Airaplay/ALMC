/*
  # Create Multi-Currency Withdrawal Exchange Rates System

  ## Overview
  This migration fixes a critical bug where all users receive exchange rate 1.0 on withdrawals,
  causing international users to lose massive value (Nigerian users lose 99.94% of withdrawal value).

  ## Changes
  
  1. New Tables
    - `withdrawal_exchange_rates` - Country-specific exchange rates for withdrawals
      - Stores USD to local currency conversion rates for each country
      - Tracks rate history, source, and updates
      - Allows admin management and monitoring
    
    - `withdrawal_exchange_rate_history` - Audit trail for rate changes
      - Tracks all rate updates with old/new values
      - Calculates percentage change automatically
      - Records who made the change and why
  
  2. Data Migration
    - Backfill current exchange rates from currencyDetection.ts
    - Set all rates to active and ready for use
    - Default source: 'manual' (can be updated to 'api' later)
  
  3. Security
    - Enable RLS on both tables
    - Public can read rates (needed for UI display)
    - Only admins can update rates
    - Full audit trail of all changes
  
  ## Impact
  - Fixes critical bug affecting all international withdrawals
  - Enables proper currency conversion for 18+ countries
  - Provides foundation for future enhancements (API updates, monitoring)
  
  ## Important Notes
  - This does NOT automatically fix pending withdrawals (separate backfill needed)
  - Withdrawal function needs update to use new rates (next migration)
  - Rates are initially set from hardcoded values (API integration in Phase 2)
*/

-- Create withdrawal_exchange_rates table
CREATE TABLE IF NOT EXISTS withdrawal_exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL UNIQUE,
  country_name TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  currency_symbol TEXT NOT NULL,
  currency_name TEXT NOT NULL,
  exchange_rate NUMERIC NOT NULL CHECK (exchange_rate > 0),
  is_active BOOLEAN DEFAULT true,
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  last_updated_by UUID REFERENCES auth.users(id),
  rate_source TEXT DEFAULT 'manual' CHECK (rate_source IN ('manual', 'api', 'admin')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create exchange rate history table for auditing
CREATE TABLE IF NOT EXISTS withdrawal_exchange_rate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL,
  old_rate NUMERIC NOT NULL,
  new_rate NUMERIC NOT NULL,
  rate_change_percent NUMERIC GENERATED ALWAYS AS
    (((new_rate - old_rate) / NULLIF(old_rate, 0)) * 100) STORED,
  updated_by UUID REFERENCES auth.users(id),
  update_source TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_withdrawal_exchange_rates_country 
  ON withdrawal_exchange_rates(country_code) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_withdrawal_exchange_rates_currency 
  ON withdrawal_exchange_rates(currency_code) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_withdrawal_exchange_rate_history_country 
  ON withdrawal_exchange_rate_history(country_code);
CREATE INDEX IF NOT EXISTS idx_withdrawal_exchange_rate_history_created 
  ON withdrawal_exchange_rate_history(created_at DESC);

-- Enable RLS
ALTER TABLE withdrawal_exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_exchange_rate_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for withdrawal_exchange_rates
CREATE POLICY "Anyone can view active exchange rates"
  ON withdrawal_exchange_rates FOR SELECT
  TO public
  USING (is_active = true);

CREATE POLICY "Admins can insert exchange rates"
  ON withdrawal_exchange_rates FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can update exchange rates"
  ON withdrawal_exchange_rates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- RLS Policies for withdrawal_exchange_rate_history
CREATE POLICY "Admins can view rate history"
  ON withdrawal_exchange_rate_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "System can insert rate history"
  ON withdrawal_exchange_rate_history FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Function to update exchange rate with automatic history tracking
CREATE OR REPLACE FUNCTION update_withdrawal_exchange_rate(
  p_country_code TEXT,
  p_new_rate NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_rate NUMERIC;
  v_admin_id UUID;
  v_result jsonb;
BEGIN
  -- Check if user is admin
  SELECT id INTO v_admin_id
  FROM users
  WHERE id = auth.uid() AND role = 'admin';
  
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only admins can update exchange rates'
    );
  END IF;
  
  -- Validate rate
  IF p_new_rate <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Exchange rate must be greater than 0'
    );
  END IF;
  
  -- Get old rate
  SELECT exchange_rate INTO v_old_rate
  FROM withdrawal_exchange_rates
  WHERE country_code = p_country_code;
  
  IF v_old_rate IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Country not found'
    );
  END IF;
  
  -- Check if rate actually changed
  IF v_old_rate = p_new_rate THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'New rate is same as current rate'
    );
  END IF;
  
  -- Update the rate
  UPDATE withdrawal_exchange_rates
  SET 
    exchange_rate = p_new_rate,
    last_updated_at = now(),
    last_updated_by = v_admin_id,
    rate_source = 'admin',
    notes = COALESCE(p_notes, notes)
  WHERE country_code = p_country_code;
  
  -- Record in history
  INSERT INTO withdrawal_exchange_rate_history (
    country_code,
    old_rate,
    new_rate,
    updated_by,
    update_source,
    notes
  ) VALUES (
    p_country_code,
    v_old_rate,
    p_new_rate,
    v_admin_id,
    'admin',
    p_notes
  );
  
  -- Return success with details
  RETURN jsonb_build_object(
    'success', true,
    'country_code', p_country_code,
    'old_rate', v_old_rate,
    'new_rate', p_new_rate,
    'change_percent', ROUND(((p_new_rate - v_old_rate) / v_old_rate) * 100, 2),
    'updated_by', v_admin_id,
    'updated_at', now()
  );
END;
$$;

-- Backfill exchange rates from currencyDetection.ts
INSERT INTO withdrawal_exchange_rates (
  country_code, country_name, currency_code, currency_symbol, currency_name, exchange_rate, rate_source, notes
) VALUES
  -- Africa
  ('NG', 'Nigeria', 'NGN', '₦', 'Nigerian Naira', 1650, 'manual', 'Black market rate'),
  ('GH', 'Ghana', 'GHS', '₵', 'Ghanaian Cedi', 15.5, 'manual', 'Official rate'),
  ('ZA', 'South Africa', 'ZAR', 'R', 'South African Rand', 18.5, 'manual', 'Official rate'),
  ('KE', 'Kenya', 'KES', 'KSh', 'Kenyan Shilling', 129, 'manual', 'Official rate'),
  ('EG', 'Egypt', 'EGP', 'E£', 'Egyptian Pound', 49, 'manual', 'Official rate'),
  ('TZ', 'Tanzania', 'TZS', 'TSh', 'Tanzanian Shilling', 2540, 'manual', 'Official rate'),
  ('UG', 'Uganda', 'UGX', 'USh', 'Ugandan Shilling', 3700, 'manual', 'Official rate'),
  
  -- West/Central Africa (CFA Franc)
  ('BJ', 'Benin', 'XOF', 'CFA', 'West African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('SN', 'Senegal', 'XOF', 'CFA', 'West African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('CI', 'Ivory Coast', 'XOF', 'CFA', 'West African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('ML', 'Mali', 'XOF', 'CFA', 'West African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('NE', 'Niger', 'XOF', 'CFA', 'West African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('BF', 'Burkina Faso', 'XOF', 'CFA', 'West African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('GW', 'Guinea-Bissau', 'XOF', 'CFA', 'West African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('TG', 'Togo', 'XAF', 'FCFA', 'Central African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('CM', 'Cameroon', 'XAF', 'FCFA', 'Central African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('GA', 'Gabon', 'XAF', 'FCFA', 'Central African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('CG', 'Republic of Congo', 'XAF', 'FCFA', 'Central African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('CF', 'Central African Republic', 'XAF', 'FCFA', 'Central African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('TD', 'Chad', 'XAF', 'FCFA', 'Central African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  ('GQ', 'Equatorial Guinea', 'XAF', 'FCFA', 'Central African CFA Franc', 605, 'manual', 'Fixed to EUR'),
  
  -- Europe
  ('GB', 'United Kingdom', 'GBP', '£', 'British Pound', 0.79, 'manual', 'Official rate'),
  ('DE', 'Germany', 'EUR', '€', 'Euro', 0.92, 'manual', 'Official rate'),
  ('FR', 'France', 'EUR', '€', 'Euro', 0.92, 'manual', 'Official rate'),
  ('IT', 'Italy', 'EUR', '€', 'Euro', 0.92, 'manual', 'Official rate'),
  ('ES', 'Spain', 'EUR', '€', 'Euro', 0.92, 'manual', 'Official rate'),
  ('NL', 'Netherlands', 'EUR', '€', 'Euro', 0.92, 'manual', 'Official rate'),
  ('BE', 'Belgium', 'EUR', '€', 'Euro', 0.92, 'manual', 'Official rate'),
  ('AT', 'Austria', 'EUR', '€', 'Euro', 0.92, 'manual', 'Official rate'),
  ('PT', 'Portugal', 'EUR', '€', 'Euro', 0.92, 'manual', 'Official rate'),
  ('IE', 'Ireland', 'EUR', '€', 'Euro', 0.92, 'manual', 'Official rate'),
  ('GR', 'Greece', 'EUR', '€', 'Euro', 0.92, 'manual', 'Official rate'),
  ('FI', 'Finland', 'EUR', '€', 'Euro', 0.92, 'manual', 'Official rate'),
  
  -- Americas
  ('US', 'United States', 'USD', '$', 'US Dollar', 1.0, 'manual', 'Base currency'),
  ('CA', 'Canada', 'CAD', 'C$', 'Canadian Dollar', 1.36, 'manual', 'Official rate'),
  ('BR', 'Brazil', 'BRL', 'R$', 'Brazilian Real', 5.2, 'manual', 'Official rate'),
  ('MX', 'Mexico', 'MXN', 'Mex$', 'Mexican Peso', 17, 'manual', 'Official rate'),
  
  -- Asia
  ('IN', 'India', 'INR', '₹', 'Indian Rupee', 83, 'manual', 'Official rate'),
  ('CN', 'China', 'CNY', '¥', 'Chinese Yuan', 7.24, 'manual', 'Official rate'),
  ('JP', 'Japan', 'JPY', '¥', 'Japanese Yen', 149, 'manual', 'Official rate'),
  ('AE', 'UAE', 'AED', 'د.إ', 'UAE Dirham', 3.67, 'manual', 'Fixed to USD'),
  ('SA', 'Saudi Arabia', 'SAR', '﷼', 'Saudi Riyal', 3.75, 'manual', 'Fixed to USD'),
  
  -- Oceania
  ('AU', 'Australia', 'AUD', 'A$', 'Australian Dollar', 1.52, 'manual', 'Official rate'),
  ('NZ', 'New Zealand', 'NZD', 'NZ$', 'New Zealand Dollar', 1.65, 'manual', 'Official rate')
ON CONFLICT (country_code) DO NOTHING;

-- Create helper function to get exchange rate for a country
CREATE OR REPLACE FUNCTION get_withdrawal_exchange_rate(p_country_code TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate NUMERIC;
BEGIN
  -- Get active exchange rate for country
  SELECT exchange_rate INTO v_rate
  FROM withdrawal_exchange_rates
  WHERE country_code = p_country_code
    AND is_active = true;
  
  -- If country not found, default to USD (1.0)
  IF v_rate IS NULL THEN
    v_rate := 1.0;
  END IF;
  
  RETURN v_rate;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION update_withdrawal_exchange_rate(TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_withdrawal_exchange_rate(TEXT) TO authenticated, anon;
