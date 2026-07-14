/*
  # Fix Promotions Public Visibility
  
  ## Changes
  
  1. Add RLS Policy
    - Allow all users (authenticated and anonymous) to view active promotions
    - This enables promoted content to be displayed to everyone, not just the user who created the promotion
  
  ## Details
  
  The original RLS policies only allowed:
  - Users to view their own promotions
  - Admins to view all promotions
  
  This new policy allows anyone to view active promotions so that promoted content
  appears to all users on the platform.
*/

-- Allow everyone (authenticated and anonymous) to view active promotions
CREATE POLICY "Anyone can view active promotions"
  ON promotions
  FOR SELECT
  TO public
  USING (status = 'active');