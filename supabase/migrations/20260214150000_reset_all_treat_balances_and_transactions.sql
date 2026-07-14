/*
  # Reset All Treat Balances, Transactions, Contribution Scores & Admin Financial Records
  
  This migration resets:
  1. All treat_wallets balances and totals to 0
  2. All users.total_earnings (Live Balance) to 0
  3. Archives and clears treat_transactions
  4. All users' contribution scores to 0 (listener_contribution_scores)
  5. Admin financial records: Gross USD Earnings, Total Withdrawn, Total Revenue From Treat purchases
     - Withdrawal requests archived and deleted (so Total Withdrawn = 0, Gross = net = 0)
     - treat_payments.amount_usd set to 0 (so Total Revenue From Treat purchases = 0)
  
  WARNING: This is a destructive operation. Consider backing up data first.
*/

DO $$
DECLARE
  archived_count INTEGER;
  deleted_count INTEGER;
  wallets_reset_count INTEGER;
  earnings_reset_count INTEGER;
  contribution_reset_count INTEGER;
  withdrawals_archived_count INTEGER;
  withdrawals_deleted_count INTEGER;
  treat_revenue_reset_count INTEGER;
BEGIN
  RAISE NOTICE 'Starting full financial and contribution reset...';
  
  -- Step 1: Create archive table and archive all treat transactions
  CREATE TABLE IF NOT EXISTS treat_transactions_archive (
    LIKE treat_transactions INCLUDING ALL
  );
  
  INSERT INTO treat_transactions_archive
  SELECT * FROM treat_transactions;
  
  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RAISE NOTICE 'Archived % transactions to treat_transactions_archive', archived_count;
  
  DELETE FROM treat_transactions;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % rows from treat_transactions', deleted_count;
  
  -- Step 2: Reset all treat_wallets balances and totals to 0
  UPDATE treat_wallets
  SET 
    balance = 0,
    total_earned = 0,
    total_purchased = 0,
    total_spent = 0,
    total_withdrawn = 0,
    earned_balance = 0,
    purchased_balance = 0,
    pending_balance = 0,
    promo_balance = 0,
    promo_lifetime_earned = 0,
    promo_lifetime_spent = 0,
    updated_at = now();
  
  GET DIAGNOSTICS wallets_reset_count = ROW_COUNT;
  RAISE NOTICE 'Reset % treat wallets to zero', wallets_reset_count;
  
  -- Step 3: Reset all users.total_earnings (Live Balance) to 0
  UPDATE users
  SET 
    total_earnings = 0,
    updated_at = now()
  WHERE total_earnings IS NOT NULL AND total_earnings != 0;
  
  GET DIAGNOSTICS earnings_reset_count = ROW_COUNT;
  RAISE NOTICE 'Reset % users total_earnings to zero', earnings_reset_count;
  
  -- Step 4: Reset all users' contribution scores to 0
  UPDATE listener_contribution_scores
  SET 
    total_points = 0,
    current_period_points = 0,
    playlist_creation_points = 0,
    discovery_points = 0,
    curation_points = 0,
    engagement_points = 0,
    last_reward_date = NULL,
    updated_at = now();
  
  GET DIAGNOSTICS contribution_reset_count = ROW_COUNT;
  RAISE NOTICE 'Reset % contribution score rows to zero', contribution_reset_count;
  
  -- Step 5: Admin financial – Total Withdrawn & Gross USD. Archive then delete withdrawal_requests
  -- (amount has CHECK > 0 so we cannot zero it; deleting clears the sum)
  CREATE TABLE IF NOT EXISTS withdrawal_requests_archive (
    LIKE withdrawal_requests INCLUDING ALL
  );
  
  INSERT INTO withdrawal_requests_archive
  SELECT * FROM withdrawal_requests;
  
  GET DIAGNOSTICS withdrawals_archived_count = ROW_COUNT;
  RAISE NOTICE 'Archived % withdrawal_requests to withdrawal_requests_archive', withdrawals_archived_count;
  
  DELETE FROM withdrawal_requests;
  GET DIAGNOSTICS withdrawals_deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % rows from withdrawal_requests', withdrawals_deleted_count;
  
  -- Step 6: Admin financial – Total Revenue From Treat purchases. Zero amount_usd (no positive check)
  UPDATE treat_payments
  SET amount_usd = 0, updated_at = now()
  WHERE amount_usd IS NOT NULL AND amount_usd != 0;
  
  GET DIAGNOSTICS treat_revenue_reset_count = ROW_COUNT;
  RAISE NOTICE 'Zeroed amount_usd for % treat_payments rows', treat_revenue_reset_count;
  
  RAISE NOTICE 'Full reset completed successfully.';
  RAISE NOTICE 'Summary:';
  RAISE NOTICE '  - Treat transactions archived: %, deleted: %', archived_count, deleted_count;
  RAISE NOTICE '  - Treat wallets reset: %', wallets_reset_count;
  RAISE NOTICE '  - Users total_earnings reset: %', earnings_reset_count;
  RAISE NOTICE '  - Contribution scores reset: %', contribution_reset_count;
  RAISE NOTICE '  - Withdrawal requests archived: %, deleted: %', withdrawals_archived_count, withdrawals_deleted_count;
  RAISE NOTICE '  - Treat payment revenue (amount_usd) zeroed: %', treat_revenue_reset_count;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'treat_transactions_archive'
  ) THEN
    COMMENT ON TABLE treat_transactions_archive IS 'Archived treat transactions from reset operation on 2026-02-14';
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests_archive'
  ) THEN
    COMMENT ON TABLE withdrawal_requests_archive IS 'Archived withdrawal requests from reset operation on 2026-02-14';
  END IF;
END $$;
