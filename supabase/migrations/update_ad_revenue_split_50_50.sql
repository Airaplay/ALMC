-- Migration: Update AdMob Revenue Split to 50/50
-- Date: 2026-03-14
-- Description: Updates ad revenue split to 50% creator / 50% platform (0% listener)
-- This is the minimum compliant split per AdMob policy (creators must get at least 50%)

-- Update the active ad_safety_caps configuration to 50/50 split
UPDATE ad_safety_caps
SET
  artist_revenue_percentage = 50.00,
  listener_revenue_percentage = 0.00,
  platform_revenue_percentage = 50.00,
  updated_at = NOW()
WHERE is_active = true;

-- Verify the update
DO $$
DECLARE
  v_artist_pct NUMERIC(5,2);
  v_platform_pct NUMERIC(5,2);
  v_listener_pct NUMERIC(5,2);
BEGIN
  SELECT 
    artist_revenue_percentage,
    platform_revenue_percentage,
    listener_revenue_percentage
  INTO v_artist_pct, v_platform_pct, v_listener_pct
  FROM ad_safety_caps
  WHERE is_active = true
  LIMIT 1;
  
  IF v_artist_pct != 50.00 OR v_platform_pct != 50.00 OR v_listener_pct != 0.00 THEN
    RAISE EXCEPTION 'Revenue split verification failed: Expected 50/50/0, got %/%/%', 
      v_artist_pct, v_platform_pct, v_listener_pct;
  END IF;
  
  RAISE NOTICE 'Revenue split successfully updated to 50%% creator / 50%% platform / 0%% listener';
END $$;

-- Update table comment to reflect current model
COMMENT ON TABLE ad_safety_caps IS 
'Ad safety and revenue split configuration. Current model: 50% creator / 50% platform / 0% listener (AdMob compliant - minimum 50% creator). Listeners earn through separate Contribution Rewards System.';

-- Update column comments
COMMENT ON COLUMN ad_safety_caps.artist_revenue_percentage IS 
'Percentage of ad revenue paid to content creators (current: 50%, minimum: 50% for AdMob compliance)';

COMMENT ON COLUMN ad_safety_caps.platform_revenue_percentage IS 
'Percentage of ad revenue retained by platform for operations and funding Contribution Rewards (current: 50%)';

COMMENT ON COLUMN ad_safety_caps.listener_revenue_percentage IS 
'DEPRECATED: Must always be 0. Listeners earn through separate Contribution Rewards System, not from ad revenue.';
