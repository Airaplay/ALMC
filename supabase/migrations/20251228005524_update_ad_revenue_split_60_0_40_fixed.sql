/*
  # Update Ad Revenue Split to 60/0/40 (Compliant Monetization Model)

  ## Overview
  This migration updates the ad revenue distribution system to comply with the new monetization model:
  - Creators: 60% (increased from 45%)
  - Listeners: 0% (removed - they earn through contribution points instead)
  - Platform: 40% (unchanged)

  ## Changes Made
  
  ### 1. Update ad_safety_caps Table
  - Set artist_revenue_percentage to 60.00
  - Set listener_revenue_percentage to 0.00
  - Set platform_revenue_percentage to 40.00
  - Update all active configurations

  ### 2. Update admob_configuration Table (if exists)
  - Ensure creator_share = 0.60
  - Ensure listener_share = 0.00
  - Ensure platform_share = 0.40

  ### 3. Add Documentation Comments
  - Clarify that listeners earn through contribution rewards, NOT ads
  - Document the new revenue split clearly

  ## Important Notes
  - This change is irreversible and affects all future ad revenue distribution
  - Historical data remains unchanged (audit trail preserved)
  - Listeners will earn through the contribution points system only
  - The max_listener_earnings_per_day_usd field is now OBSOLETE for ad revenue
*/

-- ============================================================================
-- 1. UPDATE: ad_safety_caps table revenue split
-- ============================================================================

-- Update all active ad_safety_caps configurations
UPDATE ad_safety_caps
SET
  artist_revenue_percentage = 60.00,
  listener_revenue_percentage = 0.00,
  platform_revenue_percentage = 40.00,
  updated_at = now()
WHERE is_active = true;

-- Add comment to clarify the new model
COMMENT ON COLUMN ad_safety_caps.listener_revenue_percentage IS 
'OBSOLETE FOR AD REVENUE: Set to 0.00. Listeners earn through contribution points system, NOT from ad revenue. This field kept for historical compatibility but should always be 0 for ad revenue.';

COMMENT ON COLUMN ad_safety_caps.artist_revenue_percentage IS 
'Percentage of ad revenue distributed to content creators (60%)';

COMMENT ON COLUMN ad_safety_caps.platform_revenue_percentage IS 
'Percentage of ad revenue retained by platform (40%). Platform uses this to fund contribution rewards pool and operations.';

COMMENT ON COLUMN ad_safety_caps.max_listener_earnings_per_day_usd IS 
'OBSOLETE FOR AD REVENUE: Listeners no longer earn from ads. They earn through contribution points which are converted monthly. This field kept for historical compatibility.';

-- ============================================================================
-- 2. UPDATE: admob_configuration table (if exists)
-- ============================================================================

DO $$
BEGIN
  -- Check if admob_configuration table exists and update it
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'admob_configuration'
  ) THEN
    
    -- Update revenue split
    UPDATE admob_configuration
    SET
      creator_share = 0.60,
      listener_share = 0.00,
      platform_share = 0.40,
      updated_at = now()
    WHERE id IN (SELECT id FROM admob_configuration LIMIT 1);
    
    -- Update table comment
    COMMENT ON TABLE admob_configuration IS 
    'AdMob ad revenue split: 60% to creators, 40% to platform (0% to listeners). Listeners earn separately through contribution rewards from platform budget, NOT from ads. This is compliant with AdMob policies.';
    
  END IF;
END $$;

-- ============================================================================
-- 3. ADD: Validation constraint to ensure listener_revenue is always 0
-- ============================================================================

-- Add constraint to prevent accidental changes
DO $$
BEGIN
  -- Drop old constraint if exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'ad_safety_caps_revenue_split_check'
    AND table_name = 'ad_safety_caps'
  ) THEN
    ALTER TABLE ad_safety_caps 
    DROP CONSTRAINT ad_safety_caps_revenue_split_check;
  END IF;

  -- Add new constraint that ensures:
  -- 1. listener_revenue_percentage must be 0
  -- 2. artist + listener + platform must equal 100
  ALTER TABLE ad_safety_caps
  ADD CONSTRAINT ad_safety_caps_revenue_split_check CHECK (
    listener_revenue_percentage = 0.00 AND
    (artist_revenue_percentage + listener_revenue_percentage + platform_revenue_percentage) = 100.00
  );
END $$;

-- ============================================================================
-- 4. CREATE: Function to ensure compliance
-- ============================================================================

CREATE OR REPLACE FUNCTION check_ad_revenue_split_compliance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure listener revenue percentage is always 0
  IF NEW.listener_revenue_percentage != 0.00 THEN
    RAISE EXCEPTION 'Listener revenue from ads must be 0. Listeners earn through contribution points system, not ad revenue.';
  END IF;

  -- Ensure total equals 100%
  IF (NEW.artist_revenue_percentage + NEW.listener_revenue_percentage + NEW.platform_revenue_percentage) != 100.00 THEN
    RAISE EXCEPTION 'Revenue split must total 100%%. Currently: %', 
      (NEW.artist_revenue_percentage + NEW.listener_revenue_percentage + NEW.platform_revenue_percentage);
  END IF;

  -- Ensure artist gets at least 50% (compliance requirement)
  IF NEW.artist_revenue_percentage < 50.00 THEN
    RAISE EXCEPTION 'Artist revenue percentage must be at least 50%%';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS ensure_ad_revenue_split_compliance ON ad_safety_caps;

-- Create trigger
CREATE TRIGGER ensure_ad_revenue_split_compliance
  BEFORE INSERT OR UPDATE ON ad_safety_caps
  FOR EACH ROW
  EXECUTE FUNCTION check_ad_revenue_split_compliance();

-- ============================================================================
-- 5. CREATE: Helper function to get current revenue split
-- ============================================================================

CREATE OR REPLACE FUNCTION get_current_ad_revenue_split()
RETURNS TABLE (
  creator_percentage numeric,
  listener_percentage numeric,
  platform_percentage numeric,
  model_description text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    artist_revenue_percentage as creator_percentage,
    listener_revenue_percentage as listener_percentage,
    platform_revenue_percentage as platform_percentage,
    'Creators: 60%, Listeners: 0% (earn via contribution points), Platform: 40%' as model_description
  FROM ad_safety_caps
  WHERE is_active = true
  ORDER BY updated_at DESC
  LIMIT 1;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_current_ad_revenue_split TO authenticated, anon;

-- ============================================================================
-- 6. ADD: Documentation and comments
-- ============================================================================

COMMENT ON TABLE ad_safety_caps IS 
'Ad safety configuration and revenue split settings. IMPORTANT: Listeners earn 0% from ad revenue. They earn through the contribution points system which is funded separately by the platform. This ensures AdMob policy compliance and fair, value-based rewards.';

-- ============================================================================
-- VERIFICATION QUERIES (for admin use)
-- ============================================================================

-- Query to verify the update
-- SELECT * FROM ad_safety_caps WHERE is_active = true;
-- SELECT * FROM get_current_ad_revenue_split();
