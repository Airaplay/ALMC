/*
  # Add Advanced Notification Settings

  1. New Columns
    - `email_notifications` (boolean) - Enable/disable email notifications
    - `push_notifications` (boolean) - Enable/disable push notifications
    - `notification_sound` (boolean) - Enable/disable notification sounds
    - `quiet_hours_enabled` (boolean) - Enable/disable Do Not Disturb mode
    - `quiet_hours_start` (time) - Start time for quiet hours (HH:MM format)
    - `quiet_hours_end` (time) - End time for quiet hours (HH:MM format)

  2. Updates
    - Set default values for all new columns
    - Update existing users with default values

  3. Notes
    - All columns are optional with sensible defaults
    - Quiet hours default to 10 PM - 8 AM
    - Email and push notifications enabled by default
    - Notification sound enabled by default
*/

-- Add email_notifications column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'email_notifications'
  ) THEN
    ALTER TABLE users ADD COLUMN email_notifications boolean DEFAULT true;
  END IF;
END $$;

-- Add push_notifications column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'push_notifications'
  ) THEN
    ALTER TABLE users ADD COLUMN push_notifications boolean DEFAULT true;
  END IF;
END $$;

-- Add notification_sound column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'notification_sound'
  ) THEN
    ALTER TABLE users ADD COLUMN notification_sound boolean DEFAULT true;
  END IF;
END $$;

-- Add quiet_hours_enabled column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'quiet_hours_enabled'
  ) THEN
    ALTER TABLE users ADD COLUMN quiet_hours_enabled boolean DEFAULT false;
  END IF;
END $$;

-- Add quiet_hours_start column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'quiet_hours_start'
  ) THEN
    ALTER TABLE users ADD COLUMN quiet_hours_start time DEFAULT '22:00:00';
  END IF;
END $$;

-- Add quiet_hours_end column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'quiet_hours_end'
  ) THEN
    ALTER TABLE users ADD COLUMN quiet_hours_end time DEFAULT '08:00:00';
  END IF;
END $$;

-- Update existing users with default values
UPDATE users
SET 
  email_notifications = COALESCE(email_notifications, true),
  push_notifications = COALESCE(push_notifications, true),
  notification_sound = COALESCE(notification_sound, true),
  quiet_hours_enabled = COALESCE(quiet_hours_enabled, false),
  quiet_hours_start = COALESCE(quiet_hours_start, '22:00:00'),
  quiet_hours_end = COALESCE(quiet_hours_end, '08:00:00')
WHERE 
  email_notifications IS NULL
  OR push_notifications IS NULL
  OR notification_sound IS NULL
  OR quiet_hours_enabled IS NULL
  OR quiet_hours_start IS NULL
  OR quiet_hours_end IS NULL;

-- Create index for notification settings queries
CREATE INDEX IF NOT EXISTS idx_users_advanced_notification_settings 
ON users(email_notifications, push_notifications, notification_sound, quiet_hours_enabled);

-- Function to check if user is in quiet hours
CREATE OR REPLACE FUNCTION is_in_quiet_hours(user_uuid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_quiet_enabled boolean;
  user_quiet_start time;
  user_quiet_end time;
  current_time_local time;
BEGIN
  -- Get user's quiet hours settings
  SELECT quiet_hours_enabled, quiet_hours_start, quiet_hours_end
  INTO user_quiet_enabled, user_quiet_start, user_quiet_end
  FROM users
  WHERE id = user_uuid;

  -- If quiet hours not enabled, return false
  IF NOT user_quiet_enabled THEN
    RETURN false;
  END IF;

  -- Get current time
  current_time_local := CURRENT_TIME;

  -- Check if current time is within quiet hours
  IF user_quiet_start < user_quiet_end THEN
    -- Simple case: quiet hours don't cross midnight
    RETURN current_time_local >= user_quiet_start AND current_time_local < user_quiet_end;
  ELSE
    -- Quiet hours cross midnight (e.g., 22:00 to 08:00)
    RETURN current_time_local >= user_quiet_start OR current_time_local < user_quiet_end;
  END IF;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION is_in_quiet_hours TO authenticated;
