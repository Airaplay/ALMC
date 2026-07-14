/*
  # Migrate Existing Contribution Rewards to User Earnings
  
  1. Problem
    - Previous conversions credited rewards to treat_wallets
    - Rewards should be in users.total_earnings (Live Balance)
    - Treat wallet should only have purchased treats
  
  2. Changes
    - Find all contribution reward transactions
    - Move those amounts from treat_wallets to users.total_earnings
    - Update treat_wallets balances to remove contribution rewards
    - Keep transaction history intact for audit trail
  
  3. Impact
    - Users will see their contribution rewards in Live Balance
    - Treat wallet will only show purchased treats
    - All past contribution rewards are migrated
*/

DO $$
DECLARE
  v_affected_users INTEGER := 0;
  v_total_migrated NUMERIC := 0;
BEGIN
  -- Create temporary table with contribution reward amounts per user
  CREATE TEMP TABLE contribution_rewards_to_migrate AS
  SELECT 
    tt.user_id,
    SUM(tt.amount) as total_contribution_rewards
  FROM treat_transactions tt
  WHERE tt.transaction_type = 'earn'
    AND tt.metadata->>'source' = 'monthly_conversion'
  GROUP BY tt.user_id;

  -- Get counts for logging
  SELECT COUNT(*), COALESCE(SUM(total_contribution_rewards), 0)
  INTO v_affected_users, v_total_migrated
  FROM contribution_rewards_to_migrate;

  -- Update users.total_earnings (add contribution rewards)
  UPDATE users u
  SET 
    total_earnings = COALESCE(u.total_earnings, 0) + crtm.total_contribution_rewards,
    updated_at = NOW()
  FROM contribution_rewards_to_migrate crtm
  WHERE u.id = crtm.user_id;

  -- Update treat_wallets (remove contribution rewards)
  UPDATE treat_wallets tw
  SET 
    balance = GREATEST(0, tw.balance - crtm.total_contribution_rewards),
    earned_balance = GREATEST(0, tw.earned_balance - crtm.total_contribution_rewards),
    total_earned = GREATEST(0, tw.total_earned - crtm.total_contribution_rewards),
    updated_at = NOW()
  FROM contribution_rewards_to_migrate crtm
  WHERE tw.user_id = crtm.user_id;

  -- Clean up
  DROP TABLE contribution_rewards_to_migrate;

  -- Log the migration result
  RAISE NOTICE 'Migration completed: % users affected, $% total migrated from treat_wallets to users.total_earnings', 
    v_affected_users, v_total_migrated;

END $$;

-- Add a comment to the users table for documentation
COMMENT ON COLUMN users.total_earnings IS 'Total earnings from all sources: creator revenue, listener contributions, and contribution rewards. Withdrawable balance shown as Live Balance in Earnings tab.';