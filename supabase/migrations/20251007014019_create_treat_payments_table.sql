/*
  # Create Treat Payments Table

  This migration creates the treat_payments table to track payment intents and their status
  when users purchase treat packages through various payment channels.

  1. New Tables
    - `treat_payments`
      - `id` (uuid, primary key) - Unique identifier for the payment
      - `user_id` (uuid, foreign key) - Reference to the user making the payment
      - `package_id` (uuid, foreign key) - Reference to the treat package being purchased
      - `amount` (numeric) - Payment amount
      - `currency` (text) - Currency code (USD, NGN, etc.)
      - `payment_method` (text) - Payment method/channel type (paystack, flutterwave, usdt, etc.)
      - `payment_channel_id` (uuid) - Reference to the payment channel used
      - `status` (text) - Payment status (pending, completed, failed, cancelled)
      - `external_reference` (text) - External payment reference from payment gateway
      - `payment_data` (jsonb) - Additional payment data from gateway
      - `completed_at` (timestamptz) - When payment was completed
      - `created_at` (timestamptz) - When payment was initiated
      - `updated_at` (timestamptz) - When payment was last updated

  2. Security
    - Enable RLS on `treat_payments` table
    - Users can view their own payments
    - Users can create their own payments
    - Only admins can view all payments
    - Payment completion is handled by edge functions using service role

  3. Important Notes
    - This table tracks payment intents and their lifecycle
    - Once a payment is completed, treats are credited via treat_transactions
    - The external_reference links to the payment gateway's transaction ID
*/

-- Create treat_payments table
CREATE TABLE IF NOT EXISTS public.treat_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.treat_packages(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'USD',
  payment_method text NOT NULL,
  payment_channel_id uuid REFERENCES public.treat_payment_channels(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  external_reference text,
  payment_data jsonb DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.treat_payments ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own payments
CREATE POLICY "Users can view own payments"
  ON public.treat_payments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can create their own payments
CREATE POLICY "Users can create own payments"
  ON public.treat_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Admins can view all payments
CREATE POLICY "Admins can view all payments"
  ON public.treat_payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Policy: Admins can update payments
CREATE POLICY "Admins can update payments"
  ON public.treat_payments
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

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_treat_payments_user_id ON public.treat_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_treat_payments_status ON public.treat_payments(status);
CREATE INDEX IF NOT EXISTS idx_treat_payments_external_ref ON public.treat_payments(external_reference);
CREATE INDEX IF NOT EXISTS idx_treat_payments_created_at ON public.treat_payments(created_at DESC);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_treat_payment_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_treat_payment_timestamp ON public.treat_payments;

CREATE TRIGGER trg_update_treat_payment_timestamp
  BEFORE UPDATE ON public.treat_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_treat_payment_timestamp();

-- Add helpful comments
COMMENT ON TABLE public.treat_payments IS 'Tracks payment intents for treat package purchases';
COMMENT ON COLUMN public.treat_payments.status IS 'Payment status: pending, completed, failed, or cancelled';
COMMENT ON COLUMN public.treat_payments.external_reference IS 'Reference ID from external payment gateway';
COMMENT ON COLUMN public.treat_payments.payment_data IS 'Additional data returned from payment gateway';
