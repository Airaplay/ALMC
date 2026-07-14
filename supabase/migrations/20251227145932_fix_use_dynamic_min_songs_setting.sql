/*
  # Fix: Use Dynamic Minimum Songs Setting for Auto-Submission

  ## Problem
  The auto-submit triggers are hardcoded to check for 10 songs, but the admin
  can configure the minimum in Global Curator Settings (currently set to 6).

  ## Solution
  Update both trigger functions to read the min_songs value from curator_settings
  table instead of using a hardcoded value.

  ## Changes
  1. Update auto_submit_playlist_for_curation() to read from curator_settings
  2. Update update_playlist_song_count() to read from curator_settings
  3. Use dynamic min_songs value for eligibility check
*/

-- ============================================================================
-- Update the auto-submit trigger to use dynamic min_songs setting
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_submit_playlist_for_curation()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_role text;
  v_min_songs integer;
  v_global_enabled boolean;
BEGIN
  -- Only process if curation_status is currently 'none'
  IF NEW.curation_status != 'none' THEN
    RETURN NEW;
  END IF;

  -- Get global curator settings
  SELECT 
    (setting_value->>'min_songs')::integer,
    (setting_value->>'enabled')::boolean
  INTO v_min_songs, v_global_enabled
  FROM curator_settings
  WHERE setting_key = 'curator_eligibility'
  LIMIT 1;

  -- Default to 10 if setting not found
  v_min_songs := COALESCE(v_min_songs, 10);

  -- Check if global curator status is enabled
  IF v_global_enabled IS NULL THEN
    SELECT (setting_value->>'enabled')::boolean INTO v_global_enabled
    FROM curator_settings
    WHERE setting_key = 'curator_global_status'
    LIMIT 1;
  END IF;
  
  -- If curator system is disabled, don't auto-submit
  IF v_global_enabled = false THEN
    RETURN NEW;
  END IF;

  -- Get user's role
  SELECT role INTO v_user_role
  FROM users
  WHERE id = NEW.user_id;

  -- Check if playlist meets eligibility criteria (using dynamic min_songs)
  IF NEW.is_public = true
     AND NEW.song_count >= v_min_songs
     AND v_user_role = 'listener' THEN
    -- Auto-submit for curation
    NEW.curation_status := 'pending';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- Update the song count trigger to use dynamic min_songs setting
-- ============================================================================

CREATE OR REPLACE FUNCTION update_playlist_song_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_count integer;
  v_is_public boolean;
  v_user_role text;
  v_current_status text;
  v_min_songs integer;
  v_global_enabled boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Update song count
    UPDATE playlists
    SET song_count = song_count + 1,
        updated_at = now()
    WHERE id = NEW.playlist_id
    RETURNING song_count, is_public, curation_status INTO v_new_count, v_is_public, v_current_status;
    
    -- Get minimum songs requirement from settings
    SELECT (setting_value->>'min_songs')::integer
    INTO v_min_songs
    FROM curator_settings
    WHERE setting_key = 'curator_eligibility'
    LIMIT 1;
    
    -- Default to 10 if setting not found
    v_min_songs := COALESCE(v_min_songs, 10);

    -- Check if global curator system is enabled
    SELECT (setting_value->>'enabled')::boolean
    INTO v_global_enabled
    FROM curator_settings
    WHERE setting_key = 'curator_global_status'
    LIMIT 1;

    -- Only auto-submit if curator system is enabled
    IF v_global_enabled IS NOT NULL AND v_global_enabled = false THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Check if we should auto-submit after adding this song (using dynamic min_songs)
    IF v_new_count >= v_min_songs AND v_is_public = true AND v_current_status = 'none' THEN
      -- Get user role
      SELECT u.role INTO v_user_role
      FROM playlists p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = NEW.playlist_id;
      
      -- Auto-submit if user is a listener
      IF v_user_role = 'listener' THEN
        UPDATE playlists
        SET curation_status = 'pending',
            updated_at = now()
        WHERE id = NEW.playlist_id;
      END IF;
    END IF;
    
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE playlists
    SET song_count = GREATEST(0, song_count - 1),
        updated_at = now()
    WHERE id = OLD.playlist_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================================
-- Backfill: Re-check existing playlists with the current min_songs setting
-- ============================================================================

DO $$
DECLARE
  v_min_songs integer;
BEGIN
  -- Get current min_songs setting
  SELECT (setting_value->>'min_songs')::integer
  INTO v_min_songs
  FROM curator_settings
  WHERE setting_key = 'curator_eligibility'
  LIMIT 1;
  
  -- Default to 10 if not found
  v_min_songs := COALESCE(v_min_songs, 10);
  
  -- Update playlists that now meet the criteria
  UPDATE playlists p
  SET curation_status = 'pending',
      updated_at = now()
  FROM users u
  WHERE p.user_id = u.id
    AND p.is_public = true
    AND p.song_count >= v_min_songs
    AND u.role = 'listener'
    AND p.curation_status = 'none';
    
  RAISE NOTICE 'Auto-submitted playlists with min_songs: %', v_min_songs;
END $$;
