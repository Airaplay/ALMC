/*
  # Fix Ad Revenue Split Function to Use ad_safety_caps

  This migration updates the `get_user_ad_payout_settings` function to use the `ad_safety_caps` table
  as the source of truth for ad revenue split percentages instead of hardcoded fallback values.

  ## Changes
  1. Update `get_user_ad_payout_settings` to query ad_safety_caps for default percentages
  2. Ensure the function always returns the correct 60/0/40 split from ad_safety_caps when no user/country overrides exist
  3. Remove hardcoded fallback values (50/10/40) and replace with live database values

  ## Security
  - Function maintains SECURITY DEFINER
  - search_path is properly set
  - No changes to access control
*/

-- Update the get_user_ad_payout_settings function to use ad_safety_caps
CREATE OR REPLACE FUNCTION public.get_user_ad_payout_settings(user_uuid uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  user_country text;
  user_settings record;
  country_settings record;
  global_settings record;
  safety_caps_settings record;
  applicable_settings jsonb;
BEGIN
  -- Get user's country
  SELECT country INTO user_country
  FROM users
  WHERE id = user_uuid;
  
  -- Try to get user-specific settings
  SELECT * INTO user_settings
  FROM payout_settings
  WHERE setting_type = 'user' AND user_id = user_uuid;
  
  IF FOUND THEN
    -- Use ad-specific percentages if set, otherwise fall back to regular percentages
    applicable_settings := jsonb_build_object(
      'setting_type', 'user',
      'payout_threshold', user_settings.payout_threshold,
      'artist_percentage', COALESCE(user_settings.ad_artist_percentage, user_settings.artist_percentage),
      'listener_percentage', COALESCE(user_settings.ad_listener_percentage, user_settings.listener_percentage),
      'platform_percentage', COALESCE(user_settings.ad_platform_percentage, user_settings.platform_percentage),
      'uses_ad_specific', (user_settings.ad_artist_percentage IS NOT NULL)
    );
    RETURN applicable_settings;
  END IF;
  
  -- Try to get country-specific settings
  IF user_country IS NOT NULL THEN
    SELECT * INTO country_settings
    FROM payout_settings
    WHERE setting_type = 'country' AND country_code = user_country;
    
    IF FOUND THEN
      applicable_settings := jsonb_build_object(
        'setting_type', 'country',
        'country_code', user_country,
        'payout_threshold', country_settings.payout_threshold,
        'artist_percentage', COALESCE(country_settings.ad_artist_percentage, country_settings.artist_percentage),
        'listener_percentage', COALESCE(country_settings.ad_listener_percentage, country_settings.listener_percentage),
        'platform_percentage', COALESCE(country_settings.ad_platform_percentage, country_settings.platform_percentage),
        'uses_ad_specific', (country_settings.ad_artist_percentage IS NOT NULL)
      );
      RETURN applicable_settings;
    END IF;
  END IF;
  
  -- Fall back to global settings from payout_settings
  SELECT * INTO global_settings
  FROM payout_settings
  WHERE setting_type = 'global';
  
  IF FOUND THEN
    applicable_settings := jsonb_build_object(
      'setting_type', 'global',
      'payout_threshold', global_settings.payout_threshold,
      'artist_percentage', COALESCE(global_settings.ad_artist_percentage, global_settings.artist_percentage),
      'listener_percentage', COALESCE(global_settings.ad_listener_percentage, global_settings.listener_percentage),
      'platform_percentage', COALESCE(global_settings.ad_platform_percentage, global_settings.platform_percentage),
      'uses_ad_specific', (global_settings.ad_artist_percentage IS NOT NULL)
    );
    RETURN applicable_settings;
  END IF;
  
  -- UPDATED: Use ad_safety_caps as the ultimate fallback source of truth
  SELECT * INTO safety_caps_settings
  FROM ad_safety_caps
  WHERE is_active = true
  LIMIT 1;
  
  IF FOUND THEN
    applicable_settings := jsonb_build_object(
      'setting_type', 'safety_caps',
      'payout_threshold', 10.0, -- Default threshold
      'artist_percentage', safety_caps_settings.artist_revenue_percentage,
      'listener_percentage', safety_caps_settings.listener_revenue_percentage,
      'platform_percentage', safety_caps_settings.platform_revenue_percentage,
      'uses_ad_specific', true
    );
    RETURN applicable_settings;
  END IF;
  
  -- If even ad_safety_caps is not found (should never happen), return hardcoded 60/0/40
  RETURN jsonb_build_object(
    'setting_type', 'hardcoded_fallback',
    'payout_threshold', 10.0,
    'artist_percentage', 60.0,
    'listener_percentage', 0.0,
    'platform_percentage', 40.0,
    'uses_ad_specific', true
  );
END;
$$;

-- Add comment to document the change
COMMENT ON FUNCTION get_user_ad_payout_settings IS 
  'Returns ad payout settings for a user. Priority: user-specific > country-specific > global > ad_safety_caps (60/0/40) > hardcoded fallback. Updated to use ad_safety_caps as source of truth.';
