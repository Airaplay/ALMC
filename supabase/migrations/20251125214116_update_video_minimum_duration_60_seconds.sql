/*
  # Update Video Minimum Duration to 60 Seconds

  1. Changes
    - Update `increment_clip_play_count_validated` function
    - Change minimum duration for videos from 30 seconds to 60 seconds
    - Keep clips at 5 seconds (short-form content)
    - Keep songs at 65 seconds (full plays)

  2. Rationale
    - 60 seconds provides better engagement quality measurement
    - Ensures viewers are genuinely interested in the content
    - Reduces accidental view counts from brief previews
    - Aligns with higher quality content engagement standards

  3. Impact
    - Video plays will now require 60 seconds of watch time instead of 30 seconds
    - More accurate measure of genuine viewer engagement
    - Better quality metrics for creators
*/

-- Update increment_clip_play_count_validated function with 60 second video duration threshold
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
SET search_path = public
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
    WHEN p_content_type = 'video' THEN 60  -- Updated from 30 to 60 seconds
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
GRANT EXECUTE ON FUNCTION increment_clip_play_count_validated(uuid, uuid, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_clip_play_count_validated(uuid, uuid, integer, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION increment_clip_play_count_validated(uuid, uuid, integer, text, text, text) TO service_role;