/*
  # Create Ad Management Tables

  1. New Tables
    - `ad_networks` - Store ad network configurations (AdMob, Monetag, etc.)
    - `ad_units` - Store ad unit IDs for different placements
    - `ad_display_rules` - Store rules for when to show/hide ads

  2. Security
    - Enable RLS on all tables
    - Only admins can manage ad configurations
    - Proper constraints and validation

  3. Default Data
    - Insert sample ad network configurations
    - Insert common ad unit types
    - Insert basic display rules
*/

-- Create ad_networks table
CREATE TABLE IF NOT EXISTS ad_networks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network text NOT NULL, -- 'admob', 'monetag', etc.
  api_key text NOT NULL,
  app_id text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE ad_networks ENABLE ROW LEVEL SECURITY;

-- Create ad_units table
CREATE TABLE IF NOT EXISTS ad_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id uuid NOT NULL REFERENCES ad_networks(id) ON DELETE CASCADE,
  unit_type text NOT NULL, -- 'banner', 'interstitial', 'rewarded', 'native'
  unit_id text NOT NULL,
  placement text NOT NULL, -- 'home_screen', 'between_songs', etc.
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE ad_units ENABLE ROW LEVEL SECURITY;

-- Create ad_display_rules table
CREATE TABLE IF NOT EXISTS ad_display_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type text NOT NULL, -- 'role', 'content_type', 'country'
  rule_value text NOT NULL, -- role name, content type, or country code
  is_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE ad_display_rules ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ad_networks_network ON ad_networks(network);
CREATE INDEX IF NOT EXISTS idx_ad_units_network_id ON ad_units(network_id);
CREATE INDEX IF NOT EXISTS idx_ad_units_unit_type ON ad_units(unit_type);
CREATE INDEX IF NOT EXISTS idx_ad_units_placement ON ad_units(placement);
CREATE INDEX IF NOT EXISTS idx_ad_display_rules_rule_type ON ad_display_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_ad_display_rules_rule_value ON ad_display_rules(rule_value);

-- RLS Policies for ad_networks table
-- Only admins can manage ad networks
CREATE POLICY "Admins can manage ad networks"
ON ad_networks
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

-- RLS Policies for ad_units table
-- Only admins can manage ad units
CREATE POLICY "Admins can manage ad units"
ON ad_units
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

-- RLS Policies for ad_display_rules table
-- Only admins can manage display rules
CREATE POLICY "Admins can manage ad display rules"
ON ad_display_rules
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

-- Function to check if ads should be shown to a user
CREATE OR REPLACE FUNCTION should_show_ads(
  user_uuid uuid DEFAULT auth.uid(),
  content_type_param text DEFAULT NULL,
  country_param text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_role text;
  should_show boolean := true;
BEGIN
  -- If no user is provided, default to showing ads
  IF user_uuid IS NULL THEN
    RETURN true;
  END IF;

  -- Get user role
  SELECT role INTO user_role
  FROM users
  WHERE id = user_uuid;
  
  IF NOT FOUND THEN
    RETURN true; -- Default to showing ads if user not found
  END IF;

  -- Check role-based rules
  IF EXISTS (
    SELECT 1 FROM ad_display_rules
    WHERE rule_type = 'role'
      AND rule_value = user_role
      AND is_enabled = false
  ) THEN
    RETURN false;
  END IF;

  -- Check content-type-based rules if content_type is provided
  IF content_type_param IS NOT NULL AND EXISTS (
    SELECT 1 FROM ad_display_rules
    WHERE rule_type = 'content_type'
      AND rule_value = content_type_param
      AND is_enabled = false
  ) THEN
    RETURN false;
  END IF;

  -- Check country-based rules if country is provided
  IF country_param IS NOT NULL AND EXISTS (
    SELECT 1 FROM ad_display_rules
    WHERE rule_type = 'country'
      AND rule_value = country_param
      AND is_enabled = false
  ) THEN
    RETURN false;
  END IF;

  -- If no rules prevent showing ads, return true
  RETURN true;
END;
$$;

-- Function to get ad configuration for client
CREATE OR REPLACE FUNCTION get_ad_config(
  user_uuid uuid DEFAULT auth.uid(),
  content_type_param text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_country text;
  should_show boolean;
  ad_config jsonb;
BEGIN
  -- Get user country if authenticated
  IF user_uuid IS NOT NULL THEN
    SELECT country INTO user_country
    FROM users
    WHERE id = user_uuid;
  END IF;

  -- Check if ads should be shown
  should_show := should_show_ads(user_uuid, content_type_param, user_country);
  
  IF NOT should_show THEN
    RETURN jsonb_build_object('show_ads', false);
  END IF;

  -- Build ad configuration
  SELECT jsonb_build_object(
    'show_ads', true,
    'networks', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', an.id,
          'network', an.network,
          'app_id', an.app_id,
          'units', (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', au.id,
                'type', au.unit_type,
                'unit_id', au.unit_id,
                'placement', au.placement
              )
            )
            FROM ad_units au
            WHERE au.network_id = an.id
              AND au.is_active = true
          )
        )
      )
      FROM ad_networks an
      WHERE an.is_active = true
    )
  ) INTO ad_config;

  RETURN ad_config;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION should_show_ads(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION should_show_ads(uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION get_ad_config(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ad_config(uuid, text) TO anon;

-- Insert sample data (only if tables are empty)
DO $$
BEGIN
  -- Insert sample ad networks if none exist
  IF NOT EXISTS (SELECT 1 FROM ad_networks LIMIT 1) THEN
    INSERT INTO ad_networks (network, api_key, app_id, is_active) VALUES
    ('admob', 'ca-app-pub-3940256099942544~3347511713', 'ca-app-pub-3940256099942544~3347511713', true),
    ('monetag', 'monetag-sample-api-key', 'monetag-sample-app-id', true);
  END IF;

  -- Insert sample ad units if none exist
  IF NOT EXISTS (SELECT 1 FROM ad_units LIMIT 1) THEN
    INSERT INTO ad_units (network_id, unit_type, unit_id, placement, is_active)
    SELECT 
      id, 
      'banner', 
      'ca-app-pub-3940256099942544/6300978111', 
      'home_screen', 
      true
    FROM ad_networks 
    WHERE network = 'admob' 
    LIMIT 1;
    
    INSERT INTO ad_units (network_id, unit_type, unit_id, placement, is_active)
    SELECT 
      id, 
      'interstitial', 
      'ca-app-pub-3940256099942544/1033173712', 
      'between_songs', 
      true
    FROM ad_networks 
    WHERE network = 'admob' 
    LIMIT 1;
    
    INSERT INTO ad_units (network_id, unit_type, unit_id, placement, is_active)
    SELECT 
      id, 
      'rewarded', 
      'ca-app-pub-3940256099942544/5224354917', 
      'after_video', 
      true
    FROM ad_networks 
    WHERE network = 'admob' 
    LIMIT 1;
  END IF;

  -- Insert sample display rules if none exist
  IF NOT EXISTS (SELECT 1 FROM ad_display_rules LIMIT 1) THEN
    INSERT INTO ad_display_rules (rule_type, rule_value, is_enabled) VALUES
    ('role', 'creator', true),
    ('role', 'listener', true),
    ('role', 'admin', false),
    ('content_type', 'song', true),
    ('content_type', 'video', true),
    ('content_type', 'short_clip', true);
  END IF;
END $$;