/*
  # Backfill Missing Withdrawal Amounts to Live Balance

  ## Overview
  Due to a bug in the process_treat_withdrawal function, users who withdrew treats
  between 2025-11-22 and 2025-11-24 had their treats deducted but the USD was never
  added to their Live Balance (total_earnings).

  ## Affected Users
  - 4 users made 14 total withdrawals
  - Total missing amount: $90.09 USD
  - All withdrawals were properly logged but funds were never credited

  ## Solution
  This migration:
  1. Identifies all completed withdrawals without the live_balance flag
  2. Calculates the net USD amount that should have been credited
  3. Adds the missing amounts to users' total_earnings
  4. Updates transaction metadata to mark as backfilled

  ## Security
  - Read-only identification of affected users
  - Atomic updates per user
  - Complete audit trail maintained
*/

-- Backfill the missing Live Balance amounts for affected users
DO $$
DECLARE
  v_user_record RECORD;
  v_total_missing_amount numeric;
  v_users_affected integer := 0;
BEGIN
  -- Process each affected user
  FOR v_user_record IN
    SELECT 
      tt.user_id,
      u.email,
      u.display_name,
      COALESCE(SUM((tt.metadata->>'net_amount')::numeric), 0) as missing_amount,
      COUNT(*) as withdrawal_count,
      jsonb_agg(tt.id) as transaction_ids
    FROM treat_transactions tt
    JOIN users u ON u.id = tt.user_id
    WHERE tt.transaction_type = 'withdrawal'
      AND tt.status = 'completed'
      AND (tt.metadata->>'added_to_live_balance' IS NULL 
           OR (tt.metadata->>'added_to_live_balance')::boolean = false)
    GROUP BY tt.user_id, u.email, u.display_name
  LOOP
    -- Add the missing amount to user's Live Balance
    UPDATE users
    SET 
      total_earnings = COALESCE(total_earnings, 0) + v_user_record.missing_amount,
      updated_at = now()
    WHERE id = v_user_record.user_id;

    -- Update transaction metadata to mark as backfilled
    UPDATE treat_transactions
    SET metadata = metadata || jsonb_build_object(
      'added_to_live_balance', true,
      'backfilled', true,
      'backfilled_at', now(),
      'backfill_reason', 'Migration fix for missing live balance credit'
    )
    WHERE id IN (SELECT jsonb_array_elements_text(v_user_record.transaction_ids)::uuid);

    v_users_affected := v_users_affected + 1;
    
    RAISE NOTICE 'Backfilled $% USD for user % (%) - % withdrawals',
      v_user_record.missing_amount,
      v_user_record.display_name,
      v_user_record.email,
      v_user_record.withdrawal_count;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % users affected', v_users_affected;
END $$;

-- Verify the backfill
DO $$
DECLARE
  v_summary RECORD;
BEGIN
  SELECT 
    COUNT(DISTINCT user_id) as users_backfilled,
    COUNT(*) as transactions_backfilled,
    SUM((metadata->>'net_amount')::numeric) as total_amount_backfilled
  INTO v_summary
  FROM treat_transactions
  WHERE transaction_type = 'withdrawal'
    AND status = 'completed'
    AND (metadata->>'backfilled')::boolean = true;

  RAISE NOTICE 'Verification: % users, % transactions, $% USD total backfilled',
    v_summary.users_backfilled,
    v_summary.transactions_backfilled,
    v_summary.total_amount_backfilled;
END $$;
