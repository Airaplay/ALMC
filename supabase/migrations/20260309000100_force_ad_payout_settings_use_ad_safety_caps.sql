/*
  # Force Ad Payout Settings to Use ad_safety_caps

  Problem:
  - `get_user_ad_payout_settings()` can return legacy `payout_settings` global percentages (e.g. 45/15/40),
    which risks incorrect creator revenue sharing.

  Fix:
  - Keep user-specific and country-specific overrides (if present).
  - For the "default/global" case, ALWAYS return percentages from the active `ad_safety_caps` row.
  - Keep payout_threshold behavior (use payout_settings.global if present, else 10.0).
*/

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
  v_threshold numeric := 10.0;
  applicable_settings jsonb;
BEGIN
  -- Get user's country (best-effort)
  SELECT country INTO user_country
  FROM users
  WHERE id = user_uuid;

  -- 1) User-specific payout_settings (highest priority)
  SELECT * INTO user_settings
  FROM payout_settings
  WHERE setting_type = 'user' AND user_id = user_uuid;

  IF FOUND THEN
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

  -- 2) Country-specific payout_settings
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

  -- Threshold: use payout_settings.global if present (percentages are ignored for ads)
  SELECT * INTO global_settings
  FROM payout_settings
  WHERE setting_type = 'global';

  IF FOUND AND global_settings.payout_threshold IS NOT NULL THEN
    v_threshold := global_settings.payout_threshold;
  END IF;

  -- 3) Default/global AD split MUST come from ad_safety_caps (source of truth)
  SELECT * INTO safety_caps_settings
  FROM ad_safety_caps
  WHERE is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_safety_caps active row not found; cannot determine ad revenue split';
  END IF;

  applicable_settings := jsonb_build_object(
    'setting_type', 'safety_caps',
    'payout_threshold', v_threshold,
    'artist_percentage', safety_caps_settings.artist_revenue_percentage,
    'listener_percentage', safety_caps_settings.listener_revenue_percentage,
    'platform_percentage', safety_caps_settings.platform_revenue_percentage,
    'uses_ad_specific', true
  );
  RETURN applicable_settings;
END;
$$;

COMMENT ON FUNCTION public.get_user_ad_payout_settings(uuid) IS
  'Returns ad payout settings for a user. Priority: user-specific > country-specific > ad_safety_caps (source of truth). Global payout_settings percentages are ignored for ad revenue splits; payout_threshold may still be read from payout_settings.global.';

