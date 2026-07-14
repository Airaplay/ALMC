/*
  # Fix Notifications Schema and Badge RLS Policies

  1. Issues Fixed
    - notifications table missing "title" column referenced by creator request functions
    - Conflicting RLS policies on verified_badge_config
    - Admin verification may fail without proper schema qualification

  2. Changes
    - Add "title" column to notifications table (backward compatible)
    - Drop all conflicting policies on verified_badge_config
    - Recreate policies with explicit inline admin checks
    - Fix creator request functions to use correct notification columns

  3. Testing
    - Approve/reject creator requests should now work
    - Badge upload should work for admins
    - Public badge viewing should still work
*/

-- Step 1: Add title column to notifications table if it doesn't exist
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title text DEFAULT 'Notification';

-- Step 2: Drop all conflicting policies on verified_badge_config (comprehensive cleanup)
DROP POLICY IF EXISTS "Public badge viewing" ON verified_badge_config;
DROP POLICY IF EXISTS "Public can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Authenticated users can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can insert verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can update verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Admins can delete verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Anyone can view verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Only admins can insert verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Only admins can update verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Only admins can delete verified badge config" ON verified_badge_config;
DROP POLICY IF EXISTS "Everyone can view verified badge config" ON verified_badge_config;

-- Step 3: Recreate verified_badge_config policies with inline admin checks

DROP POLICY IF EXISTS "verified_badge_config_select_all" ON verified_badge_config;
DROP POLICY IF EXISTS "verified_badge_config_insert_admin" ON verified_badge_config;
DROP POLICY IF EXISTS "verified_badge_config_update_admin" ON verified_badge_config;
DROP POLICY IF EXISTS "verified_badge_config_delete_admin" ON verified_badge_config;

-- SELECT policy: Everyone can view (needed for profile display)
CREATE POLICY "verified_badge_config_select_all"
  ON verified_badge_config
  FOR SELECT
  USING (true);

-- INSERT policy: Only admins can create
CREATE POLICY "verified_badge_config_insert_admin"
  ON verified_badge_config
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- UPDATE policy: Only admins can modify
CREATE POLICY "verified_badge_config_update_admin"
  ON verified_badge_config
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- DELETE policy: Only admins can delete
CREATE POLICY "verified_badge_config_delete_admin"
  ON verified_badge_config
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Step 4: Fix approve_creator_request function to use correct notification columns
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

  -- Create notification for the user with correct columns
  INSERT INTO notifications (user_id, title, type, message)
  VALUES (
    v_user_id,
    'Creator Request Approved',
    'system',
    'Congratulations! Your creator request has been approved. You now have creator privileges and a verified badge.'
  );
END;
$$;

-- Fix reject_creator_request function
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

  -- Create notification for the user with correct columns
  INSERT INTO notifications (user_id, title, type, message)
  VALUES (
    v_user_id,
    'Creator Request Update',
    'system',
    CASE 
      WHEN reason IS NOT NULL THEN 'Your creator request has been reviewed. Reason: ' || reason
      ELSE 'Your creator request has been reviewed. Please contact support for more information.'
    END
  );
END;
$$;

-- Fix ban_creator_request function
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

  -- Create notification for the user with correct columns
  INSERT INTO notifications (user_id, title, type, message)
  VALUES (
    v_user_id,
    'Account Suspended',
    'system',
    CASE
      WHEN reason IS NOT NULL THEN 'Your account has been suspended. Reason: ' || reason
      ELSE 'Your account has been suspended. Please contact support for more information.'
    END
  );
END;
$$;
