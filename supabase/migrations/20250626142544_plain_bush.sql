/*
  # Update artist registration flow

  1. Functions
    - Create helper function to automatically create artist record when artist profile is created
    - Ensures proper linking between artist_profiles and artists tables
    - Maintains data consistency

  2. Security
    - Function runs with security definer to ensure proper permissions
    - Only authenticated users can trigger artist creation
    - Maintains existing RLS policies
*/

-- Create function to handle artist creation when artist profile is created
CREATE OR REPLACE FUNCTION create_artist_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_artist_id uuid;
BEGIN
  -- Create corresponding artist record
  INSERT INTO artists (
    name,
    bio,
    image_url,
    verified,
    created_at,
    updated_at
  ) VALUES (
    NEW.stage_name,
    NEW.bio,
    NEW.profile_photo_url,
    NEW.is_verified,
    NEW.created_at,
    NEW.updated_at
  ) RETURNING id INTO new_artist_id;

  -- Update the artist_profile with the artist_id
  UPDATE artist_profiles 
  SET artist_id = new_artist_id 
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- Create trigger to automatically create artist when artist profile is created
DROP TRIGGER IF EXISTS trigger_create_artist_from_profile ON artist_profiles;
CREATE TRIGGER trigger_create_artist_from_profile
  AFTER INSERT ON artist_profiles
  FOR EACH ROW
  EXECUTE FUNCTION create_artist_from_profile();

-- Create function to sync artist updates when artist profile is updated
CREATE OR REPLACE FUNCTION sync_artist_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update corresponding artist record if artist_id exists
  IF NEW.artist_id IS NOT NULL THEN
    UPDATE artists 
    SET 
      name = NEW.stage_name,
      bio = NEW.bio,
      image_url = NEW.profile_photo_url,
      verified = NEW.is_verified,
      updated_at = NEW.updated_at
    WHERE id = NEW.artist_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger to sync artist updates when artist profile is updated
DROP TRIGGER IF EXISTS trigger_sync_artist_from_profile ON artist_profiles;
CREATE TRIGGER trigger_sync_artist_from_profile
  AFTER UPDATE ON artist_profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_artist_from_profile();