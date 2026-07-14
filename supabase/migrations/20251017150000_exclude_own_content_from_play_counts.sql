/*
  # Exclude Own Content from Play Counts

  1. Changes
    - Modify `increment_play_count_validated()` to check content ownership
    - Modify `increment_clip_play_count_validated()` to check content ownership
    - Users can still play their own content in Library, but it won't count towards play_count or video views
    - Listening history is still recorded for personal tracking

  2. Behavior
    - Songs: Check if song's artist_id matches user's artist profile artist_id
    - Videos/Clips: Check if content_uploads user_id matches current user
    - If user owns the content, listening history is recorded but play_count is NOT incremented
    - Returns success with 'own_content' flag to indicate it was played but not counted

  3. Security
    - No changes to RLS policies
    - Functions remain SECURITY DEFINER for proper access
*/

-- Enhanced increment play count with ownership validation for songs
CREATE OR REPLACE FUNCTION increment_play_count_validated(
  p_song_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_duration integer DEFAULT 0,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_validation_result jsonb;
  v_is_valid boolean;
  v_is_own_content boolean := false;
  v_user_artist_id uuid;
  v_song_artist_id uuid;
BEGIN
  -- Validate minimum duration (65 seconds for songs)
  IF p_duration < 65 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'Duration less than required minimum (65 seconds)',
      'duration', p_duration
    );
  END IF;

  -- Check if user is playing their own content
  IF p_user_id IS NOT NULL THEN
    -- Get user's artist_id from their artist profile
    SELECT artist_id INTO v_user_artist_id
    FROM artist_profiles
    WHERE user_id = p_user_id;

    -- Get the song's artist_id
    SELECT artist_id INTO v_song_artist_id
    FROM songs
    WHERE id = p_song_id;

    -- Check if user owns this content
    IF v_user_artist_id IS NOT NULL AND v_song_artist_id IS NOT NULL AND v_user_artist_id = v_song_artist_id THEN
      v_is_own_content := true;
    END IF;
  END IF;

  -- If user is playing their own content, don't count it
  IF v_is_own_content THEN
    RETURN jsonb_build_object(
      'success', true,
      'own_content', true,
      'reason', 'Own content - play not counted towards statistics',
      'validation', jsonb_build_object('is_valid', true, 'own_content', true)
    );
  END IF;

  -- Run fraud detection if user is authenticated
  IF p_user_id IS NOT NULL THEN
    v_validation_result := detect_fraud_patterns(
      p_user_id,
      p_song_id,
      'song',
      p_duration,
      p_ip_address,
      p_user_agent
    );

    v_is_valid := (v_validation_result->>'is_valid')::boolean;

    -- Update play statistics
    PERFORM update_user_play_statistics(p_user_id, p_song_id, 'song');

    -- Only increment if valid
    IF v_is_valid THEN
      UPDATE songs
      SET play_count = COALESCE(play_count, 0) + 1
      WHERE id = p_song_id;

      RETURN jsonb_build_object(
        'success', true,
        'validation', v_validation_result
      );
    ELSE
      -- Don't increment but log the attempt
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'Play flagged as suspicious',
        'validation', v_validation_result
      );
    END IF;
  ELSE
    -- Anonymous user - apply basic validation only
    UPDATE songs
    SET play_count = COALESCE(play_count, 0) + 1
    WHERE id = p_song_id;

    RETURN jsonb_build_object(
      'success', true,
      'validation', jsonb_build_object('is_valid', true, 'anonymous', true)
    );
  END IF;
END;
$$;

-- Enhanced increment clip/video play count with ownership validation
CREATE OR REPLACE FUNCTION increment_clip_play_count_validated(
  p_content_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_duration integer DEFAULT 0,
  p_content_type text DEFAULT 'clip',
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_validation_result jsonb;
  v_is_valid boolean;
  v_min_duration integer;
  v_is_own_content boolean := false;
  v_content_owner_id uuid;
BEGIN
  -- Determine minimum duration based on content type
  v_min_duration := CASE
    WHEN p_content_type = 'clip' THEN 5
    WHEN p_content_type = 'video' THEN 30
    ELSE 10
  END;

  -- Validate minimum duration
  IF p_duration < v_min_duration THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', format('Duration less than required minimum (%s seconds)', v_min_duration),
      'duration', p_duration
    );
  END IF;

  -- Check if user is playing their own content
  IF p_user_id IS NOT NULL THEN
    -- Get content owner from content_uploads
    SELECT user_id INTO v_content_owner_id
    FROM content_uploads
    WHERE id = p_content_id;

    -- Check if user owns this content
    IF v_content_owner_id IS NOT NULL AND v_content_owner_id = p_user_id THEN
      v_is_own_content := true;
    END IF;
  END IF;

  -- If user is playing their own content, don't count it
  IF v_is_own_content THEN
    RETURN jsonb_build_object(
      'success', true,
      'own_content', true,
      'reason', 'Own content - play not counted towards statistics',
      'validation', jsonb_build_object('is_valid', true, 'own_content', true)
    );
  END IF;

  -- Run fraud detection if user is authenticated
  IF p_user_id IS NOT NULL THEN
    v_validation_result := detect_fraud_patterns(
      p_user_id,
      p_content_id,
      p_content_type,
      p_duration,
      p_ip_address,
      p_user_agent
    );

    v_is_valid := (v_validation_result->>'is_valid')::boolean;

    -- Update play statistics
    PERFORM update_user_play_statistics(p_user_id, p_content_id, p_content_type);

    -- Only increment if valid
    IF v_is_valid THEN
      UPDATE content_uploads
      SET play_count = COALESCE(play_count, 0) + 1
      WHERE id = p_content_id;

      RETURN jsonb_build_object(
        'success', true,
        'validation', v_validation_result
      );
    ELSE
      -- Don't increment but log the attempt
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'Play flagged as suspicious',
        'validation', v_validation_result
      );
    END IF;
  ELSE
    -- Anonymous user - apply basic validation only
    UPDATE content_uploads
    SET play_count = COALESCE(play_count, 0) + 1
    WHERE id = p_content_id;

    RETURN jsonb_build_object(
      'success', true,
      'validation', jsonb_build_object('is_valid', true, 'anonymous', true)
    );
  END IF;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION increment_play_count_validated(uuid, uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_play_count_validated(uuid, uuid, integer, text, text) TO anon;
GRANT EXECUTE ON FUNCTION increment_play_count_validated(uuid, uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION increment_clip_play_count_validated(uuid, uuid, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_clip_play_count_validated(uuid, uuid, integer, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION increment_clip_play_count_validated(uuid, uuid, integer, text, text, text) TO service_role;
