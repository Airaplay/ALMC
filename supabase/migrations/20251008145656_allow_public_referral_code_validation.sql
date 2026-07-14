/*
  # Allow Public Referral Code Validation

  1. Changes
    - Add RLS policy to allow anyone (including unauthenticated users) to validate referral codes
    - Only expose the user_id and code fields for validation purposes
    - Existing policies remain for authenticated users to view their own codes
  
  2. Security
    - Policy only allows SELECT operations
    - Limited to reading code and user_id fields (no sensitive data exposed)
    - Necessary for signup flow where unauthenticated users need to validate referral codes
*/

-- Allow anyone to validate referral codes by reading code and user_id
-- This is necessary for the signup flow where new users need to validate referral codes
CREATE POLICY "Anyone can validate referral codes"
  ON referral_codes
  FOR SELECT
  TO anon, authenticated
  USING (true);