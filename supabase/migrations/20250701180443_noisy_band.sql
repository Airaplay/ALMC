/*
  # Create ad_revenue_events table for tracking ad revenue

  1. New Table
    - `ad_revenue_events` - Store revenue generated from ad impressions
      - `id` (uuid, primary key)
      - `impression_id` (uuid, references ad_impressions)
      - `revenue_amount` (numeric, the calculated revenue)
      - `currency` (text, e.g., 'USD', 'NGN')
      - `user_id` (uuid, references users)
      - `artist_id` (uuid, references artists)
      - `content_id` (uuid, the content that showed the ad)
      - `processed_at` (timestamptz)
      - `status` (text, e.g., 'pending', 'processed', 'failed')
      - `metadata` (jsonb, additional data)

  2. Security
    - Enable RLS on ad_revenue_events table
    - Users can only view their own revenue events
    - Admins can view and manage all revenue events

  3. Functions
    - `calculate_ad_revenue` - Calculate revenue for an ad impression
    - `process_ad_impression_revenue` - Process revenue for a specific ad impression
    - `get_user_revenue_summary` - Get revenue summary for a user
*/

-- Create ad_revenue_events table
CREATE TABLE IF NOT EXISTS ad_revenue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impression_id uuid REFERENCES ad_impressions(id) ON DELETE SET NULL,
  revenue_amount numeric NOT NULL DEFAULT 0 CHECK (revenue_amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  artist_id uuid REFERENCES artists(id) ON DELETE SET NULL,
  content_id uuid, -- Can reference either content_uploads.id or songs.id
  processed_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE ad_revenue_events ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ad_revenue_events_impression_id ON ad_revenue_events(impression_id);
CREATE INDEX IF NOT EXISTS idx_ad_revenue_events_user_id ON ad_revenue_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_revenue_events_artist_id ON ad_revenue_events(artist_id);
CREATE INDEX IF NOT EXISTS idx_ad_revenue_events_content_id ON ad_revenue_events(content_id);
CREATE INDEX IF NOT EXISTS idx_ad_revenue_events_status ON ad_revenue_events(status);
CREATE INDEX IF NOT EXISTS idx_ad_revenue_events_processed_at ON ad_revenue_events(processed_at);

-- RLS Policies for ad_revenue_events table
-- Users can view their own revenue events
CREATE POLICY "Users can view own revenue events"
ON ad_revenue_events
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Artists can view revenue events for their content
CREATE POLICY "Artists can view revenue events for their content"
ON ad_revenue_events
FOR SELECT
TO authenticated
USING (
  artist_id IN (
    SELECT artist_id 
    FROM artist_profiles 
    WHERE user_id = auth.uid()
  )
);

-- Admins can view all revenue events
CREATE POLICY "Admins can view all revenue events"
ON ad_revenue_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

-- Admins can manage all revenue events
CREATE POLICY "Admins can manage all revenue events"
ON ad_revenue_events
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

-- Function to calculate revenue for an ad impression
CREATE OR REPLACE FUNCTION calculate_ad_revenue(
  impression_uuid uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  impression_record record;
  base_rate numeric := 0.001; -- Base rate per impression in USD
  duration_multiplier numeric := 1.0;
  completion_multiplier numeric := 1.0;
  country_multiplier numeric := 1.0;
  ad_type_multiplier numeric := 1.0;
  content_type_multiplier numeric := 1.0;
  final_rate numeric;
BEGIN
  -- Get the impression record
  SELECT * INTO impression_record
  FROM ad_impressions
  WHERE id = impression_uuid;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ad impression not found';
  END IF;
  
  -- Apply duration multiplier (longer views = more revenue)
  IF impression_record.duration_viewed > 0 THEN
    -- 0.1 extra per 10 seconds viewed, capped at 3x
    duration_multiplier := LEAST(1.0 + (impression_record.duration_viewed / 10.0 * 0.1), 3.0);
  END IF;
  
  -- Apply completion multiplier (completed views are worth more)
  IF impression_record.completed THEN
    completion_multiplier := 1.5;
  END IF;
  
  -- Apply ad type multiplier
  CASE impression_record.ad_type
    WHEN 'pre-roll' THEN ad_type_multiplier := 1.2;
    WHEN 'mid-roll' THEN ad_type_multiplier := 1.5;
    WHEN 'interstitial' THEN ad_type_multiplier := 2.0;
    WHEN 'banner' THEN ad_type_multiplier := 0.5;
    ELSE ad_type_multiplier := 1.0;
  END CASE;
  
  -- Apply content type multiplier
  CASE impression_record.content_type
    WHEN 'video' THEN content_type_multiplier := 1.5;
    WHEN 'short_clip' THEN content_type_multiplier := 1.2;
    WHEN 'song' THEN content_type_multiplier := 1.0;
    ELSE content_type_multiplier := 1.0;
  END CASE;
  
  -- Apply country multiplier (would typically be based on a lookup table)
  -- For simplicity, we're using a fixed value here
  country_multiplier := 1.0;
  
  -- Calculate final rate
  final_rate := base_rate * duration_multiplier * completion_multiplier * 
                ad_type_multiplier * content_type_multiplier * country_multiplier;
  
  -- Round to 6 decimal places (microdollars)
  RETURN ROUND(final_rate, 6);
END;
$$;

-- Function to process revenue for a specific ad impression
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
BEGIN
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
  
  -- Create revenue event record
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
    'processed',
    jsonb_build_object(
      'artist_share', artist_share,
      'user_share', user_share,
      'platform_share', platform_share,
      'ad_type', impression_record.ad_type,
      'content_type', impression_record.content_type,
      'duration_viewed', impression_record.duration_viewed,
      'completed', impression_record.completed
    )
  )
  RETURNING id INTO new_revenue_id;
  
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
  
  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'revenue_id', new_revenue_id,
    'revenue_amount', revenue_amount,
    'artist_share', artist_share,
    'user_share', user_share,
    'platform_share', platform_share
  );
END;
$$;

-- Function to get revenue summary for a user
CREATE OR REPLACE FUNCTION get_user_revenue_summary(
  user_uuid uuid DEFAULT auth.uid(),
  start_date timestamptz DEFAULT (now() - interval '30 days'),
  end_date timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_revenue numeric;
  artist_revenue numeric;
  listener_revenue numeric;
  daily_revenue jsonb;
  by_content_type jsonb;
  by_ad_type jsonb;
  result jsonb;
BEGIN
  -- Check if user is authenticated
  IF user_uuid IS NULL THEN
    RETURN jsonb_build_object('error', 'Authentication required');
  END IF;

  -- Get total revenue
  SELECT COALESCE(SUM(revenue_amount), 0) INTO total_revenue
  FROM ad_revenue_events
  WHERE (user_id = user_uuid OR 
         artist_id IN (SELECT artist_id FROM artist_profiles WHERE user_id = user_uuid))
    AND processed_at BETWEEN start_date AND end_date
    AND status = 'processed';

  -- Get artist revenue
  SELECT COALESCE(SUM(revenue_amount), 0) INTO artist_revenue
  FROM ad_revenue_events
  WHERE artist_id IN (SELECT artist_id FROM artist_profiles WHERE user_id = user_uuid)
    AND processed_at BETWEEN start_date AND end_date
    AND status = 'processed';

  -- Get listener revenue
  SELECT COALESCE(SUM(revenue_amount), 0) INTO listener_revenue
  FROM ad_revenue_events
  WHERE user_id = user_uuid
    AND processed_at BETWEEN start_date AND end_date
    AND status = 'processed';

  -- Get daily revenue
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', date,
      'revenue', revenue
    )
  )
  INTO daily_revenue
  FROM (
    SELECT 
      date_trunc('day', processed_at) as date,
      SUM(revenue_amount) as revenue
    FROM ad_revenue_events
    WHERE (user_id = user_uuid OR 
           artist_id IN (SELECT artist_id FROM artist_profiles WHERE user_id = user_uuid))
      AND processed_at BETWEEN start_date AND end_date
      AND status = 'processed'
    GROUP BY date
    ORDER BY date
  ) as daily;

  -- Get revenue by content type
  SELECT jsonb_agg(
    jsonb_build_object(
      'content_type', content_type,
      'revenue', revenue
    )
  )
  INTO by_content_type
  FROM (
    SELECT 
      metadata->>'content_type' as content_type,
      SUM(revenue_amount) as revenue
    FROM ad_revenue_events
    WHERE (user_id = user_uuid OR 
           artist_id IN (SELECT artist_id FROM artist_profiles WHERE user_id = user_uuid))
      AND processed_at BETWEEN start_date AND end_date
      AND status = 'processed'
    GROUP BY metadata->>'content_type'
    ORDER BY revenue DESC
  ) as content_types;

  -- Get revenue by ad type
  SELECT jsonb_agg(
    jsonb_build_object(
      'ad_type', ad_type,
      'revenue', revenue
    )
  )
  INTO by_ad_type
  FROM (
    SELECT 
      metadata->>'ad_type' as ad_type,
      SUM(revenue_amount) as revenue
    FROM ad_revenue_events
    WHERE (user_id = user_uuid OR 
           artist_id IN (SELECT artist_id FROM artist_profiles WHERE user_id = user_uuid))
      AND processed_at BETWEEN start_date AND end_date
      AND status = 'processed'
    GROUP BY metadata->>'ad_type'
    ORDER BY revenue DESC
  ) as ad_types;

  -- Build result
  result := jsonb_build_object(
    'total_revenue', total_revenue,
    'artist_revenue', artist_revenue,
    'listener_revenue', listener_revenue,
    'daily_revenue', COALESCE(daily_revenue, '[]'::jsonb),
    'by_content_type', COALESCE(by_content_type, '[]'::jsonb),
    'by_ad_type', COALESCE(by_ad_type, '[]'::jsonb),
    'period', jsonb_build_object(
      'start_date', start_date,
      'end_date', end_date
    )
  );

  RETURN result;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION calculate_ad_revenue(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION process_ad_impression_revenue(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_revenue_summary(uuid, timestamptz, timestamptz) TO authenticated;