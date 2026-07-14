/*
  # Create Withdrawal Methods Table

  1. New Tables
    - `withdrawal_methods`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to users)
      - `method_type` (text) - either 'usdt_wallet' or 'bank_account'
      - `wallet_address` (text, nullable) - TRC20 wallet address for USDT
      - `bank_name` (text, nullable)
      - `account_number` (text, nullable)
      - `account_holder_name` (text, nullable)
      - `swift_code` (text, nullable, optional)
      - `country` (text, nullable) - for bank account
      - `is_default` (boolean) - whether this is the default method
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `withdrawal_methods` table
    - Add policies for users to manage their own withdrawal methods
*/

CREATE TABLE IF NOT EXISTS withdrawal_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method_type text NOT NULL CHECK (method_type IN ('usdt_wallet', 'bank_account')),
  wallet_address text,
  bank_name text,
  account_number text,
  account_holder_name text,
  swift_code text,
  country text,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  CONSTRAINT valid_usdt_method CHECK (
    method_type != 'usdt_wallet' OR (wallet_address IS NOT NULL)
  ),
  CONSTRAINT valid_bank_method CHECK (
    method_type != 'bank_account' OR (
      bank_name IS NOT NULL AND 
      account_number IS NOT NULL AND 
      account_holder_name IS NOT NULL AND
      country IS NOT NULL
    )
  )
);

ALTER TABLE withdrawal_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own withdrawal methods"
  ON withdrawal_methods FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own withdrawal methods"
  ON withdrawal_methods FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own withdrawal methods"
  ON withdrawal_methods FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own withdrawal methods"
  ON withdrawal_methods FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_withdrawal_methods_user_id ON withdrawal_methods(user_id);
CREATE INDEX idx_withdrawal_methods_default ON withdrawal_methods(user_id, is_default) WHERE is_default = true;

CREATE OR REPLACE FUNCTION update_withdrawal_methods_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_withdrawal_methods_updated_at
  BEFORE UPDATE ON withdrawal_methods
  FOR EACH ROW
  EXECUTE FUNCTION update_withdrawal_methods_updated_at();
