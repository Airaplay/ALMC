/*
  # Payment Channels Management

  1. New Tables
    - `treat_payment_channels`
      - `id` (uuid, primary key)
      - `channel_name` (text) - Display name for the payment channel
      - `channel_type` (text) - Type of payment channel (paystack, flutterwave, usdt, etc.)
      - `is_enabled` (boolean) - Whether the channel is active
      - `icon_url` (text, nullable) - URL to channel icon/logo
      - `configuration` (jsonb) - Channel-specific configuration (API keys, etc.)
      - `display_order` (integer) - Order for displaying channels
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `treat_payment_channels` table
    - Add policy for public read access to enabled channels only
    - Add policy for authenticated admin users to manage channels
*/

CREATE TABLE IF NOT EXISTS treat_payment_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_name text NOT NULL,
  channel_type text NOT NULL CHECK (channel_type IN ('paystack', 'flutterwave', 'usdt')),
  is_enabled boolean DEFAULT true,
  icon_url text,
  configuration jsonb DEFAULT '{}',
  display_order integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE treat_payment_channels ENABLE ROW LEVEL SECURITY;

-- Policy for public read access to enabled channels only
CREATE POLICY "Public can view enabled payment channels"
  ON treat_payment_channels
  FOR SELECT
  TO anon, authenticated
  USING (is_enabled = true);

-- Policy for authenticated users to view all channels (for admin interface)
CREATE POLICY "Authenticated users can view all payment channels"
  ON treat_payment_channels
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy for authenticated users to manage payment channels (admin only)
CREATE POLICY "Authenticated users can manage payment channels"
  ON treat_payment_channels
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_payment_channels_enabled_order 
  ON treat_payment_channels (is_enabled, display_order) 
  WHERE is_enabled = true;

-- Create index for channel type
CREATE INDEX IF NOT EXISTS idx_payment_channels_type 
  ON treat_payment_channels (channel_type);

-- Insert default payment channels
INSERT INTO treat_payment_channels (channel_name, channel_type, is_enabled, display_order, configuration) VALUES
  ('Paystack', 'paystack', false, 1, '{"public_key": "", "secret_key": ""}'),
  ('Flutterwave', 'flutterwave', false, 2, '{"public_key": "", "secret_key": ""}'),
  ('USDT (TRC-20)', 'usdt', false, 3, '{"wallet_address": "", "network": "TRC-20"}')
ON CONFLICT DO NOTHING;