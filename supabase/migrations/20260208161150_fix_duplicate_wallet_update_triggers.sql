/*
  # Fix Duplicate Wallet Update Triggers - CRITICAL BUG FIX
  
  ## Problem
  
  Users purchasing Treats via Flutterwave (and all payment methods) receive DOUBLE the amount they paid for.
  
  ## Root Cause
  
  There are TWO triggers on treat_transactions table that both update treat_wallets:
  1. trigger_update_treat_wallet (newer)
  2. update_treat_wallet_on_transaction (older)
  
  Both fire on INSERT and both call trigger_update_treat_wallet() function.
  This causes the wallet to be credited TWICE for every purchase!
  
  Example:
  - User buys 5 treats
  - Transaction inserted with amount = 5
  - First trigger fires: wallet += 5 (balance = 5)
  - Second trigger fires: wallet += 5 (balance = 10) ❌ DOUBLE CREDIT!
  
  ## Solution
  
  Drop the OLD trigger (update_treat_wallet_on_transaction) and keep only the newer one.
  
  ## Verification
  
  After this fix:
  - Only ONE trigger remains: trigger_update_treat_wallet
  - Each transaction updates the wallet exactly once
  - Users get the correct amount they purchased
*/

-- Drop the old duplicate trigger
DROP TRIGGER IF EXISTS update_treat_wallet_on_transaction ON treat_transactions;

-- Verify only one wallet update trigger remains
DO $$
DECLARE
  v_trigger_count INT;
BEGIN
  SELECT COUNT(*) INTO v_trigger_count
  FROM information_schema.triggers
  WHERE event_object_table = 'treat_transactions'
    AND trigger_name LIKE '%treat_wallet%';
    
  IF v_trigger_count != 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 wallet update trigger, found %', v_trigger_count;
  END IF;
  
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'DUPLICATE TRIGGER REMOVED - DOUBLE CREDIT BUG FIXED';
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Removed: update_treat_wallet_on_transaction';
  RAISE NOTICE 'Kept: trigger_update_treat_wallet';
  RAISE NOTICE 'Users will now receive CORRECT amounts (no more double crediting)';
  RAISE NOTICE '================================================================';
END $$;

-- Add comment documenting this critical fix
COMMENT ON TRIGGER trigger_update_treat_wallet ON treat_transactions IS 
'CRITICAL: This is the ONLY trigger that should update treat_wallets. Having multiple triggers causes double crediting. Fixed 2026-02-08.';
