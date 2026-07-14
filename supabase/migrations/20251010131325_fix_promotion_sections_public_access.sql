/*
  # Fix Promotion Sections Public Access

  ## Changes
  
  1. RLS Policy Update
    - Allow public (authenticated and anonymous) users to view active promotion sections
    - This enables the promotion system to work for all users, not just authenticated ones
  
  ## Details
  
  The original RLS policy only allowed authenticated users to view promotion sections.
  This prevented anonymous/unauthenticated users from seeing promoted content.
  
  This migration updates the policy to allow public access to active promotion sections.
*/

-- Drop the old authenticated-only policy
DROP POLICY IF EXISTS "Anyone can view active promotion sections" ON promotion_sections;

-- Create new public policy for viewing active promotion sections
CREATE POLICY "Public can view active promotion sections"
  ON promotion_sections
  FOR SELECT
  TO public
  USING (is_active = true);
