/*
  # Fix promotion active email trigger - use content_uploads instead of videos

  The trigger_send_promotion_active_email function was selecting from a non-existent
  "videos" table. In this schema, videos and short_clips are stored in content_uploads.
  This migration updates the function to use content_uploads for video and short_clip types.
*/

CREATE OR REPLACE FUNCTION trigger_send_promotion_active_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_email TEXT;
  v_user_name TEXT;
  v_content_title TEXT;
  v_duration INTEGER;
BEGIN
  -- Only send email when status changes to active
  IF NEW.status = 'active' AND (OLD.status IS NULL OR OLD.status != 'active') THEN
    -- Get user details
    SELECT email, COALESCE(display_name, email)
    INTO v_user_email, v_user_name
    FROM users WHERE id = NEW.user_id;

    -- Get content title based on promotion_type
    IF NEW.promotion_type = 'song' AND NEW.target_id IS NOT NULL THEN
      SELECT COALESCE(title, 'Your song')
      INTO v_content_title
      FROM songs WHERE id = NEW.target_id;
    ELSIF NEW.promotion_type IN ('video', 'short_clip') AND NEW.target_id IS NOT NULL THEN
      -- Videos and short_clips are in content_uploads, not a "videos" table
      SELECT COALESCE(title, 'Your video')
      INTO v_content_title
      FROM content_uploads WHERE id = NEW.target_id;
    ELSIF NEW.promotion_type = 'album' AND NEW.target_id IS NOT NULL THEN
      SELECT COALESCE(title, 'Your album')
      INTO v_content_title
      FROM albums WHERE id = NEW.target_id;
    ELSIF NEW.promotion_type = 'profile' THEN
      SELECT COALESCE(stage_name, 'Your profile')
      INTO v_content_title
      FROM artist_profiles WHERE artist_id IN (
        SELECT id FROM artists WHERE user_id = NEW.user_id LIMIT 1
      ) LIMIT 1;
    ELSE
      v_content_title := COALESCE(NEW.target_title, 'Your content');
    END IF;

    -- Fallback if no title found
    IF v_content_title IS NULL THEN
      v_content_title := COALESCE(NEW.target_title, 'Your content');
    END IF;

    -- Calculate duration
    v_duration := EXTRACT(DAY FROM (NEW.end_date - NEW.start_date));

    -- Queue promotion active email
    PERFORM queue_email(
      'promotion_active',
      v_user_email,
      NEW.user_id,
      jsonb_build_object(
        'user_name', v_user_name,
        'content_title', v_content_title,
        'promotion_type', NEW.promotion_type,
        'duration', v_duration::text,
        'treats_cost', NEW.treats_cost::text
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trigger_send_promotion_active_email() IS 'Sends email when promotion becomes active. Uses songs, content_uploads (video/short_clip), albums, artist_profiles; no videos table.';
