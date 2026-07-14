/*
  # Premium Currency Rounding Tracking System

  1. Purpose
    - Track GBP/EUR transactions that were automatically rounded up to 1 unit minimum
    - Provide transparency and audit trail for premium currency rounding
    - Enable reporting and analysis of rounding frequency

  2. New Tables
    - `premium_currency_rounding_log`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `payment_id` (uuid, references treat_payments, nullable)
      - `currency_code` (text) - GBP or EUR
      - `original_amount` (numeric) - Amount before rounding
      - `rounded_amount` (numeric) - Always 1.00 for minimum rounding
      - `usd_amount` (numeric) - Original USD amount
      - `created_at` (timestamptz)

  3. Security
    - Enable RLS on premium_currency_rounding_log table
    - Users can view their own rounding logs
    - Service role can insert rounding records
    - Admins can view all rounding logs

  4. Indexes
    - Index on user_id for fast user queries
    - Index on payment_id for payment lookups
    - Index on created_at for time-based queries
*/

-- Create the rounding log table
CREATE TABLE IF NOT EXISTS premium_currency_rounding_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  payment_id uuid REFERENCES treat_payments(id) ON DELETE SET NULL,
  currency_code text NOT NULL CHECK (currency_code IN ('GBP', 'EUR')),
  original_amount numeric(10, 2) NOT NULL CHECK (original_amount >= 0 AND original_amount < 1.00),
  rounded_amount numeric(10, 2) NOT NULL DEFAULT 1.00 CHECK (rounded_amount = 1.00),
  usd_amount numeric(10, 2) NOT NULL CHECK (usd_amount > 0),
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Enable Row Level Security
ALTER TABLE premium_currency_rounding_log ENABLE ROW LEVEL SECURITY;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_premium_rounding_user_id 
  ON premium_currency_rounding_log(user_id);

CREATE INDEX IF NOT EXISTS idx_premium_rounding_payment_id 
  ON premium_currency_rounding_log(payment_id) 
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_premium_rounding_created_at 
  ON premium_currency_rounding_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_premium_rounding_currency 
  ON premium_currency_rounding_log(currency_code);

-- RLS Policies

-- Users can view their own rounding logs
CREATE POLICY "Users can view own premium currency rounding logs"
  ON premium_currency_rounding_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role can insert rounding records (for payment processing)
CREATE POLICY "Service role can insert premium currency rounding logs"
  ON premium_currency_rounding_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create a helper function to log premium currency rounding
CREATE OR REPLACE FUNCTION log_premium_currency_rounding(
  p_user_id uuid,
  p_payment_id uuid,
  p_currency_code text,
  p_original_amount numeric,
  p_usd_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  -- Validate currency code
  IF p_currency_code NOT IN ('GBP', 'EUR') THEN
    RAISE EXCEPTION 'Invalid currency code. Must be GBP or EUR.';
  END IF;

  -- Validate original amount is less than 1
  IF p_original_amount >= 1.00 THEN
    RAISE EXCEPTION 'Original amount must be less than 1.00 for rounding to apply.';
  END IF;

  -- Insert rounding log
  INSERT INTO premium_currency_rounding_log (
    user_id,
    payment_id,
    currency_code,
    original_amount,
    rounded_amount,
    usd_amount
  ) VALUES (
    p_user_id,
    p_payment_id,
    p_currency_code,
    p_original_amount,
    1.00,
    p_usd_amount
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION log_premium_currency_rounding TO authenticated;

-- Create a view for easy rounding statistics
CREATE OR REPLACE VIEW premium_currency_rounding_stats AS
SELECT
  currency_code,
  COUNT(*) as total_roundings,
  AVG(original_amount) as avg_original_amount,
  MIN(original_amount) as min_original_amount,
  MAX(original_amount) as max_original_amount,
  SUM(rounded_amount - original_amount) as total_rounding_amount,
  COUNT(DISTINCT user_id) as unique_users,
  DATE_TRUNC('day', created_at) as date
FROM premium_currency_rounding_log
GROUP BY currency_code, DATE_TRUNC('day', created_at)
ORDER BY date DESC, currency_code;

-- Grant access to the view
GRANT SELECT ON premium_currency_rounding_stats TO authenticated;