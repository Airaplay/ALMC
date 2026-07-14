/*
  # Return play_count from increment RPCs to eliminate extra select

  ## Overview
  Modify increment_play_count_validated and increment_clip_play_count_validated
  to return the new play_count in their response, eliminating the need for
  an extra SELECT after each playback.

  ## Impact
  - Reduces PostgREST egress by 1 request per qualified play
  - For 1000 plays/day: saves ~1000 requests/day
*/

-- Update increment_play_count_validated to return new play_count
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
  v_new_play_count integer;
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
    -- Get current play_count without incrementing
    SELECT play_count INTO v_new_play_count
    FROM songs
    WHERE id = p_song_id;
    
    RETURN jsonb_build_object(
      'success', true,
      'own_content', true,
      'play_count', COALESCE(v_new_play_count, 0),
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
      WHERE id = p_song_id
      RETURNING play_count INTO v_new_play_count;

      RETURN jsonb_build_object(
        'success', true,
        'play_count', v_new_play_count,
        'validation', v_validation_result
      );
    ELSE
      -- Don't increment but return current count
      SELECT play_count INTO v_new_play_count
      FROM songs
      WHERE id = p_song_id;
      
      RETURN jsonb_build_object(
        'success', false,
        'play_count', COALESCE(v_new_play_count, 0),
        'reason', 'Play flagged as suspicious',
        'validation', v_validation_result
      );
    END IF;
  ELSE
    -- Anonymous user - apply basic validation only
    UPDATE songs
    SET play_count = COALESCE(play_count, 0) + 1
    WHERE id = p_song_id
    RETURNING play_count INTO v_new_play_count;

    RETURN jsonb_build_object(
      'success', true,
      'play_count', v_new_play_count,
      'validation', jsonb_build_object('is_valid', true, 'anonymous', true)
    );
  END IF;
END;
$$;

-- Update increment_clip_play_count_validated to return new play_count
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
  v_is_own_content boolean := false;
  v_content_user_id uuid;
  v_new_play_count integer;
  v_min_duration integer;
BEGIN
  -- Set minimum duration based on content type
  v_min_duration := CASE 
    WHEN p_content_type = 'clip' THEN 5
    WHEN p_content_type = 'video' THEN 30
    ELSE 30
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
    -- Get the content owner's user_id
    SELECT user_id INTO v_content_user_id
    FROM content_uploads
    WHERE id = p_content_id;

    -- Check if user owns this content
    IF v_content_user_id IS NOT NULL AND v_content_user_id = p_user_id THEN
      v_is_own_content := true;
    END IF;
  END IF;

  -- If user is playing their own content, don't count it
  IF v_is_own_content THEN
    -- Get current play_count without incrementing
    SELECT play_count INTO v_new_play_count
    FROM content_uploads
    WHERE id = p_content_id;
    
    RETURN jsonb_build_object(
      'success', true,
      'own_content', true,
      'play_count', COALESCE(v_new_play_count, 0),
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
      WHERE id = p_content_id
      RETURNING play_count INTO v_new_play_count;

      RETURN jsonb_build_object(
        'success', true,
        'play_count', v_new_play_count,
        'validation', v_validation_result
      );
    ELSE
      -- Don't increment but return current count
      SELECT play_count INTO v_new_play_count
      FROM content_uploads
      WHERE id = p_content_id;
      
      RETURN jsonb_build_object(
        'success', false,
        'play_count', COALESCE(v_new_play_count, 0),
        'reason', 'Play flagged as suspicious',
        'validation', v_validation_result
      );
    END IF;
  ELSE
    -- Anonymous user - apply basic validation only
    UPDATE content_uploads
    SET play_count = COALESCE(play_count, 0) + 1
    WHERE id = p_content_id
    RETURNING play_count INTO v_new_play_count;

    RETURN jsonb_build_object(
      'success', true,
      'play_count', v_new_play_count,
      'validation', jsonb_build_object('is_valid', true, 'anonymous', true)
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION increment_play_count_validated IS 
  'Validates and increments song play count. Returns new play_count in response to eliminate extra SELECT.';

COMMENT ON FUNCTION increment_clip_play_count_validated IS 
  'Validates and increments video/clip play count. Returns new play_count in response to eliminate extra SELECT.';
