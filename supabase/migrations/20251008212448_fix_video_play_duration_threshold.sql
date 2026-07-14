/*
  # Fix Video Play Duration Threshold

  1. Issue
    - The `increment_clip_play_count_validated` function requires 65 seconds for videos
    - The frontend playbackTracker.ts uses 30 seconds for videos
    - This mismatch causes valid video plays to be rejected
    - Users cannot accumulate listening history entries, preventing referral activation

  2. Solution
    - Update the minimum duration for videos from 65 seconds to 30 seconds
    - Keep clips at 5 seconds (short-form content)
    - Keep songs at 65 seconds (full plays)

  3. Impact
    - Video plays will now be counted after 30 seconds instead of 65 seconds
    - This aligns with industry standards for video engagement
    - Referral system will work properly as users can now accumulate activity
*/

-- Update increment_clip_play_count_validated function with correct video duration threshold
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
  v_min_duration := CASE 
    WHEN p_content_type = 'clip' THEN 5
    WHEN p_content_type = 'video' THEN 30  -- Changed from 65 to 30 seconds
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
