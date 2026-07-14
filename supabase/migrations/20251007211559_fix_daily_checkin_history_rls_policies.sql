/*
  # Fix Daily Checkin History RLS Policies
  
  1. Issue
    - The `daily_checkin_history` table has no RLS policies
    - Users cannot insert check-in records
    - This causes check-in process to fail
    
  2. Solution
    - Add RLS policy for users to insert their own check-ins
    - Add RLS policy for users to read their own check-in history
    - Add RLS policy for admins to view all check-ins
    
  3. Security
    - Users can only insert records for themselves
    - Users can only read their own history
    - Admins can view all check-ins for analytics
*/

-- Ensure RLS is enabled
ALTER TABLE daily_checkin_history ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can read own checkin history" ON daily_checkin_history;
DROP POLICY IF EXISTS "Users can insert own checkin" ON daily_checkin_history;
DROP POLICY IF EXISTS "Admins can view all checkin history" ON daily_checkin_history;

-- Create RLS policies for daily_checkin_history
CREATE POLICY "Users can read own checkin history"
  ON daily_checkin_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own checkin"
  ON daily_checkin_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all checkin history"
  ON daily_checkin_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );
