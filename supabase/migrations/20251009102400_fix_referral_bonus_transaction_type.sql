/*
  # Fix Referral Bonus Transaction Type

  1. Problem
    - Referral rewards fail silently because 'referral_bonus' is not in the allowed transaction types
    - The treat_transactions table has a CHECK constraint that only allows specific types
    - When a referred user meets the activity threshold, the referrer doesn't get credited

  2. Solution
    - Add 'referral_bonus' to the allowed transaction_type values
    - This allows the process_referral_reward function to successfully credit referrers

  3. Impact
    - Referrers will now receive their rewards when referred users become active
    - Transaction history will properly show 'referral_bonus' entries
*/

-- Drop the existing constraint
ALTER TABLE treat_transactions
DROP CONSTRAINT IF EXISTS treat_transactions_transaction_type_check;

-- Add the updated constraint with 'referral_bonus' included
ALTER TABLE treat_transactions
ADD CONSTRAINT treat_transactions_transaction_type_check
CHECK (transaction_type = ANY (ARRAY[
  'purchase'::text,
  'spend'::text,
  'earn'::text,
  'withdraw'::text,
  'tip_sent'::text,
  'tip_received'::text,
  'daily_checkin'::text,
  'referral_bonus'::text  -- Added for referral rewards
]));
