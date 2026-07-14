/*
  Public read of web AdSense placement config for anonymous visitors.
  Admin tables stay admin-only via RLS; this SECURITY DEFINER RPC exposes only
  enabled web_* placements wired to active AdSense units.
*/

CREATE OR REPLACE FUNCTION public.get_web_ad_display_config()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'placements',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'placement_key', p.placement_key,
            'placement_name', p.placement_name,
            'ad_type', p.ad_type,
            'screen_name', p.screen_name,
            'position', p.position,
            'display_priority', p.display_priority,
            'is_enabled', p.is_enabled,
            'ad_unit_id', p.ad_unit_id,
            'conditions', COALESCE(p.conditions, '{}'::jsonb)
          )
          ORDER BY p.display_priority DESC NULLS LAST, p.placement_key
        )
        FROM ad_placements p
        WHERE p.is_enabled = true
          AND p.placement_key LIKE 'web\_%' ESCAPE '\'
      ),
      '[]'::jsonb
    ),
    'units',
    COALESCE(
      (
        SELECT jsonb_agg(unit_row ORDER BY (unit_row ->> 'id'))
        FROM (
          SELECT DISTINCT ON (au.id)
            jsonb_build_object(
              'id', au.id,
              'unit_type', au.unit_type,
              'unit_id', au.unit_id,
              'placement', au.placement,
              'ecpm_floor', au.ecpm_floor,
              'is_active', au.is_active,
              'network_id', au.network_id,
              'ad_networks', jsonb_build_object(
                'network', an.network,
                'api_key', an.api_key,
                'is_active', an.is_active
              )
            ) AS unit_row
          FROM ad_placements p
          INNER JOIN ad_units au ON au.id = p.ad_unit_id AND au.is_active = true
          INNER JOIN ad_networks an ON an.id = au.network_id AND an.is_active = true
          WHERE p.is_enabled = true
            AND p.placement_key LIKE 'web\_%' ESCAPE '\'
            AND lower(an.network) = 'adsense'
          ORDER BY au.id
        ) units_sub
      ),
      '[]'::jsonb
    ),
    'display_rules',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object('rule_type', r.rule_type, 'rule_value', r.rule_value)
        )
        FROM ad_display_rules r
        WHERE r.is_enabled = true
      ),
      '[]'::jsonb
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_web_ad_display_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_web_ad_display_config() TO anon, authenticated;

COMMENT ON FUNCTION public.get_web_ad_display_config() IS
  'Returns enabled web_* ad placements, linked AdSense units, and display rules for the public website.';
