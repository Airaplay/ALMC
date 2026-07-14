/*
  # Update AdMob Configuration
  
  Updates the AdMob network configuration with the production App ID and Publisher ID.
  
  Changes:
  - App ID: ca-app-pub-4739421992298461~4630726757
  - Publisher ID (API Key): pub-4739421992298461
*/

-- Update AdMob network configuration if it exists
UPDATE ad_networks
SET 
  app_id = 'ca-app-pub-4739421992298461~4630726757',
  api_key = 'pub-4739421992298461',
  updated_at = now()
WHERE network = 'admob';

-- If AdMob entry doesn't exist, create it
-- Note: This uses a DO block to check if the update affected any rows
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ad_networks WHERE network = 'admob') THEN
    INSERT INTO ad_networks (network, api_key, app_id, is_active)
    VALUES ('admob', 'pub-4739421992298461', 'ca-app-pub-4739421992298461~4630726757', true);
  END IF;
END $$;

