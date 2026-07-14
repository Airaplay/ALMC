/*
  # Fix Flutterwave Double Credit Issue

  1. Changes
    - Add 'pending_credit' status to treat_payments table
    - This prevents double crediting when both callback and webhook fire
    
  2. How it works
    - GET callback: Verifies payment and marks as 'pending_credit'
    - POST webhook: Credits treats and marks as 'completed'
    - This ensures treats are only credited once
    
  3. Security
    - Maintains all existing RLS policies
    - No changes to wallet logic
    - Only adds intermediate status
*/

-- Add pending_credit status if not exists (idempotent)
DO $$ 
BEGIN
  -- Check if the constraint exists
  IF EXISTS (
    SELECT 1 
    FROM pg_constraint 
    WHERE conname = 'treat_payments_status_check' 
    AND contype = 'c'
  ) THEN
    -- Drop the existing constraint
    ALTER TABLE treat_payments DROP CONSTRAINT treat_payments_status_check;
  END IF;
  
  -- Add the new constraint with pending_credit status
  ALTER TABLE treat_payments 
  ADD CONSTRAINT treat_payments_status_check 
  CHECK (status IN ('pending', 'pending_credit', 'completed', 'failed', 'cancelled'));
  
END $$;

-- Add comment explaining the status flow
COMMENT ON COLUMN treat_payments.status IS 
'Payment status: pending (initial), pending_credit (verified, awaiting webhook credit), completed (treats credited), failed, cancelled';
