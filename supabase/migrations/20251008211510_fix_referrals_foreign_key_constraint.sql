/*
  # Fix Referrals Table Foreign Key Constraint

  1. Changes
    - Add missing foreign key constraint for `referred_id` column in `referrals` table
    - This allows the Supabase client to properly join with the users table using the named relationship syntax
  
  2. Security
    - No RLS changes needed
    - This is a structural fix only
*/

-- Add foreign key constraint for referred_id if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'referrals_referred_id_fkey'
    AND table_name = 'referrals'
  ) THEN
    ALTER TABLE referrals
    ADD CONSTRAINT referrals_referred_id_fkey
    FOREIGN KEY (referred_id)
    REFERENCES users(id)
    ON DELETE CASCADE;
  END IF;
END $$;
