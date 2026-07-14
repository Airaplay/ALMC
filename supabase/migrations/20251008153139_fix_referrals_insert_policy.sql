/*
  # Fix Referrals Table INSERT Policy

  1. Problem
    - Users cannot create referral records because there's no INSERT policy
    - The referrals table has SELECT policies but missing INSERT policy
    - This causes silent failures when new users sign up with referral codes
    
  2. Changes
    - Add INSERT policy for authenticated users to create their own referrals
    - Allow users to insert referral records where they are the referred user
    
  3. Security
    - Users can only insert referrals where they are the referred_id
    - This prevents users from creating fake referrals for others
    - Referrer information comes from validated referral codes
*/

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Users can insert their own referral records" ON referrals;

-- Add INSERT policy for authenticated users
CREATE POLICY "Users can insert their own referral records"
  ON referrals
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = referred_id);
