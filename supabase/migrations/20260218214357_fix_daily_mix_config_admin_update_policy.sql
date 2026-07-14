/*
  # Fix daily_mix_config RLS - Add admin UPDATE policy

  ## Problem
  The daily_mix_config table only had a SELECT policy (public read).
  There was no UPDATE policy, so admin save attempts were silently
  blocked by RLS, meaning settings appeared to save but were discarded
  on refresh.

  ## Fix
  Add an UPDATE policy restricted to admin users only.
*/

CREATE POLICY "Admins can update daily mix config"
  ON daily_mix_config
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'account_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'account_admin')
    )
  );
