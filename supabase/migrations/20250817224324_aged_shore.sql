/*
  # Fix Artist Profile Triggers to Resolve RLS Policy Issues

  This migration addresses the "new row violates row-level security policy for table albums" error
  by ensuring that the artist_id in artist_profiles is populated BEFORE the row is committed.

  ## Changes Made

  1. **Recreate create_artist_from_profile function**
     - Changed to BEFORE INSERT trigger function
     - Creates artist record and sets artist_id in NEW record before insert
     - Uses SECURITY DEFINER for proper permissions

  2. **Recreate trigger_create_artist_from_profile trigger**
     - Changed to BEFORE INSERT trigger
     - Ensures artist_id is set before RLS policies are evaluated

  3. **Recreate sync_artist_from_profile function and trigger**
     - Maintains artist data synchronization on updates
     - Keeps artist names in sync between tables

  ## Security
  - Functions use SECURITY DEFINER for proper permissions
   - Triggers maintain data integrity and synchronization
*/

-- Drop existing triggers and functions
DROP TRIGGER IF EXISTS trigger_create_artist_from_profile ON public.artist_profiles;
DROP TRIGGER IF EXISTS trigger_sync_artist_from_profile ON public.artist_profiles;
DROP FUNCTION IF EXISTS public.create_artist_from_profile();
DROP FUNCTION IF EXISTS public.sync_artist_from_profile();

-- Create the artist creation function as BEFORE INSERT trigger
CREATE OR REPLACE FUNCTION public.create_artist_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert into artists table and get the new artist_id
  INSERT INTO public.artists (name, bio, image_url, verified)
  VALUES (
    NEW.stage_name,
    NEW.bio,
    NEW.profile_photo_url,
    NEW.is_verified
  )
  RETURNING id INTO NEW.artist_id;
  
  -- Return the modified NEW record with artist_id populated
  RETURN NEW;
END;
$$;

-- Create the artist sync function for updates
CREATE OR REPLACE FUNCTION public.sync_artist_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only sync if artist_id exists
  IF NEW.artist_id IS NOT NULL THEN
    UPDATE public.artists
    SET 
      name = NEW.stage_name,
      bio = NEW.bio,
      image_url = NEW.profile_photo_url,
      verified = NEW.is_verified,
      updated_at = NOW()
    WHERE id = NEW.artist_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create BEFORE INSERT trigger to populate artist_id
CREATE TRIGGER trigger_create_artist_from_profile
  BEFORE INSERT ON public.artist_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_artist_from_profile();

-- Create AFTER UPDATE trigger to sync artist data
CREATE TRIGGER trigger_sync_artist_from_profile
  AFTER UPDATE ON public.artist_profiles
  FOR EACH ROW
  WHEN (
    OLD.stage_name IS DISTINCT FROM NEW.stage_name OR
    OLD.bio IS DISTINCT FROM NEW.bio OR
    OLD.profile_photo_url IS DISTINCT FROM NEW.profile_photo_url OR
    OLD.is_verified IS DISTINCT FROM NEW.is_verified
  )
  EXECUTE FUNCTION public.sync_artist_from_profile();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.create_artist_from_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_artist_from_profile() TO authenticated;

-- Ensure RLS policies on albums table are correct
DROP POLICY IF EXISTS "Users can create albums for their artist profile" ON public.albums;

CREATE POLICY "Users can create albums for their artist profile"
  ON public.albums
  FOR INSERT
  TO authenticated
  WITH CHECK (
    artist_id IN (
      SELECT ap.artist_id
      FROM public.artist_profiles ap
      WHERE ap.user_id = auth.uid()
        AND ap.artist_id IS NOT NULL
    )
  );

-- Ensure other album policies exist
DO $$
BEGIN
  -- Check if SELECT policy exists, create if not
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'albums' 
    AND policyname = 'Anyone can read albums'
  ) THEN
    CREATE POLICY "Anyone can read albums"
      ON public.albums
      FOR SELECT
      TO public
      USING (true);
  END IF;

  -- Check if UPDATE policy exists, create if not
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'albums' 
    AND policyname = 'Users can update their own albums'
  ) THEN
    CREATE POLICY "Users can update their own albums"
      ON public.albums
      FOR UPDATE
      TO authenticated
      USING (
        artist_id IN (
          SELECT ap.artist_id
          FROM public.artist_profiles ap
          WHERE ap.user_id = auth.uid()
            AND ap.artist_id IS NOT NULL
        )
      )
      WITH CHECK (
        artist_id IN (
          SELECT ap.artist_id
          FROM public.artist_profiles ap
          WHERE ap.user_id = auth.uid()
            AND ap.artist_id IS NOT NULL
        )
      );
  END IF;

  -- Check if DELETE policy exists, create if not
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'albums' 
    AND policyname = 'Users can delete their own albums'
  ) THEN
    CREATE POLICY "Users can delete their own albums"
      ON public.albums
      FOR DELETE
      TO authenticated
      USING (
        artist_id IN (
          SELECT ap.artist_id
          FROM public.artist_profiles ap
          WHERE ap.user_id = auth.uid()
            AND ap.artist_id IS NOT NULL
        )
      );
  END IF;
END $$;