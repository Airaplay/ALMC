/*
  # Backfill Creator Requests System with Existing Creators

  1. Problem Analysis
    - 12 creators exist in the users table with role='creator'
    - creator_requests table is empty (0 entries)
    - Admin dashboard shows no creators due to empty creator_requests table

  2. Solution
    - Insert all existing creators into creator_requests with status='approved'
    - Extract artist data from artists and artist_profiles tables
    - Set timestamps based on user creation date
    - Mark all backfilled entries as system-approved

  3. Data Mapping
    - user_id: from users table
    - artist_name: from artists.name or users.display_name
    - real_name: from users.display_name or email
    - email: from users.email
    - phone: NULL (not available)
    - country: from users.country or 'Unknown'
    - genre: 'General'
    - bio: from users.bio or artists.bio
    - social_links: empty object
    - status: 'approved' for all (existing creators are already approved)
    - submitted_at: user creation date
    - reviewed_at: user creation date
    - reviewed_by: system admin if available
*/

DO $$
DECLARE
  v_admin_id UUID;
  v_creator_count INT;
BEGIN
  -- Find a system admin user to mark as reviewer
  SELECT id INTO v_admin_id FROM users WHERE role = 'admin' LIMIT 1;
  
  IF v_admin_id IS NULL THEN
    RAISE WARNING 'No admin user found for backfill reviewer assignment';
  END IF;

  -- Count existing creators to confirm they exist
  SELECT COUNT(*) INTO v_creator_count FROM users WHERE role = 'creator';
  RAISE NOTICE 'Found % existing creators to backfill', v_creator_count;

  -- Insert all existing creators into creator_requests table
  INSERT INTO creator_requests (
    user_id,
    artist_name,
    real_name,
    email,
    phone,
    country,
    genre,
    bio,
    social_links,
    id_document_url,
    cover_art_url,
    status,
    rejection_reason,
    submitted_at,
    reviewed_at,
    reviewed_by
  )
  SELECT
    u.id,
    COALESCE(a.name, u.display_name, u.email),
    COALESCE(u.display_name, u.email),
    u.email,
    NULL,
    COALESCE(u.country, 'Unknown'),
    'General',
    COALESCE(u.bio, a.bio),
    '{}'::jsonb,
    NULL,
    a.image_url,
    'approved',
    NULL,
    u.created_at,
    u.created_at,
    v_admin_id
  FROM users u
  LEFT JOIN artist_profiles ap ON ap.user_id = u.id
  LEFT JOIN artists a ON a.id = ap.artist_id
  WHERE u.role = 'creator'
  AND NOT EXISTS (
    SELECT 1 FROM creator_requests cr WHERE cr.user_id = u.id
  )
  ON CONFLICT (user_id) DO NOTHING;

  RAISE NOTICE 'Successfully backfilled creator_requests for existing creators';

  -- Update artists to mark verified status for approved creators
  UPDATE artists
  SET verified = true
  WHERE id IN (
    SELECT DISTINCT ap.artist_id
    FROM creator_requests cr
    JOIN artist_profiles ap ON ap.user_id = cr.user_id
    WHERE cr.status = 'approved' AND ap.artist_id IS NOT NULL
  );

  RAISE NOTICE 'Updated artist verified status for approved creators';

END $$;
