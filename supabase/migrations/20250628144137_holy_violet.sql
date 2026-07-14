/*
  # Add user notification and privacy settings

  1. New Columns
    - Add notification preference columns to `users` table
    - Add privacy setting columns to `users` table
    - All columns are boolean with sensible defaults

  2. Settings Categories
    - Notification Settings:
      - `receive_new_follower_notifications` - Notifications when someone follows you
      - `receive_content_notifications` - Notifications from followed artists
      - `receive_playlist_notifications` - Notifications about playlist updates
      - `receive_system_notifications` - System announcements and updates
    - Privacy Settings:
      - `show_listening_history` - Whether to show listening activity to others
      - `profile_visibility` - Profile visibility (public/private)

  3. Security
    - Users can only update their own settings
    - Settings inherit existing RLS policies
*/

-- Add notification preference columns to users table
DO $$
BEGIN
  -- New follower notifications
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'receive_new_follower_notifications'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN receive_new_follower_notifications boolean DEFAULT true;
  END IF;

  -- Content notifications from followed artists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'receive_content_notifications'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN receive_content_notifications boolean DEFAULT true;
  END IF;

  -- Playlist update notifications
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'receive_playlist_notifications'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN receive_playlist_notifications boolean DEFAULT true;
  END IF;

  -- System notifications
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'receive_system_notifications'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN receive_system_notifications boolean DEFAULT true;
  END IF;

  -- Privacy: Show listening history
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'show_listening_history'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN show_listening_history boolean DEFAULT true;
  END IF;

  -- Privacy: Profile visibility
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'profile_visibility'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN profile_visibility text DEFAULT 'public' CHECK (profile_visibility IN ('public', 'private'));
  END IF;
END $$;

-- Create indexes for settings queries (optional, for performance)
CREATE INDEX IF NOT EXISTS idx_users_notification_settings 
ON users(receive_new_follower_notifications, receive_content_notifications, receive_playlist_notifications, receive_system_notifications) 
WHERE receive_new_follower_notifications = true 
   OR receive_content_notifications = true 
   OR receive_playlist_notifications = true 
   OR receive_system_notifications = true;

CREATE INDEX IF NOT EXISTS idx_users_privacy_settings 
ON users(profile_visibility, show_listening_history);

-- Update existing users to have default notification and privacy settings
UPDATE users 
SET 
  receive_new_follower_notifications = COALESCE(receive_new_follower_notifications, true),
  receive_content_notifications = COALESCE(receive_content_notifications, true),
  receive_playlist_notifications = COALESCE(receive_playlist_notifications, true),
  receive_system_notifications = COALESCE(receive_system_notifications, true),
  show_listening_history = COALESCE(show_listening_history, true),
  profile_visibility = COALESCE(profile_visibility, 'public')
WHERE receive_new_follower_notifications IS NULL 
   OR receive_content_notifications IS NULL 
   OR receive_playlist_notifications IS NULL 
   OR receive_system_notifications IS NULL 
   OR show_listening_history IS NULL 
   OR profile_visibility IS NULL;

-- Update the user profile update function to include new settings
CREATE OR REPLACE FUNCTION update_user_profile(
  new_display_name text DEFAULT NULL,
  new_bio text DEFAULT NULL,
  new_country text DEFAULT NULL,
  new_username text DEFAULT NULL,
  new_wallet_address text DEFAULT NULL,
  new_avatar_url text DEFAULT NULL,
  new_show_artist_badge boolean DEFAULT NULL,
  new_receive_new_follower_notifications boolean DEFAULT NULL,
  new_receive_content_notifications boolean DEFAULT NULL,
  new_receive_playlist_notifications boolean DEFAULT NULL,
  new_receive_system_notifications boolean DEFAULT NULL,
  new_show_listening_history boolean DEFAULT NULL,
  new_profile_visibility text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_user_record record;
  result jsonb;
BEGIN
  -- Check if user is authenticated
  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Authentication required');
  END IF;

  -- Get current user data
  SELECT * INTO current_user_record
  FROM users
  WHERE id = current_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  -- Validate username if provided
  IF new_username IS NOT NULL THEN
    -- Check if username has already been changed
    IF current_user_record.username_changed THEN
      RETURN jsonb_build_object('error', 'Username can only be changed once');
    END IF;
    
    -- Validate username format (alphanumeric, underscore, hyphen, 3-30 chars)
    IF NOT (new_username ~ '^[a-zA-Z0-9_-]{3,30}$') THEN
      RETURN jsonb_build_object('error', 'Username must be 3-30 characters and contain only letters, numbers, underscore, or hyphen');
    END IF;
    
    -- Check availability
    IF NOT check_username_availability(new_username, current_user_id) THEN
      RETURN jsonb_build_object('error', 'Username is already taken');
    END IF;
  END IF;

  -- Validate wallet address if provided
  IF new_wallet_address IS NOT NULL AND new_wallet_address != '' THEN
    IF NOT validate_wallet_address(new_wallet_address) THEN
      RETURN jsonb_build_object('error', 'Invalid wallet address format');
    END IF;
  END IF;

  -- Validate profile visibility if provided
  IF new_profile_visibility IS NOT NULL THEN
    IF new_profile_visibility NOT IN ('public', 'private') THEN
      RETURN jsonb_build_object('error', 'Profile visibility must be either public or private');
    END IF;
  END IF;

  -- Update user profile
  UPDATE users
  SET 
    display_name = COALESCE(new_display_name, display_name),
    bio = COALESCE(new_bio, bio),
    country = COALESCE(new_country, country),
    username = COALESCE(new_username, username),
    username_changed = CASE 
      WHEN new_username IS NOT NULL THEN true 
      ELSE username_changed 
    END,
    wallet_address = COALESCE(new_wallet_address, wallet_address),
    avatar_url = COALESCE(new_avatar_url, avatar_url),
    show_artist_badge = COALESCE(new_show_artist_badge, show_artist_badge),
    receive_new_follower_notifications = COALESCE(new_receive_new_follower_notifications, receive_new_follower_notifications),
    receive_content_notifications = COALESCE(new_receive_content_notifications, receive_content_notifications),
    receive_playlist_notifications = COALESCE(new_receive_playlist_notifications, receive_playlist_notifications),
    receive_system_notifications = COALESCE(new_receive_system_notifications, receive_system_notifications),
    show_listening_history = COALESCE(new_show_listening_history, show_listening_history),
    profile_visibility = COALESCE(new_profile_visibility, profile_visibility),
    updated_at = now()
  WHERE id = current_user_id;

  RETURN jsonb_build_object('success', true, 'message', 'Profile updated successfully');
END;
$$;

-- Function to get user notification settings
CREATE OR REPLACE FUNCTION get_user_notification_settings(user_uuid uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  settings_result jsonb;
BEGIN
  -- Check if user is authenticated
  IF user_uuid IS NULL THEN
    RETURN jsonb_build_object('error', 'Authentication required');
  END IF;

  -- Get notification settings
  SELECT jsonb_build_object(
    'receive_new_follower_notifications', receive_new_follower_notifications,
    'receive_content_notifications', receive_content_notifications,
    'receive_playlist_notifications', receive_playlist_notifications,
    'receive_system_notifications', receive_system_notifications
  ) INTO settings_result
  FROM users
  WHERE id = user_uuid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  RETURN settings_result;
END;
$$;

-- Function to get user privacy settings
CREATE OR REPLACE FUNCTION get_user_privacy_settings(user_uuid uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  settings_result jsonb;
BEGIN
  -- Check if user is authenticated
  IF user_uuid IS NULL THEN
    RETURN jsonb_build_object('error', 'Authentication required');
  END IF;

  -- Get privacy settings
  SELECT jsonb_build_object(
    'show_artist_badge', show_artist_badge,
    'show_listening_history', show_listening_history,
    'profile_visibility', profile_visibility
  ) INTO settings_result
  FROM users
  WHERE id = user_uuid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  RETURN settings_result;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_user_notification_settings TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_privacy_settings TO authenticated;