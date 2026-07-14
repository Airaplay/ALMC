/*
  # Update Video Play Duration Threshold

  ## Summary
  Reduces the minimum play duration threshold for videos from 65 seconds to 30 seconds
  to better reflect actual user engagement patterns.

  ## Changes
  - Updates `increment_clip_play_count_validated` function
    - Changes minimum duration for videos from 65 seconds to 30 seconds
    - Keeps clips at 5 seconds minimum (unchanged)
    - Keeps songs at 65 seconds minimum (unchanged in other function)

  ## Rationale
  Analysis of listening_history shows users frequently engage with video content
  for 20-60 seconds but rarely reach the 65-second threshold. This prevents
  legitimate plays from being counted. A 30-second threshold better balances
  fraud prevention with realistic user behavior.
*/

-- Update the increment_clip_play_count_validated function with new video threshold
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
BEGIN
  -- Determine minimum duration based on content type
  -- Updated: videos now require 30 seconds instead of 65
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
