/*
  # Fix Collaboration Unlocks Insert Policy

  1. Changes
    - Add INSERT policy for collaboration_unlocks table
    - Allow authenticated users to insert their own unlock records
    - Ensure users can only insert records for themselves

  2. Security
    - Users can only insert records with their own user_id
    - Prevents users from creating unlock records for others
*/

-- Add INSERT policy for collaboration_unlocks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'collaboration_unlocks'
    AND policyname = 'Users can create their own collaboration unlocks'
  ) THEN
    CREATE POLICY "Users can create their own collaboration unlocks"
    ON collaboration_unlocks
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
