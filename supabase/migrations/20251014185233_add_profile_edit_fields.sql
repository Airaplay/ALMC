/*
  # Add Profile Edit Fields

  1. New Fields
    - `social_media_platform` (text, nullable) - Platform name (youtube, facebook, tiktok, instagram)
    - `social_media_url` (text, nullable) - Full URL to user's social media profile
    - `username_last_changed_at` (timestamp, nullable) - Track when username was last changed

  2. Changes
    - Add new columns to users table to support enhanced profile editing
    - Users can only choose one social media platform to display
    - Username changes are tracked to enforce 14-day restriction

  3. Security
    - Existing RLS policies apply to these new columns
    - No additional security changes needed
*/

-- Add social media fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS social_media_platform text 
CHECK (social_media_platform IN ('youtube', 'facebook', 'tiktok', 'instagram'));

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS social_media_url text;

-- Add username last changed tracking
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS username_last_changed_at timestamptz;

-- Create index for faster queries on username changes
CREATE INDEX IF NOT EXISTS idx_users_username_last_changed 
ON users(username_last_changed_at) 
WHERE username_last_changed_at IS NOT NULL;
