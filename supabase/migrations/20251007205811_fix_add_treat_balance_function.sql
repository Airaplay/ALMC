/*
  # Create Add Treat Balance Function
  
  1. New Function
    - `add_treat_balance` - Safely adds treats to user wallet
    - Creates wallet if it doesn't exist
    - Updates balance atomically
    
  2. Security
    - Can be called by authenticated users
    - Ensures data integrity
    - Handles concurrent updates safely
*/

-- Create function to add treat balance
CREATE OR REPLACE FUNCTION add_treat_balance(
  p_user_id uuid,
  p_amount integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert or update wallet balance
  INSERT INTO treat_wallets (user_id, balance, total_purchased, total_spent, total_earned, total_withdrawn)
  VALUES (p_user_id, p_amount, 0, 0, 0, 0)
  ON CONFLICT (user_id)
  DO UPDATE SET
    balance = treat_wallets.balance + p_amount,
    updated_at = now();
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION add_treat_balance(uuid, integer) TO authenticated;
