/*
  # Fix Daily Check-in Transaction Type
  
  1. Problem
    - The daily check-in feature uses transaction_type='daily_checkin'
    - But treat_transactions table only allows: 'purchase', 'spend', 'earn', 'withdraw', 'tip_sent', 'tip_received'
    - This causes: "new row violates check constraint treat_transactions_transaction_type_check"
    
  2. Solution
    - Add 'daily_checkin' to the allowed transaction types in the CHECK constraint
    - This allows daily check-in rewards to be properly recorded
    
  3. Security
    - No security changes
    - Only extends allowed transaction types
*/

-- Drop the existing check constraint
ALTER TABLE treat_transactions 
DROP CONSTRAINT IF EXISTS treat_transactions_transaction_type_check;

-- Add the constraint back with 'daily_checkin' included
ALTER TABLE treat_transactions 
ADD CONSTRAINT treat_transactions_transaction_type_check 
CHECK (transaction_type IN ('purchase', 'spend', 'earn', 'withdraw', 'tip_sent', 'tip_received', 'daily_checkin'));
