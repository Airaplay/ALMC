/*
  # Add DELETE Policy for Reports Table

  1. Changes
    - Add DELETE policy to allow admins to delete reports
    - This enables proper cleanup of spam, duplicate, or resolved reports
    
  2. Security
    - Only users with admin role can delete reports
    - Requires authentication
    - Checks user role from users table
    
  3. Notes
    - Complements existing SELECT, INSERT, and UPDATE policies
    - Maintains secure access control while allowing admin management
*/

-- Add DELETE policy for admins
CREATE POLICY "Admins can delete reports"
  ON reports
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );
