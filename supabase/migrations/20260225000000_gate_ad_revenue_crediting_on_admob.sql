/*
  # Gate Ad Revenue Crediting on AdMob Configuration

  ## Overview
  This migration ensures users only see and receive accurate ad revenue balances
  by gating the crediting process on AdMob API configuration and successful sync.

  ## Changes
  1. Create function to check if AdMob revenue system is ready
  2. Modify process_ad_impression_revenue to only credit when AdMob is ready
  3. Add helper function for frontend to check readiness status

  ## Security
  - is_admob_revenue_ready() is accessible to authenticated users
  - Only processes revenue when AdMob is properly configured
*/

-- Function to check if AdMob revenue system is ready
CREATE OR REPLACE FUNCTION is_admob_revenue_ready()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  has_active_config boolean;
  has_successful_sync boolean;
BEGIN
  -- Check if there's an active AdMob API config
  SELECT EXISTS (
    SELECT 1 
    FROM admob_api_config 
    WHERE is_active = true 
      AND connection_status IN ('connected', 'syncing')
  ) INTO has_active_config;

  -- Check if there's been at least one successful sync
  SELECT EXISTS (
    SELECT 1 
    FROM admob_sync_history 
    WHERE sync_status = 'completed'
      AND records_fetched > 0
    LIMIT 1
  ) INTO has_successful_sync;

  -- Both conditions must be met
  RETURN has_active_config AND has_successful_sync;
END;
$$;

-- Function for frontend to get AdMob revenue readiness status with details
CREATE OR REPLACE FUNCTION get_admob_revenue_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  has_active_config boolean;
  has_successful_sync boolean;
  last_sync_date timestamptz;
  config_details jsonb;
  result jsonb;
BEGIN
  -- Check if there's an active AdMob API config
  SELECT EXISTS (
    SELECT 1 
    FROM admob_api_config 
    WHERE is_active = true 
      AND connection_status IN ('connected', 'syncing')
  ) INTO has_active_config;

  -- Get config details if exists
  IF has_active_config THEN
    SELECT jsonb_build_object(
      'publisher_id', publisher_id,
      'account_name', account_name,
      'connection_status', connection_status,
      'last_sync_at', last_sync_at,
      'next_sync_at', next_sync_at
    ) INTO config_details
    FROM admob_api_config
    WHERE is_active = true
    LIMIT 1;
  END IF;

  -- Check if there's been at least one successful sync
  SELECT 
    EXISTS (
      SELECT 1 
      FROM admob_sync_history 
      WHERE sync_status = 'completed'
        AND records_fetched > 0
      LIMIT 1
    ),
    MAX(completed_at)
  INTO has_successful_sync, last_sync_date
  FROM admob_sync_history
  WHERE sync_status = 'completed'
    AND records_fetched > 0;

  -- Build result
  result := jsonb_build_object(
    'ready', has_active_config AND has_successful_sync,
    'has_active_config', has_active_config,
    'has_successful_sync', has_successful_sync,
    'last_sync_date', last_sync_date,
    'config_details', COALESCE(config_details, '{}'::jsonb),
    'message', CASE
      WHEN has_active_config AND has_successful_sync THEN 'AdMob revenue system is active and ready'
      WHEN has_active_config AND NOT has_successful_sync THEN 'AdMob is configured but waiting for first successful sync'
      WHEN NOT has_active_config THEN 'AdMob API configuration required'
      ELSE 'AdMob revenue system not ready'
    END
  );

  RETURN result;
END;
$$;

-- Update process_ad_impression_revenue to only credit when AdMob is ready
CREATE OR REPLACE FUNCTION process_ad_impression_revenue(
  impression_uuid uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  impression_record record;
  user_record record;
  artist_record record;
  content_record record;
  revenue_amount numeric;
  artist_share numeric := 0;
  user_share numeric := 0;
  platform_share numeric := 0;
  payout_settings jsonb;
  new_revenue_id uuid;
  result jsonb;
  admob_ready boolean;
BEGIN
  -- Check if AdMob revenue system is ready
  admob_ready := is_admob_revenue_ready();

  -- Get the impression record
  SELECT * INTO impression_record
  FROM ad_impressions
  WHERE id = impression_uuid;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Ad impression not found');
  END IF;
  
  -- Check if revenue has already been processed for this impression
  IF EXISTS (
    SELECT 1 FROM ad_revenue_events
    WHERE impression_id = impression_uuid
  ) THEN
    RETURN jsonb_build_object('error', 'Revenue already processed for this impression');
  END IF;
  
  -- Get user record
  IF impression_record.user_id IS NOT NULL THEN
    SELECT * INTO user_record
    FROM users
    WHERE id = impression_record.user_id;
  END IF;
  
  -- Get content record and associated artist
  IF impression_record.content_id IS NOT NULL THEN
    IF impression_record.content_type = 'song' THEN
      -- For songs
      SELECT s.*, a.id as artist_id INTO content_record
      FROM songs s
      LEFT JOIN artists a ON s.artist_id = a.id
      WHERE s.id = impression_record.content_id;
      
      IF FOUND AND content_record.artist_id IS NOT NULL THEN
        SELECT * INTO artist_record
        FROM artists
        WHERE id = content_record.artist_id;
      END IF;
    ELSE
      -- For content_uploads (videos, clips, etc.)
      SELECT cu.*, ap.artist_id INTO content_record
      FROM content_uploads cu
      LEFT JOIN artist_profiles ap ON cu.artist_profile_id = ap.id
      WHERE cu.id = impression_record.content_id;
      
      IF FOUND AND content_record.artist_id IS NOT NULL THEN
        SELECT * INTO artist_record
        FROM artists
        WHERE id = content_record.artist_id;
      END IF;
    END IF;
  END IF;
  
  -- Calculate revenue amount
  revenue_amount := calculate_ad_revenue(impression_uuid);
  
  -- Get payout settings
  IF user_record.id IS NOT NULL THEN
    payout_settings := get_user_payout_settings(user_record.id);
  ELSE
    -- Use global settings if no user
    payout_settings := get_user_payout_settings();
  END IF;
  
  -- Calculate shares based on payout settings
  IF artist_record.id IS NOT NULL THEN
    -- Artist gets their share
    artist_share := revenue_amount * (payout_settings->>'artist_percentage')::numeric / 100;
  END IF;
  
  IF user_record.id IS NOT NULL THEN
    -- User gets listener share
    user_share := revenue_amount * (payout_settings->>'listener_percentage')::numeric / 100;
  END IF;
  
  -- Platform gets the rest
  platform_share := revenue_amount - artist_share - user_share;
  
  -- Create revenue event record (always create for audit trail)
  INSERT INTO ad_revenue_events (
    impression_id,
    revenue_amount,
    currency,
    user_id,
    artist_id,
    content_id,
    status,
    metadata
  ) VALUES (
    impression_uuid,
    revenue_amount,
    'USD',
    impression_record.user_id,
    artist_record.id,
    impression_record.content_id,
    CASE WHEN admob_ready THEN 'processed' ELSE 'pending_admob' END,
    jsonb_build_object(
      'artist_share', artist_share,
      'user_share', user_share,
      'platform_share', platform_share,
      'ad_type', impression_record.ad_type,
      'content_type', impression_record.content_type,
      'duration_viewed', impression_record.duration_viewed,
      'completed', impression_record.completed,
      'admob_ready', admob_ready,
      'credited_to_users', admob_ready
    )
  )
  RETURNING id INTO new_revenue_id;
  
  -- Only update user earnings if AdMob is ready
  IF admob_ready THEN
    -- Update user earnings if applicable
    IF user_record.id IS NOT NULL AND user_share > 0 THEN
      UPDATE users
      SET 
        total_earnings = total_earnings + user_share,
        updated_at = now()
      WHERE id = user_record.id;
    END IF;
    
    -- Update artist earnings if applicable
    IF artist_record.id IS NOT NULL AND artist_share > 0 THEN
      -- Find all users associated with this artist
      UPDATE users
      SET 
        total_earnings = total_earnings + artist_share,
        updated_at = now()
      WHERE id IN (
        SELECT user_id 
        FROM artist_profiles 
        WHERE artist_id = artist_record.id
      );
    END IF;
  END IF;
  
  -- Build result
  result := jsonb_build_object(
    'success', true,
    'revenue_event_id', new_revenue_id,
    'revenue_amount', revenue_amount,
    'artist_share', artist_share,
    'user_share', user_share,
    'platform_share', platform_share,
    'admob_ready', admob_ready,
    'credited_to_users', admob_ready,
    'message', CASE 
      WHEN admob_ready THEN 'Revenue processed and credited to users'
      ELSE 'Revenue event created but not credited (waiting for AdMob configuration)'
    END
  );
  
  RETURN result;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION is_admob_revenue_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION get_admob_revenue_status() TO authenticated;

-- Add helpful comments
COMMENT ON FUNCTION is_admob_revenue_ready() IS 
  'Returns true if AdMob API is configured and has had at least one successful sync. Used to gate ad revenue crediting.';

COMMENT ON FUNCTION get_admob_revenue_status() IS 
  'Returns detailed status of AdMob revenue system readiness for frontend display. Includes config status, last sync date, and user-friendly messages.';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_admob_sync_history_completed 
  ON admob_sync_history(sync_status, completed_at DESC) 
  WHERE sync_status = 'completed' AND records_fetched > 0;

CREATE INDEX IF NOT EXISTS idx_admob_api_config_active 
  ON admob_api_config(is_active, connection_status) 
  WHERE is_active = true;
