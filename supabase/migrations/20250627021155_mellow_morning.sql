/*
  # Add profile settings fields to users table

  1. New Columns
    - `wallet_address` - For USDT wallet addresses
    - `username` - Unique username (editable once)
    - `username_changed` - Flag to track if username has been modified

  2. Functions
    - `validate_wallet_address` - Validates wallet address formats
    - `check_username_availability` - Checks if username is available
    - `update_user_profile` - Comprehensive profile update function

  3. Security
    - Unique constraints and indexes for usernames
    - Wallet address validation
    - Profile update permissions
*/

-- Add wallet_address column to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'wallet_address'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN wallet_address text;
  END IF;
END $$;

-- Add username column to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'username'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN username text;
  END IF;
END $$;

-- Add unique constraint for username if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_username_key' AND table_name = 'users'
  ) THEN
    ALTER TABLE users 
    ADD CONSTRAINT users_username_key UNIQUE (username);
  END IF;
END $$;

-- Add username_changed flag to track if username has been modified
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'username_changed'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN username_changed boolean DEFAULT false;
  END IF;
END $$;

-- Create unique index for username (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower 
ON users(LOWER(username)) WHERE username IS NOT NULL;

-- Create index for wallet addresses
CREATE INDEX IF NOT EXISTS idx_users_wallet_address 
ON users(wallet_address) WHERE wallet_address IS NOT NULL;

-- Function to validate USDT wallet address format
CREATE OR REPLACE FUNCTION validate_wallet_address(address text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  -- Basic validation for common wallet address formats
  -- USDT can be on multiple networks (Ethereum, Tron, etc.)
  
  -- Ethereum address format (0x followed by 40 hex characters)
  IF address ~ '^0x[a-fA-F0-9]{40}$' THEN
    RETURN true;
  END IF;
  
  -- Tron address format (T followed by 33 base58 characters)
  IF address ~ '^T[A-Za-z0-9]{33}$' THEN
    RETURN true;
  END IF;
  
  -- Bitcoin address format (legacy, segwit, etc.)
  IF address ~ '^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$' OR 
     address ~ '^bc1[a-z0-9]{39,59}$' THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;

-- Function to check username availability
CREATE OR REPLACE FUNCTION check_username_availability(new_username text, user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing_user_id uuid;
BEGIN
  -- Check if username is already taken by another user
  SELECT id INTO existing_user_id
  FROM users
  WHERE LOWER(username) = LOWER(new_username)
    AND id != user_id;
  
  RETURN existing_user_id IS NULL;
END;
$$;

-- Function to update user profile with validation
CREATE OR REPLACE FUNCTION update_user_profile(
  new_display_name text DEFAULT NULL,
  new_bio text DEFAULT NULL,
  new_country text DEFAULT NULL,
  new_username text DEFAULT NULL,
  new_wallet_address text DEFAULT NULL,
  new_avatar_url text DEFAULT NULL
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
    updated_at = now()
  WHERE id = current_user_id;

  RETURN jsonb_build_object('success', true, 'message', 'Profile updated successfully');
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION validate_wallet_address TO authenticated;
GRANT EXECUTE ON FUNCTION check_username_availability TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_profile TO authenticated;