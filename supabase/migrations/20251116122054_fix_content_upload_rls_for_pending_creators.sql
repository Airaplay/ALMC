/*
  # Fix Content Upload RLS for Pending Creators

  1. Changes
    - Drop existing restrictive INSERT policy for creators
    - Create new policy that allows uploads if:
      - User has an artist_profile (regardless of creator request status)
      - OR user has creator/admin role
    - This allows users to upload immediately after completing artist registration
      even while their creator request is pending approval

  2. Security
    - Still restricts uploads to authenticated users only
    - Requires either artist_profile existence or creator/admin role
    - Maintains data ownership (user_id must match auth.uid())
*/

-- Drop the old restrictive policy
DROP POLICY IF EXISTS "Creators can upload any content" ON content_uploads;

-- Create new policy that checks for artist_profile OR creator role
CREATE POLICY "Users with artist profile can upload content"
  ON content_uploads
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() 
    AND (
      -- Has an artist profile
      EXISTS (
        SELECT 1 FROM artist_profiles 
        WHERE user_id = auth.uid()
      )
      -- OR has creator/admin role
      OR get_user_role() = ANY (ARRAY['creator'::text, 'admin'::text])
    )
  );
