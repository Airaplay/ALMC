/*
  # Fix Promotion Impression Recording Function

  ## Overview
  Drops and recreates the impression recording function with proper return type.
  This ensures impressions and clicks are properly tracked in the database.

  ## Changes
    - Drops existing function if exists
    - Creates new function with json return type
    - Properly updates all three tables (promotions, promotion_rotation_state, promotion_performance_metrics)
    - Grants proper permissions
*/

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS record_promotion_impression(uuid, text, uuid, boolean, text);

-- Create the main impression recording function
CREATE OR REPLACE FUNCTION record_promotion_impression(
  p_promotion_id uuid,
  p_section_key text,
  p_user_id uuid DEFAULT NULL,
  p_clicked boolean DEFAULT false,
  p_session_id text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_result json;
  v_section_id uuid;
  v_promotion_status text;
  v_impressions_added integer := 0;
  v_clicks_added integer := 0;
BEGIN
  -- Validate promotion exists and is active
  SELECT status INTO v_promotion_status
  FROM promotions
  WHERE id = p_promotion_id;

  IF v_promotion_status IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Promotion not found'
    );
  END IF;

  IF v_promotion_status != 'active' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Promotion is not active'
    );
  END IF;

  -- Get section ID (optional validation)
  SELECT id INTO v_section_id
  FROM promotion_sections
  WHERE section_key = p_section_key AND is_active = true;

  -- Determine what to increment
  v_impressions_added := 1;
  IF p_clicked THEN
    v_clicks_added := 1;
  END IF;

  -- Update main promotions table
  UPDATE promotions
  SET
    impressions_actual = impressions_actual + v_impressions_added,
    clicks = clicks + v_clicks_added,
    updated_at = now()
  WHERE id = p_promotion_id;

  -- Update promotion_rotation_state for rotation algorithm
  INSERT INTO promotion_rotation_state (
    promotion_id,
    section_key,
    total_impressions,
    total_clicks,
    last_impression_at
  )
  VALUES (
    p_promotion_id,
    p_section_key,
    v_impressions_added,
    v_clicks_added,
    now()
  )
  ON CONFLICT (promotion_id, section_key) DO UPDATE SET
    total_impressions = promotion_rotation_state.total_impressions + v_impressions_added,
    total_clicks = promotion_rotation_state.total_clicks + v_clicks_added,
    last_impression_at = now(),
    updated_at = now();

  -- Update daily performance metrics
  INSERT INTO promotion_performance_metrics (
    promotion_id,
    section_key,
    date,
    impressions,
    clicks
  )
  VALUES (
    p_promotion_id,
    p_section_key,
    CURRENT_DATE,
    v_impressions_added,
    v_clicks_added
  )
  ON CONFLICT (promotion_id, section_key, date) DO UPDATE SET
    impressions = promotion_performance_metrics.impressions + v_impressions_added,
    clicks = promotion_performance_metrics.clicks + v_clicks_added,
    updated_at = now();

  -- Return success response
  v_result := json_build_object(
    'success', true,
    'promotion_id', p_promotion_id,
    'impressions_added', v_impressions_added,
    'clicks_added', v_clicks_added,
    'timestamp', now()
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated and anon users
GRANT EXECUTE ON FUNCTION record_promotion_impression TO authenticated;
GRANT EXECUTE ON FUNCTION record_promotion_impression TO anon;
GRANT EXECUTE ON FUNCTION record_promotion_impression TO service_role;