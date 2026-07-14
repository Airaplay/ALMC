/*
  # Create Payment Channels Table for Treat Purchases
  
  This migration creates the infrastructure for managing payment channels/gateways
  that users can use to purchase treats.
  
  ## Tables Created
  
  1. `treat_payment_channels`
    - Stores payment channel configurations (Paystack, Flutterwave, Stripe, USDT, etc.)
    - Columns:
      - `id` (uuid, primary key) - Unique identifier
      - `channel_name` (text) - Display name (e.g., "Paystack", "Flutterwave")
      - `channel_type` (text) - Type identifier (e.g., "paystack", "flutterwave", "stripe", "usdt")
      - `is_enabled` (boolean) - Whether channel is active
      - `icon_url` (text) - Optional icon/logo URL
      - `configuration` (jsonb) - Channel-specific configuration
      - `display_order` (integer) - Order in which to show channels
      - `created_at` (timestamptz) - When channel was added
      - `updated_at` (timestamptz) - When channel was last modified
      - `created_by` (uuid) - Admin who created the channel
      - `updated_by` (uuid) - Admin who last updated the channel
  
  ## Security
  - Enable RLS on `treat_payment_channels` table
  - Anyone can view enabled channels
  - Only admins can create, update, or delete channels
  
  ## Important Notes
  - Configuration field stores channel-specific settings (API keys, addresses, etc.)
  - Sensitive data in configuration should be encrypted at application level
  - Display order determines sort order when showing payment options to users
*/

-- Create treat_payment_channels table
CREATE TABLE IF NOT EXISTS public.treat_payment_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_name text NOT NULL,
  channel_type text NOT NULL,
  is_enabled boolean DEFAULT true,
  icon_url text,
  configuration jsonb DEFAULT '{}'::jsonb,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT unique_channel_type UNIQUE(channel_type)
);

-- Enable RLS
ALTER TABLE public.treat_payment_channels ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone (even unauthenticated) can view enabled payment channels
CREATE POLICY "Anyone can view enabled payment channels"
  ON public.treat_payment_channels
  FOR SELECT
  USING (is_enabled = true);

-- Policy: Authenticated users can view all channels (for admin interface)
CREATE POLICY "Authenticated users can view all channels"
  ON public.treat_payment_channels
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Only admins can insert payment channels
CREATE POLICY "Admins can insert payment channels"
  ON public.treat_payment_channels
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Policy: Only admins can update payment channels
CREATE POLICY "Admins can update payment channels"
  ON public.treat_payment_channels
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Policy: Only admins can delete payment channels
CREATE POLICY "Admins can delete payment channels"
  ON public.treat_payment_channels
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_payment_channels_enabled ON public.treat_payment_channels(is_enabled);
CREATE INDEX IF NOT EXISTS idx_payment_channels_order ON public.treat_payment_channels(display_order);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_payment_channel_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_payment_channel_timestamp ON public.treat_payment_channels;

CREATE TRIGGER trg_update_payment_channel_timestamp
  BEFORE UPDATE ON public.treat_payment_channels
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_channel_timestamp();

-- Insert default payment channels (disabled by default, admin needs to configure)
INSERT INTO public.treat_payment_channels (
  channel_name,
  channel_type,
  is_enabled,
  display_order,
  configuration
) VALUES
  ('Paystack', 'paystack', false, 1, '{"public_key": "", "secret_key": "", "currency": "NGN"}'::jsonb),
  ('Flutterwave', 'flutterwave', false, 2, '{"public_key": "", "secret_key": "", "currency": "NGN"}'::jsonb),
  ('Stripe', 'stripe', false, 3, '{"publishable_key": "", "secret_key": "", "currency": "USD"}'::jsonb),
  ('USDT (TRC20)', 'usdt_trc20', false, 4, '{"wallet_address": "", "network": "TRC20"}'::jsonb),
  ('USDT (ERC20)', 'usdt_erc20', false, 5, '{"wallet_address": "", "network": "ERC20"}'::jsonb)
ON CONFLICT (channel_type) DO NOTHING;

-- Add helpful comments
COMMENT ON TABLE public.treat_payment_channels IS 'Stores payment channel configurations for purchasing treats';
COMMENT ON COLUMN public.treat_payment_channels.configuration IS 'JSON configuration for the payment channel (API keys, addresses, etc.)';
COMMENT ON COLUMN public.treat_payment_channels.display_order IS 'Order in which to display payment channels to users (lower numbers shown first)';
