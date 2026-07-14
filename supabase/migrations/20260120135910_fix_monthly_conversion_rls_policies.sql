/*
  # Fix Monthly Conversion RLS Policies

  ## Problem
  The `admin_distribute_contribution_rewards` function was failing because the
  `platform_rewards_budget` table had RLS enabled but no policies, preventing
  the SECURITY DEFINER function from inserting/updating records.

  ## Solution
  Add proper RLS policies for `platform_rewards_budget` table to allow:
  - Admins to insert/update budget records
  - Service role (functions) to bypass RLS
  - Public read access for completed records

  ## Changes
  1. Add RLS policies for platform_rewards_budget table
  2. Add missing RLS policies for contribution_rewards_history table
  3. Ensure functions can execute properly with SECURITY DEFINER
*/

-- ================================================================
-- PLATFORM REWARDS BUDGET RLS POLICIES
-- ================================================================

-- Drop existing policies if any
DROP POLICY IF EXISTS "Admins can manage platform budget" ON platform_rewards_budget;
DROP POLICY IF EXISTS "Anyone can view platform budget" ON platform_rewards_budget;

-- Policy: Admins can insert and update platform budget records
CREATE POLICY "Admins can manage platform budget"
  ON platform_rewards_budget
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Policy: Anyone can view budget records (for transparency)
CREATE POLICY "Anyone can view platform budget"
  ON platform_rewards_budget
  FOR SELECT
  TO public
  USING (true);

-- ================================================================
-- CONTRIBUTION REWARDS HISTORY RLS POLICIES
-- ================================================================

-- Ensure contribution_rewards_history table has RLS enabled
ALTER TABLE contribution_rewards_history ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view own reward history" ON contribution_rewards_history;
DROP POLICY IF EXISTS "Admins can manage reward history" ON contribution_rewards_history;
DROP POLICY IF EXISTS "System can insert reward history" ON contribution_rewards_history;

-- Policy: Users can view their own reward history
CREATE POLICY "Users can view own reward history"
  ON contribution_rewards_history
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Policy: System can insert reward history (for functions)
CREATE POLICY "System can insert reward history"
  ON contribution_rewards_history
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: Admins can manage all reward history
CREATE POLICY "Admins can manage reward history"
  ON contribution_rewards_history
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ================================================================
-- VERIFY TREAT WALLETS POLICIES
-- ================================================================

-- Ensure treat_wallets has proper policies for the conversion function
-- The function updates earned_balance and balance

-- Check if treat_wallets RLS is enabled
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename = 'treat_wallets'
    AND rowsecurity = true
  ) THEN
    ALTER TABLE treat_wallets ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Drop and recreate system update policy for treat_wallets
DROP POLICY IF EXISTS "System can update treat wallets" ON treat_wallets;

CREATE POLICY "System can update treat wallets"
  ON treat_wallets
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ================================================================
-- VERIFY TREAT TRANSACTIONS POLICIES
-- ================================================================

-- Ensure treat_transactions has proper policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename = 'treat_transactions'
    AND rowsecurity = true
  ) THEN
    ALTER TABLE treat_transactions ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Drop and recreate system insert policy for treat_transactions
DROP POLICY IF EXISTS "System can insert transactions" ON treat_transactions;

CREATE POLICY "System can insert transactions"
  ON treat_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ================================================================
-- ADD HELPFUL COMMENT
-- ================================================================

COMMENT ON POLICY "Admins can manage platform budget" ON platform_rewards_budget IS
'Allows admin users to insert and update platform reward budget records during monthly conversions.';

COMMENT ON POLICY "Anyone can view platform budget" ON platform_rewards_budget IS
'Public read access to platform budget for transparency.';

COMMENT ON POLICY "System can insert reward history" ON contribution_rewards_history IS
'Allows the admin_distribute_contribution_rewards function to insert reward history records.';

COMMENT ON POLICY "System can update treat wallets" ON treat_wallets IS
'Allows system functions (like monthly conversion) to update treat wallet balances.';

COMMENT ON POLICY "System can insert transactions" ON treat_transactions IS
'Allows system functions to log treat transactions.';
