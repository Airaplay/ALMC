/*
  # Add DELETE policy for treat_tips table

  1. Changes
    - Add RLS policy to allow users to delete tips they sent
    - This enables users to remove recipients from their "recent recipients" list permanently
  
  2. Security
    - Users can only delete tips where they are the sender
    - Admins can delete any tips
*/

-- Allow users to delete tips they sent
CREATE POLICY "Users can delete tips they sent"
  ON treat_tips
  FOR DELETE
  TO authenticated
  USING (sender_id = auth.uid());

-- Allow admins to delete any tips
CREATE POLICY "Admins can delete any tips"
  ON treat_tips
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );
