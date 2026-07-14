/*
  # Add DELETE policy for content_uploads table

  1. Security
    - Add DELETE policy for content_uploads table
    - Allow admins and managers to delete any content
    - Allow content owners to delete their own content

  This migration fixes the issue where admins cannot delete content from the dashboard
  due to missing DELETE permissions in Row Level Security policies.
*/

-- Add DELETE policy for admins and managers to delete any content
CREATE POLICY "Admins and managers can delete any content"
  ON content_uploads
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = ANY (ARRAY['admin'::text, 'manager'::text])
    )
  );

-- Add DELETE policy for users to delete their own content
CREATE POLICY "Users can delete own content"
  ON content_uploads
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());