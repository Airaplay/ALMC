/*
  # Update Admin Activity Logs RLS Policies for Account Role

  1. Changes
    - Update "Admins can view activity logs" policy to include all admin roles (admin, manager, editor, account)
    - Update "System can insert activity logs" policy to include all admin roles (admin, manager, editor, account)

  2. Security
    - Ensures account role users can view and log admin activities
    - Maintains security by restricting access to authenticated admin users only
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can view activity logs" ON admin_activity_logs;
DROP POLICY IF EXISTS "System can insert activity logs" ON admin_activity_logs;

-- Recreate policies with updated role checks
CREATE POLICY "Admins can view activity logs"
ON admin_activity_logs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager', 'editor', 'account')
  )
);

CREATE POLICY "System can insert activity logs"
ON admin_activity_logs
FOR INSERT
TO authenticated
WITH CHECK (
  admin_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager', 'editor', 'account')
  )
);
