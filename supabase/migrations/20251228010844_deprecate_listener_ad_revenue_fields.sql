/*
  # Deprecate Listener Ad Revenue Fields

  1. Purpose
    - Mark listener-related fields in ad_safety_caps as DEPRECATED
    - Add clear documentation that these fields are no longer used
    - Listeners earn through Contribution Rewards System, NOT ad revenue

  2. Changes
    - Add column comments marking fields as DEPRECATED
    - Update table comment to reflect new 60/0/40 model
    - No data changes (backward compatible)

  3. Security
    - No RLS changes needed
    - No data migration needed
*/

-- Add table comment explaining new model
COMMENT ON TABLE ad_safety_caps IS
'Ad safety caps and revenue split configuration.
REVENUE MODEL: 60% Creators | 0% Listeners | 40% Platform
Listeners earn through separate Contribution Rewards System.';

-- Mark max_listener_earnings_per_day_usd as DEPRECATED
COMMENT ON COLUMN ad_safety_caps.max_listener_earnings_per_day_usd IS
'DEPRECATED: No longer used. Listeners earn 0% from ads.
Listeners now earn through the Contribution Rewards System (Admin Dashboard → Contribution Rewards).
This field is kept for backward compatibility only.';

-- Mark min_lqs_for_listener_reward as DEPRECATED
COMMENT ON COLUMN ad_safety_caps.min_lqs_for_listener_reward IS
'DEPRECATED: No longer used. Listeners earn 0% from ads.
Quality thresholds no longer apply to ad revenue for listeners.
This field is kept for backward compatibility only.';

-- Mark listener_revenue_percentage as DEPRECATED (though it should always be 0)
COMMENT ON COLUMN ad_safety_caps.listener_revenue_percentage IS
'DEPRECATED: Fixed at 0.00% for AdMob compliance.
Listeners earn through separate Contribution Rewards System, NOT from ad revenue.
Database constraint enforces this must always be 0.00.
DO NOT modify this value.';

-- Add helpful comments on active fields
COMMENT ON COLUMN ad_safety_caps.artist_revenue_percentage IS
'Creator/Artist revenue percentage from ad revenue.
Must be ≥50% for AdMob policy compliance.
Default: 60% in new monetization model.';

COMMENT ON COLUMN ad_safety_caps.platform_revenue_percentage IS
'Platform revenue percentage from ad revenue.
Used for operations and funding the Contribution Rewards System.
Default: 40% in new monetization model.';

COMMENT ON COLUMN ad_safety_caps.max_rewarded_ads_per_day IS
'Maximum number of ads per day that can generate revenue for creators.
Applies to creator earnings only (listeners earn through contribution rewards).';

COMMENT ON COLUMN ad_safety_caps.min_playback_duration_seconds IS
'Minimum playback duration in seconds required for ad revenue eligibility.
Applies to creator earnings only.';