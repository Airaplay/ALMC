/*
  # Create notifications table for user notifications

  1. New Table
    - `notifications` - Store user notifications
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `type` (text, notification type)
      - `message` (text, notification content)
      - `metadata` (jsonb, additional data)
      - `is_read` (boolean, read status)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on notifications table
    - Users can only read/manage their own notifications
    - Admins can create notifications for any user

  3. Indexes
    - Add indexes for better query performance
*/

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  message text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- RLS Policies for notifications table
-- Users can read their own notifications
CREATE POLICY "Users can read own notifications"
ON notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can update (mark as read) their own notifications
CREATE POLICY "Users can update own notifications"
ON notifications
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Users can delete their own notifications
CREATE POLICY "Users can delete own notifications"
ON notifications
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Admins can create notifications for any user
CREATE POLICY "Admins can create notifications"
ON notifications
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IN (
    SELECT id FROM users WHERE role = 'admin'
  )
  OR
  user_id = auth.uid() -- Users can create notifications for themselves
);

-- Function to mark all notifications as read for a user
CREATE OR REPLACE FUNCTION mark_all_notifications_read(user_uuid uuid DEFAULT auth.uid())
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE notifications
  SET is_read = true
  WHERE user_id = user_uuid AND is_read = false;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION mark_all_notifications_read TO authenticated;

-- Function to get unread notification count for a user
CREATE OR REPLACE FUNCTION get_unread_notification_count(user_uuid uuid DEFAULT auth.uid())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  count_result integer;
BEGIN
  SELECT COUNT(*)::integer INTO count_result
  FROM notifications
  WHERE user_id = user_uuid AND is_read = false;
  
  RETURN COALESCE(count_result, 0);
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_unread_notification_count TO authenticated;

-- Insert sample notifications for testing (optional)
-- These will only be created if the table is empty
DO $$
DECLARE
  test_user_id uuid;
BEGIN
  -- Get a random user ID for testing
  SELECT id INTO test_user_id FROM users LIMIT 1;
  
  IF test_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM notifications LIMIT 1) THEN
    INSERT INTO notifications (user_id, type, message, metadata, is_read, created_at) VALUES
    (test_user_id, 'follow', 'John Doe started following you', '{"follower_id": "00000000-0000-0000-0000-000000000000"}', false, now() - interval '2 days'),
    (test_user_id, 'like', 'Your song "Summer Vibes" was liked by Jane Smith', '{"song_id": "00000000-0000-0000-0000-000000000000"}', false, now() - interval '1 day'),
    (test_user_id, 'playlist', 'Your song was added to playlist "Workout Mix"', '{"playlist_id": "00000000-0000-0000-0000-000000000000"}', true, now() - interval '12 hours'),
    (test_user_id, 'system', 'Welcome to the platform! Complete your profile to get started.', '{}', true, now() - interval '3 days');
  END IF;
END $$;