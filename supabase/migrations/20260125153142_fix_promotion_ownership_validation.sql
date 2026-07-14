/*
  # Fix Promotion Content Ownership Validation

  ## Issue
  The ownership validation trigger was incorrectly checking `artist_id = user_id` directly,
  but the data model uses: user -> artist_profiles -> artists -> songs/albums/videos

  ## Fix
  Update the validation logic to properly check ownership through artist_profiles:
  - Songs: Check if song's artist_id matches user's artist_profiles.artist_id
  - Albums: Check if album's artist_id matches user's artist_profiles.artist_id
  - Videos: Check if video's artist_id matches user's artist_profiles.artist_id

  ## Changes
  - Replace the validation function with correct ownership checks
  - Properly join through artist_profiles to verify ownership
*/

-- Drop the existing trigger and function
DROP TRIGGER IF EXISTS validate_content_ownership_trigger ON public.promotions;
DROP FUNCTION IF EXISTS public.validate_content_ownership();

-- Create updated function with correct ownership validation
CREATE OR REPLACE FUNCTION public.validate_content_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner boolean := false;
  v_user_artist_id uuid;
BEGIN
  -- Get the user's artist_id from artist_profiles
  SELECT artist_id INTO v_user_artist_id
  FROM artist_profiles
  WHERE user_id = NEW.user_id
  LIMIT 1;

  -- If user doesn't have an artist profile, they can't promote content
  IF v_user_artist_id IS NULL THEN
    RAISE EXCEPTION 'You must be a creator to promote content. Please complete your artist profile first.';
  END IF;

  -- Profile promotions must be self-promotion
  IF NEW.promotion_type = 'profile' THEN
    IF NEW.target_id::text = NEW.user_id::text THEN
      v_is_owner := true;
    ELSE
      RAISE EXCEPTION 'Profile promotions must be for your own profile';
    END IF;

  -- Check ownership for songs
  ELSIF NEW.promotion_type = 'song' THEN
    SELECT EXISTS (
      SELECT 1 FROM songs
      WHERE id = NEW.target_id
      AND artist_id = v_user_artist_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote songs that you created';
    END IF;

  -- Check ownership for videos
  ELSIF NEW.promotion_type = 'video' THEN
    SELECT EXISTS (
      SELECT 1 FROM videos
      WHERE id = NEW.target_id
      AND artist_id = v_user_artist_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote videos that you created';
    END IF;

  -- Check ownership for albums
  ELSIF NEW.promotion_type = 'album' THEN
    SELECT EXISTS (
      SELECT 1 FROM albums
      WHERE id = NEW.target_id
      AND artist_id = v_user_artist_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote albums that you created';
    END IF;

  -- Check ownership for playlists
  ELSIF NEW.promotion_type = 'playlist' THEN
    SELECT EXISTS (
      SELECT 1 FROM playlists
      WHERE id = NEW.target_id
      AND user_id = NEW.user_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote playlists that you created';
    END IF;

  -- Check ownership for short clips (if applicable)
  ELSIF NEW.promotion_type = 'short_clip' THEN
    SELECT EXISTS (
      SELECT 1 FROM videos
      WHERE id = NEW.target_id
      AND artist_id = v_user_artist_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote short clips that you created';
    END IF;

  ELSE
    RAISE EXCEPTION 'Unknown promotion type';
  END IF;

  -- Verify ownership
  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'You do not own the content being promoted';
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on promotions table (BEFORE INSERT)
CREATE TRIGGER validate_content_ownership_trigger
BEFORE INSERT ON public.promotions
FOR EACH ROW
EXECUTE FUNCTION public.validate_content_ownership();

-- Add helpful comments
COMMENT ON FUNCTION public.validate_content_ownership() IS
'CRITICAL SECURITY: Validates that users can only promote content they own. Properly checks ownership through artist_profiles.';

COMMENT ON TRIGGER validate_content_ownership_trigger ON public.promotions IS
'CRITICAL SECURITY: Ownership validation to prevent unauthorized content promotion';

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.validate_content_ownership() TO authenticated;
