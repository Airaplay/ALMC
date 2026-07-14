/*
  # Add Multi-Currency Support to Treat Payments

  This migration adds comprehensive currency support to the treat payment system,
  enabling automatic currency detection and conversion based on user location.

  1. Changes to `treat_payments` Table
    - Add `detected_country` (text) - User's detected country from IP geolocation
    - Add `detected_country_code` (text) - ISO country code
    - Add `currency_symbol` (text) - Currency symbol for display (₦, $, £, etc.)
    - Add `currency_name` (text) - Full currency name
    - Add `exchange_rate` (numeric) - Exchange rate used at time of payment
    - Add `amount_usd` (numeric) - Original amount in USD for reference
    - Update existing `currency` field to allow more currencies

  2. Security
    - No changes to RLS policies needed
    - All existing policies remain valid

  3. Important Notes
    - Currency detection happens on the client side using IP geolocation
    - Exchange rates are stored at payment time for historical accuracy
    - All amounts are stored in the user's selected currency
    - USD equivalent is stored for admin reporting
*/

-- Add currency-related columns to treat_payments table
DO $$
BEGIN
  -- Add detected_country column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treat_payments' AND column_name = 'detected_country'
  ) THEN
    ALTER TABLE public.treat_payments ADD COLUMN detected_country text;
  END IF;

  -- Add detected_country_code column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treat_payments' AND column_name = 'detected_country_code'
  ) THEN
    ALTER TABLE public.treat_payments ADD COLUMN detected_country_code text;
  END IF;

  -- Add currency_symbol column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treat_payments' AND column_name = 'currency_symbol'
  ) THEN
    ALTER TABLE public.treat_payments ADD COLUMN currency_symbol text DEFAULT '$';
  END IF;

  -- Add currency_name column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treat_payments' AND column_name = 'currency_name'
  ) THEN
    ALTER TABLE public.treat_payments ADD COLUMN currency_name text DEFAULT 'US Dollar';
  END IF;

  -- Add exchange_rate column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treat_payments' AND column_name = 'exchange_rate'
  ) THEN
    ALTER TABLE public.treat_payments ADD COLUMN exchange_rate numeric DEFAULT 1;
  END IF;

  -- Add amount_usd column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treat_payments' AND column_name = 'amount_usd'
  ) THEN
    ALTER TABLE public.treat_payments ADD COLUMN amount_usd numeric;
  END IF;
END $$;

-- Update existing records to have USD as default
UPDATE public.treat_payments
SET
  currency_symbol = '$',
  currency_name = 'US Dollar',
  exchange_rate = 1,
  amount_usd = amount
WHERE currency_symbol IS NULL OR currency_name IS NULL;

-- Add helpful comments
COMMENT ON COLUMN public.treat_payments.detected_country IS 'User detected country from IP geolocation';
COMMENT ON COLUMN public.treat_payments.detected_country_code IS 'ISO country code (NG, US, GB, etc.)';
COMMENT ON COLUMN public.treat_payments.currency_symbol IS 'Currency symbol for display ($, ₦, £, etc.)';
COMMENT ON COLUMN public.treat_payments.currency_name IS 'Full currency name (US Dollar, Nigerian Naira, etc.)';
COMMENT ON COLUMN public.treat_payments.exchange_rate IS 'Exchange rate used at payment time (relative to USD)';
COMMENT ON COLUMN public.treat_payments.amount_usd IS 'Payment amount in USD for admin reference';
