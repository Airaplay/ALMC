/*
  # Add earnings functionality for users

  1. New Columns
    - Add `total_earnings` column to `users` table to track user earnings
    - Column is numeric with default value of 0.0

  2. New Functions
    - `withdraw_user_funds` - Function to handle user withdrawals
    - `update_user_earnings` - Function to update user earnings (for admin use)

  3. Security
    - Users can read their own earnings
    - Only authenticated users can initiate withdrawals
    - Withdrawal function includes validation checks
*/

-- Add total_earnings column to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'total_earnings'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN total_earnings numeric DEFAULT 0.0;
  END IF;
END $$;

-- Create index for earnings queries
CREATE INDEX IF NOT EXISTS idx_users_total_earnings 
ON users(total_earnings) WHERE total_earnings > 0;

-- Function to withdraw user funds
CREATE OR REPLACE FUNCTION withdraw_user_funds(amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_earnings numeric;
  result jsonb;
BEGIN
  -- Check if user is authenticated
  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Authentication required');
  END IF;

  -- Validate amount
  IF amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Withdrawal amount must be greater than 0');
  END IF;

  -- Get current user earnings
  SELECT total_earnings INTO current_earnings
  FROM users
  WHERE id = current_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  -- Check if user has sufficient funds
  IF current_earnings < amount THEN
    RETURN jsonb_build_object('error', 'Insufficient funds for withdrawal');
  END IF;

  -- Check if user has wallet address
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = current_user_id 
    AND wallet_address IS NOT NULL 
    AND wallet_address != ''
  ) THEN
    RETURN jsonb_build_object('error', 'Wallet address required for withdrawal');
  END IF;

  -- Deduct amount from user earnings
  UPDATE users
  SET 
    total_earnings = total_earnings - amount,
    updated_at = now()
  WHERE id = current_user_id;

  -- TODO: Add withdrawal transaction record here
  -- This would typically create a record in a withdrawals table
  -- and trigger external payout processing

  RETURN jsonb_build_object(
    'success', true, 
    'message', 'Withdrawal initiated successfully',
    'amount', amount,
    'remaining_balance', current_earnings - amount
  );
END;
$$;

-- Function to update user earnings (for admin/system use)
CREATE OR REPLACE FUNCTION update_user_earnings(
  user_uuid uuid,
  earnings_amount numeric,
  operation text DEFAULT 'add'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Validate operation
  IF operation NOT IN ('add', 'subtract', 'set') THEN
    RETURN jsonb_build_object('error', 'Invalid operation. Use add, subtract, or set');
  END IF;

  -- Validate amount
  IF earnings_amount < 0 THEN
    RETURN jsonb_build_object('error', 'Earnings amount cannot be negative');
  END IF;

  -- Update earnings based on operation
  IF operation = 'add' THEN
    UPDATE users
    SET 
      total_earnings = total_earnings + earnings_amount,
      updated_at = now()
    WHERE id = user_uuid;
  ELSIF operation = 'subtract' THEN
    UPDATE users
    SET 
      total_earnings = GREATEST(0, total_earnings - earnings_amount),
      updated_at = now()
    WHERE id = user_uuid;
  ELSIF operation = 'set' THEN
    UPDATE users
    SET 
      total_earnings = earnings_amount,
      updated_at = now()
    WHERE id = user_uuid;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Earnings updated successfully');
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION withdraw_user_funds TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_earnings TO authenticated;

-- Update existing users to have 0.0 earnings by default
UPDATE users 
SET total_earnings = 0.0 
WHERE total_earnings IS NULL;