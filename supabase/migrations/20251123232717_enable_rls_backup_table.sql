/*
  # Enable RLS on manual_trending_songs_backup

  ## Security Issue
  The manual_trending_songs_backup table is the only table without RLS enabled.
  
  ## Changes
  1. Enable RLS on manual_trending_songs_backup
  2. Add admin-only access policy for defense-in-depth
*/

-- Enable RLS on backup table
ALTER TABLE manual_trending_songs_backup ENABLE ROW LEVEL SECURITY;

-- Create admin-only policy
CREATE POLICY "Admins can manage backup"
ON manual_trending_songs_backup FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);
