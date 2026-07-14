/*
  # Add promotion_refund Transaction Type

  1. Problem
    - Promotion rejections are failing because 'promotion_refund' is not an allowed transaction_type
    - The treat_transactions_transaction_type_check constraint doesn't include 'promotion_refund'
    - This prevents the add_treat_balance function from creating refund transactions
    - As a result, rejected promotions don't get refunded and admin rejection fails

  2. Solution
    - Update the check constraint to include 'promotion_refund' as a valid transaction type
    - This allows the refund system to work properly when promotions are rejected

  3. Affected Transaction Types
    After this change, valid types are:
    - purchase: User buys treats
    - spend: User spends treats (promotions, tips, etc)
    - earn: User earns treats (from content engagement)
    - withdraw: User withdraws treats
    - tip_sent: User sends a tip
    - tip_received: User receives a tip
    - daily_checkin: Daily check-in reward
    - referral_bonus: Referral rewards
    - promotion_refund: Refund for rejected promotion (NEW)

  4. Security
    - No changes to RLS policies
    - Existing permissions remain unchanged
*/

-- Drop existing constraint
ALTER TABLE treat_transactions
DROP CONSTRAINT IF EXISTS treat_transactions_transaction_type_check;

-- Add updated constraint with promotion_refund included
ALTER TABLE treat_transactions
ADD CONSTRAINT treat_transactions_transaction_type_check
CHECK (transaction_type IN (
  'purchase',
  'spend',
  'earn',
  'withdraw',
  'tip_sent',
  'tip_received',
  'daily_checkin',
  'referral_bonus',
  'promotion_refund'
));
