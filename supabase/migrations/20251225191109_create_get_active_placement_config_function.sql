/*
  # Create get_active_placement_config function
  
  1. Changes
    - Create function to get active ad placement configuration
    - Returns placement, ad_unit, and network details in a structured format
  
  2. Security
    - Function is accessible to authenticated and anonymous users
    - Only returns enabled placements
*/

-- Create function to get active placement configuration
CREATE OR REPLACE FUNCTION get_active_placement_config(placement_key_param text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'placement', jsonb_build_object(
      'id', p.id,
      'placement_key', p.placement_key,
      'placement_name', p.placement_name,
      'screen_name', p.screen_name,
      'ad_type', p.ad_type,
      'position', p.position,
      'display_priority', p.display_priority,
      'conditions', p.conditions
    ),
    'ad_unit', CASE 
      WHEN au.id IS NOT NULL THEN jsonb_build_object(
        'id', au.id,
        'unit_id', au.unit_id,
        'unit_type', au.unit_type,
        'ecpm_floor', COALESCE(au.ecpm_floor, 0),
        'auto_cpm_bidding', COALESCE(au.auto_cpm_bidding, false)
      )
      ELSE NULL
    END,
    'network', CASE 
      WHEN an.id IS NOT NULL THEN jsonb_build_object(
        'id', an.id,
        'network', an.network,
        'app_id', an.app_id,
        'api_key', an.api_key
      )
      ELSE NULL
    END
  ) INTO result
  FROM ad_placements p
  LEFT JOIN ad_units au ON p.ad_unit_id = au.id
  LEFT JOIN ad_networks an ON au.network_id = an.id
  WHERE p.placement_key = placement_key_param
    AND p.is_enabled = true
  ORDER BY p.display_priority DESC
  LIMIT 1;

  RETURN result;
END;
$$;

-- Grant execute permission to authenticated and anonymous users
GRANT EXECUTE ON FUNCTION get_active_placement_config(text) TO authenticated, anon;