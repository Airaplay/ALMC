/*
  # Restrict Collaboration Features to Creators Only

  1. Changes
    - Updates RLS policies on collaboration tables to verify user role
    - Ensures only creators and admins can access collaboration features
    - Adds role verification to all collaboration-related policies

  2. Security
    - Prevents listeners from accessing collaboration features
    - Enforces role-based access control at the database level
    - Maintains existing policies while adding role checks
*/

-- Drop existing policies for collaboration_matches
DROP POLICY IF EXISTS "Artists can view their matches" ON collaboration_matches;

-- Recreate with role verification
CREATE POLICY "Creators can view their matches"
  ON collaboration_matches FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM artist_profiles ap
      JOIN users u ON u.id = ap.user_id
      WHERE ap.id = collaboration_matches.artist_id
      AND ap.user_id = auth.uid()
      AND u.role IN ('creator', 'admin')
    )
  );

-- Drop existing policies for collaboration_requests
DROP POLICY IF EXISTS "Users can view requests they sent or received" ON collaboration_requests;
DROP POLICY IF EXISTS "Artists can send collaboration requests" ON collaboration_requests;
DROP POLICY IF EXISTS "Recipients can update request status" ON collaboration_requests;
DROP POLICY IF EXISTS "Senders can withdraw their requests" ON collaboration_requests;

-- Recreate with role verification
CREATE POLICY "Creators can view requests they sent or received"
  ON collaboration_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('creator', 'admin')
      AND (
        collaboration_requests.sender_user_id = auth.uid() OR
        collaboration_requests.recipient_user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Creators can send collaboration requests"
  ON collaboration_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('creator', 'admin')
    )
  );

CREATE POLICY "Creator recipients can update request status"
  ON collaboration_requests FOR UPDATE
  TO authenticated
  USING (
    recipient_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('creator', 'admin')
    )
  )
  WITH CHECK (
    recipient_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('creator', 'admin')
    )
  );

CREATE POLICY "Creator senders can withdraw their requests"
  ON collaboration_requests FOR UPDATE
  TO authenticated
  USING (
    sender_user_id = auth.uid()
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('creator', 'admin')
    )
  )
  WITH CHECK (
    sender_user_id = auth.uid()
    AND status = 'withdrawn'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('creator', 'admin')
    )
  );

-- Drop existing policies for collaboration_interactions
DROP POLICY IF EXISTS "Users can insert own interactions" ON collaboration_interactions;
DROP POLICY IF EXISTS "Users can view own interactions" ON collaboration_interactions;

-- Recreate with role verification
CREATE POLICY "Creators can insert own interactions"
  ON collaboration_interactions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('creator', 'admin')
    )
  );

CREATE POLICY "Creators can view own interactions"
  ON collaboration_interactions FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('creator', 'admin')
    )
  );

-- Drop existing policies for artist_collaboration_preferences
DROP POLICY IF EXISTS "Artists can view own preferences" ON artist_collaboration_preferences;
DROP POLICY IF EXISTS "Artists can insert own preferences" ON artist_collaboration_preferences;
DROP POLICY IF EXISTS "Artists can update own preferences" ON artist_collaboration_preferences;

-- Recreate with role verification
CREATE POLICY "Creators can view own preferences"
  ON artist_collaboration_preferences FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('creator', 'admin')
    )
  );

CREATE POLICY "Creators can insert own preferences"
  ON artist_collaboration_preferences FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('creator', 'admin')
    )
  );

CREATE POLICY "Creators can update own preferences"
  ON artist_collaboration_preferences FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('creator', 'admin')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('creator', 'admin')
    )
  );

-- Update collaboration_unlocks policies if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'collaboration_unlocks') THEN
    DROP POLICY IF EXISTS "Users can view own unlocks" ON collaboration_unlocks;
    DROP POLICY IF EXISTS "Users can insert own unlocks" ON collaboration_unlocks;

    CREATE POLICY "Creators can view own unlocks"
      ON collaboration_unlocks FOR SELECT
      TO authenticated
      USING (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN ('creator', 'admin')
        )
      );

    CREATE POLICY "Creators can insert own unlocks"
      ON collaboration_unlocks FOR INSERT
      TO authenticated
      WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN ('creator', 'admin')
        )
      );
  END IF;
END $$;
