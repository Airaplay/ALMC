/*
  # Create Creator/Artiste Request Management System

  1. New Tables
    - `creator_requests`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `artist_name` (text)
      - `real_name` (text)
      - `email` (text)
      - `phone` (text)
      - `country` (text)
      - `genre` (text)
      - `bio` (text)
      - `social_links` (jsonb) - stores Instagram, Twitter, etc.
      - `id_document_url` (text) - Supabase storage URL
      - `cover_art_url` (text) - Supabase storage URL
      - `status` (text) - pending, approved, rejected, banned
      - `rejection_reason` (text, nullable)
      - `submitted_at` (timestamptz)
      - `reviewed_at` (timestamptz, nullable)
      - `reviewed_by` (uuid, nullable, references auth.users)

    - `verified_badge_config`
      - `id` (uuid, primary key)
      - `badge_url` (text) - URL to the verified badge image
      - `updated_at` (timestamptz)
      - `updated_by` (uuid, references auth.users, nullable)

  2. Security
    - Enable RLS on both tables
    - Users can insert their own creator requests
    - Users can view their own requests
    - Admins can view and update all requests
    - Only admins can manage verified badge config

  3. Indexes
    - Index on user_id for fast lookups
    - Index on status for filtering
    - Index on submitted_at for sorting
*/

-- Create creator_requests table
CREATE TABLE IF NOT EXISTS creator_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  artist_name text NOT NULL,
  real_name text NOT NULL,
  email text NOT NULL,
  phone text,
  country text NOT NULL,
  genre text NOT NULL,
  bio text,
  social_links jsonb DEFAULT '{}'::jsonb,
  id_document_url text,
  cover_art_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'banned')),
  rejection_reason text,
  submitted_at timestamptz DEFAULT now() NOT NULL,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  UNIQUE(user_id)
);

-- Create verified_badge_config table
CREATE TABLE IF NOT EXISTS verified_badge_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_url text NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid REFERENCES auth.users(id)
);

-- Insert default verified badge config
INSERT INTO verified_badge_config (badge_url)
VALUES ('https://via.placeholder.com/24x24.png?text=V')
ON CONFLICT DO NOTHING;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_creator_requests_user_id ON creator_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_creator_requests_status ON creator_requests(status);
CREATE INDEX IF NOT EXISTS idx_creator_requests_submitted_at ON creator_requests(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_requests_email ON creator_requests(email);
CREATE INDEX IF NOT EXISTS idx_creator_requests_artist_name ON creator_requests(artist_name);

-- Enable RLS
ALTER TABLE creator_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE verified_badge_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies for creator_requests

-- Users can insert their own creator request
CREATE POLICY "Users can submit creator request"
  ON creator_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can view their own requests
CREATE POLICY "Users can view own creator request"
  ON creator_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all requests
CREATE POLICY "Admins can view all creator requests"
  ON creator_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can update all requests
CREATE POLICY "Admins can update creator requests"
  ON creator_requests
  FOR UPDATE
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

-- RLS Policies for verified_badge_config

-- Everyone can view the verified badge config
CREATE POLICY "Anyone can view verified badge config"
  ON verified_badge_config
  FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can update verified badge config
CREATE POLICY "Admins can update verified badge config"
  ON verified_badge_config
  FOR UPDATE
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

-- Only admins can insert verified badge config
CREATE POLICY "Admins can insert verified badge config"
  ON verified_badge_config
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Function to handle creator request approval
CREATE OR REPLACE FUNCTION approve_creator_request(request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_artist_name text;
  v_bio text;
  v_country text;
  v_genre text;
BEGIN
  -- Check if the caller is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can approve creator requests';
  END IF;

  -- Get details from the request
  SELECT user_id, artist_name, bio, country, genre
  INTO v_user_id, v_artist_name, v_bio, v_country, v_genre
  FROM creator_requests
  WHERE id = request_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Creator request not found';
  END IF;

  -- Update creator request status
  UPDATE creator_requests
  SET 
    status = 'approved',
    reviewed_at = now(),
    reviewed_by = auth.uid()
  WHERE creator_requests.id = request_id;

  -- Update user role and show_artist_badge
  UPDATE users
  SET 
    role = 'creator',
    show_artist_badge = true
  WHERE users.id = v_user_id;

  -- Update or create artist_profiles with verified badge
  INSERT INTO artist_profiles (
    user_id,
    stage_name,
    bio,
    country,
    is_verified
  )
  VALUES (
    v_user_id,
    v_artist_name,
    v_bio,
    v_country,
    true
  )
  ON CONFLICT (user_id) DO UPDATE
  SET 
    is_verified = true,
    stage_name = COALESCE(artist_profiles.stage_name, v_artist_name),
    bio = COALESCE(artist_profiles.bio, v_bio),
    country = COALESCE(artist_profiles.country, v_country);

  -- Create notification for the user
  INSERT INTO notifications (user_id, title, message, type)
  VALUES (
    v_user_id,
    'Creator Request Approved!',
    'Congratulations! Your creator request has been approved. You now have creator privileges and a verified badge.',
    'system'
  );
END;
$$;

-- Function to reject creator request
CREATE OR REPLACE FUNCTION reject_creator_request(
  request_id uuid,
  reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Check if the caller is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can reject creator requests';
  END IF;

  -- Get user_id from the request
  SELECT user_id
  INTO v_user_id
  FROM creator_requests
  WHERE id = request_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Creator request not found';
  END IF;

  -- Update creator request status
  UPDATE creator_requests
  SET 
    status = 'rejected',
    rejection_reason = reason,
    reviewed_at = now(),
    reviewed_by = auth.uid()
  WHERE creator_requests.id = request_id;

  -- Create notification for the user
  INSERT INTO notifications (user_id, title, message, type)
  VALUES (
    v_user_id,
    'Creator Request Update',
    CASE 
      WHEN reason IS NOT NULL THEN 'Your creator request has been reviewed. Reason: ' || reason
      ELSE 'Your creator request has been reviewed. Please contact support for more information.'
    END,
    'system'
  );
END;
$$;

-- Function to ban creator
CREATE OR REPLACE FUNCTION ban_creator_request(
  request_id uuid,
  reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Check if the caller is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can ban creator requests';
  END IF;

  -- Get user_id from the request
  SELECT user_id
  INTO v_user_id
  FROM creator_requests
  WHERE id = request_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Creator request not found';
  END IF;

  -- Update creator request status
  UPDATE creator_requests
  SET 
    status = 'banned',
    rejection_reason = reason,
    reviewed_at = now(),
    reviewed_by = auth.uid()
  WHERE creator_requests.id = request_id;

  -- Suspend the user account by setting banned_until to far future
  UPDATE users
  SET banned_until = now() + interval '100 years'
  WHERE users.id = v_user_id;

  -- Create notification for the user
  INSERT INTO notifications (user_id, title, message, type)
  VALUES (
    v_user_id,
    'Account Suspended',
    'Your account has been suspended. Please contact support for more information.',
    'system'
  );
END;
$$;

-- Function to ensure all existing creators have verified badges
CREATE OR REPLACE FUNCTION sync_creator_verified_badges()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update all users with creator role to show artist badge
  UPDATE users
  SET show_artist_badge = true
  WHERE role = 'creator'
  AND (show_artist_badge IS NULL OR show_artist_badge = false);

  -- Update all artist_profiles to have verified badge
  UPDATE artist_profiles
  SET is_verified = true
  WHERE user_id IN (
    SELECT id FROM users WHERE role = 'creator'
  )
  AND (is_verified IS NULL OR is_verified = false);
END;
$$;

-- Run the sync function once to ensure existing creators have badges
SELECT sync_creator_verified_badges();