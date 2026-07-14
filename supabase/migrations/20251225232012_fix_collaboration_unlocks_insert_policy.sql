/*
  # Fix Collaboration Unlocks Insert Policy

  ## Changes
  - Remove service_role-only insert policy
  - Add policy allowing authenticated users to insert their own unlock records
  - This enables users to purchase unlocks directly from the app

  ## Security
  - Users can only insert records for themselves (user_id = auth.uid())
  - All other RLS policies remain unchanged
*/

-- Drop the old service_role-only policy
DROP POLICY IF EXISTS "Service role can insert collaboration unlocks" ON collaboration_unlocks;

-- Create new policy allowing authenticated users to insert their own unlocks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'collaboration_unlocks'
    AND policyname = 'Users can insert their own collaboration unlocks'
  ) THEN
    CREATE POLICY "Users can insert their own collaboration unlocks"
    ON collaboration_unlocks
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
