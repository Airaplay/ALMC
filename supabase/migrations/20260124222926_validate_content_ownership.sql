/*
  # Content Ownership Validation (CRITICAL SECURITY FIX)

  ## Security Issues Fixed
  1. **Ownership Bypass** - Prevents users from promoting content they don't own
  2. **Authorization Check** - Validates user owns the target content
  3. **Cross-Promotion Prevention** - Stops malicious promotion of competitors' content

  ## Changes
  - New trigger function: `validate_content_ownership()`
  - Checks ownership for songs, videos, albums, playlists
  - Validates profile promotions are self-promotion
  - Rejects if user doesn't own the content

  ## Security Level
  CRITICAL - Prevents unauthorized promotion of others' content
*/

-- Function to validate content ownership
CREATE OR REPLACE FUNCTION public.validate_content_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner boolean := false;
BEGIN
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
      AND artist_id = NEW.user_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote songs that you created';
    END IF;

  -- Check ownership for videos
  ELSIF NEW.promotion_type = 'video' THEN
    SELECT EXISTS (
      SELECT 1 FROM videos
      WHERE id = NEW.target_id
      AND artist_id = NEW.user_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote videos that you created';
    END IF;

  -- Check ownership for albums
  ELSIF NEW.promotion_type = 'album' THEN
    SELECT EXISTS (
      SELECT 1 FROM albums
      WHERE id = NEW.target_id
      AND artist_id = NEW.user_id
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
      AND artist_id = NEW.user_id
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'You can only promote short clips that you created';
    END IF;

  ELSE
    RAISE EXCEPTION 'Unknown promotion type';
  END IF;

  -- Verify target content exists
  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'You do not own the content being promoted';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS validate_content_ownership_trigger ON public.promotions;

-- Create trigger on promotions table (BEFORE INSERT)
CREATE TRIGGER validate_content_ownership_trigger
BEFORE INSERT ON public.promotions
FOR EACH ROW
EXECUTE FUNCTION public.validate_content_ownership();

-- Add helpful comments
COMMENT ON FUNCTION public.validate_content_ownership() IS
'CRITICAL SECURITY: Validates that users can only promote content they own. Prevents cross-promotion attacks.';

COMMENT ON TRIGGER validate_content_ownership_trigger ON public.promotions IS
'CRITICAL SECURITY: Ownership validation to prevent unauthorized content promotion';

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.validate_content_ownership() TO authenticated;