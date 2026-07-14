/*
  # Create Featured Artists System

  ## Overview
  This migration creates a comprehensive system for managing featured artists based on weekly stream growth
  and engagement metrics. The system automatically identifies and rotates featured artists weekly.

  ## New Tables
  
  ### `featured_artists`
  Stores artists who are currently or have been featured, with automatic weekly rotation
  - `id` (uuid, primary key) - Unique identifier
  - `artist_id` (uuid) - Reference to artists table
  - `user_id` (uuid) - Reference to users table (artist's user account)
  - `region` (text) - Artist's region/country for location-based filtering
  - `featured_start_date` (timestamptz) - When the feature period started
  - `featured_end_date` (timestamptz) - When the feature period ends
  - `status` (text) - Current status: 'active', 'scheduled', 'expired'
  - `weekly_growth_percentage` (numeric) - Stream growth % that qualified them
  - `total_likes_last_week` (integer) - Likes received in qualifying week
  - `avg_completion_rate` (numeric) - Average song completion rate
  - `last_upload_date` (timestamptz) - Date of most recent upload
  - `auto_selected` (boolean) - Whether automatically selected or manually added
  - `priority_order` (integer) - Display order (lower = higher priority)
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### `featured_artists_history`
  Tracks historical data for analytics and reporting
  - `id` (uuid, primary key) - Unique identifier
  - `artist_id` (uuid) - Reference to artists table
  - `user_id` (uuid) - Reference to users table
  - `region` (text) - Artist's region
  - `featured_period_start` (timestamptz) - Start of feature period
  - `featured_period_end` (timestamptz) - End of feature period
  - `impressions` (integer) - Number of times artist was viewed
  - `profile_clicks` (integer) - Clicks to artist profile
  - `new_followers` (integer) - New followers gained during period
  - `qualifying_metrics` (jsonb) - Metrics that qualified them
  - `created_at` (timestamptz) - Archive timestamp

  ## Security
  - Enable RLS on all tables
  - Public read access to active featured artists
  - Admins can manage all records
  - Artists can view their own featured history

  ## Indexes
  - Optimized for region-based queries
  - Status and date-based filtering
  - Artist lookup performance

  ## Functions
  - Automatic weekly rotation function
  - Artist eligibility calculation
  - Performance tracking
*/

-- Create featured_artists table
CREATE TABLE IF NOT EXISTS featured_artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid REFERENCES artists(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  region text NOT NULL DEFAULT 'global',
  featured_start_date timestamptz NOT NULL DEFAULT now(),
  featured_end_date timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'scheduled', 'expired')),
  weekly_growth_percentage numeric DEFAULT 0 CHECK (weekly_growth_percentage >= 0),
  total_likes_last_week integer DEFAULT 0 CHECK (total_likes_last_week >= 0),
  avg_completion_rate numeric DEFAULT 0 CHECK (avg_completion_rate >= 0 AND avg_completion_rate <= 100),
  last_upload_date timestamptz,
  auto_selected boolean DEFAULT true,
  priority_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create featured_artists_history table
CREATE TABLE IF NOT EXISTS featured_artists_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid REFERENCES artists(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  region text NOT NULL,
  featured_period_start timestamptz NOT NULL,
  featured_period_end timestamptz NOT NULL,
  impressions integer DEFAULT 0,
  profile_clicks integer DEFAULT 0,
  new_followers integer DEFAULT 0,
  qualifying_metrics jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE featured_artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE featured_artists_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for featured_artists

-- Public can view active featured artists
CREATE POLICY "Public can view active featured artists"
ON featured_artists
FOR SELECT
TO public
USING (status = 'active' AND featured_start_date <= now() AND featured_end_date >= now());

-- Admins can manage all featured artists
CREATE POLICY "Admins can manage featured artists"
ON featured_artists
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager')
  )
);

-- Artists can view their own featured status
CREATE POLICY "Artists can view own featured status"
ON featured_artists
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- RLS Policies for featured_artists_history

-- Public can view featured history (for transparency)
CREATE POLICY "Public can view featured history"
ON featured_artists_history
FOR SELECT
TO public
USING (true);

-- Admins can manage history
CREATE POLICY "Admins can manage featured history"
ON featured_artists_history
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager')
  )
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_featured_artists_artist_id ON featured_artists(artist_id);
CREATE INDEX IF NOT EXISTS idx_featured_artists_user_id ON featured_artists(user_id);
CREATE INDEX IF NOT EXISTS idx_featured_artists_region ON featured_artists(region);
CREATE INDEX IF NOT EXISTS idx_featured_artists_status ON featured_artists(status);
CREATE INDEX IF NOT EXISTS idx_featured_artists_dates ON featured_artists(featured_start_date, featured_end_date);
CREATE INDEX IF NOT EXISTS idx_featured_artists_priority ON featured_artists(priority_order);

CREATE INDEX IF NOT EXISTS idx_featured_history_artist_id ON featured_artists_history(artist_id);
CREATE INDEX IF NOT EXISTS idx_featured_history_region ON featured_artists_history(region);
CREATE INDEX IF NOT EXISTS idx_featured_history_dates ON featured_artists_history(featured_period_start, featured_period_end);

-- Function to calculate artist eligibility for featured status
CREATE OR REPLACE FUNCTION calculate_featured_artist_eligibility()
RETURNS TABLE(
  artist_id uuid,
  user_id uuid,
  region text,
  weekly_growth_pct numeric,
  total_likes integer,
  completion_rate numeric,
  last_upload timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH artist_metrics AS (
    SELECT
      s.artist_id,
      ap.user_id,
      COALESCE(ap.country, s.country, 'global') as artist_region,
      
      -- Calculate weekly growth
      COALESCE(
        CASE 
          WHEN COUNT(DISTINCT CASE WHEN ps.played_at >= now() - interval '14 days' AND ps.played_at < now() - interval '7 days' THEN ps.id END) > 0
          THEN (
            (COUNT(DISTINCT CASE WHEN ps.played_at >= now() - interval '7 days' THEN ps.id END)::numeric - 
             COUNT(DISTINCT CASE WHEN ps.played_at >= now() - interval '14 days' AND ps.played_at < now() - interval '7 days' THEN ps.id END)::numeric) /
            COUNT(DISTINCT CASE WHEN ps.played_at >= now() - interval '14 days' AND ps.played_at < now() - interval '7 days' THEN ps.id END)::numeric * 100
          )
          ELSE 0
        END, 0
      ) as growth_percentage,
      
      -- Count likes in last 7 days
      COUNT(DISTINCT CASE WHEN l.created_at >= now() - interval '7 days' THEN l.id END) as likes_count,
      
      -- Calculate completion rate
      COALESCE(
        AVG(
          CASE 
            WHEN ps.duration_listened > 0 AND s.duration_seconds > 0
            THEN LEAST((ps.duration_listened::numeric / s.duration_seconds::numeric * 100), 100)
            ELSE 0
          END
        ), 0
      ) as avg_completion,
      
      -- Get last upload date
      MAX(s.created_at) as recent_upload
      
    FROM songs s
    INNER JOIN artists a ON s.artist_id = a.id
    INNER JOIN artist_profiles ap ON a.id = ap.artist_id
    LEFT JOIN play_sessions ps ON s.id = ps.song_id AND ps.played_at >= now() - interval '14 days'
    LEFT JOIN likes l ON s.id = l.song_id AND l.created_at >= now() - interval '7 days'
    
    WHERE s.created_at >= now() - interval '14 days'  -- Must have uploaded within 14 days
    
    GROUP BY s.artist_id, ap.user_id, ap.country, s.country
  )
  
  SELECT
    am.artist_id,
    am.user_id,
    am.artist_region,
    am.growth_percentage,
    am.likes_count,
    am.avg_completion,
    am.recent_upload
  FROM artist_metrics am
  WHERE 
    am.growth_percentage >= 20  -- At least 20% growth
    AND am.likes_count >= 20  -- At least 20 likes
    AND am.avg_completion >= 60  -- At least 60% completion rate
    AND am.recent_upload >= now() - interval '14 days'  -- Uploaded within 14 days
  ORDER BY am.growth_percentage DESC, am.likes_count DESC
  LIMIT 20;  -- Top 20 eligible artists
END;
$$;

-- Function to auto-update featured artists weekly
CREATE OR REPLACE FUNCTION update_featured_artists_weekly()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  eligible_artist RECORD;
  current_order integer := 0;
BEGIN
  -- Archive expired featured artists
  INSERT INTO featured_artists_history (
    artist_id,
    user_id,
    region,
    featured_period_start,
    featured_period_end,
    qualifying_metrics
  )
  SELECT
    artist_id,
    user_id,
    region,
    featured_start_date,
    featured_end_date,
    jsonb_build_object(
      'weekly_growth_percentage', weekly_growth_percentage,
      'total_likes_last_week', total_likes_last_week,
      'avg_completion_rate', avg_completion_rate,
      'auto_selected', auto_selected
    )
  FROM featured_artists
  WHERE status = 'active' AND featured_end_date < now();
  
  -- Mark expired artists
  UPDATE featured_artists
  SET status = 'expired', updated_at = now()
  WHERE status = 'active' AND featured_end_date < now();
  
  -- Delete auto-selected expired entries older than 30 days
  DELETE FROM featured_artists
  WHERE status = 'expired' AND auto_selected = true AND featured_end_date < now() - interval '30 days';
  
  -- Add new featured artists from eligible pool
  FOR eligible_artist IN
    SELECT * FROM calculate_featured_artist_eligibility()
  LOOP
    -- Check if artist is not already featured
    IF NOT EXISTS (
      SELECT 1 FROM featured_artists
      WHERE artist_id = eligible_artist.artist_id
      AND status IN ('active', 'scheduled')
    ) THEN
      INSERT INTO featured_artists (
        artist_id,
        user_id,
        region,
        featured_start_date,
        featured_end_date,
        status,
        weekly_growth_percentage,
        total_likes_last_week,
        avg_completion_rate,
        last_upload_date,
        auto_selected,
        priority_order
      ) VALUES (
        eligible_artist.artist_id,
        eligible_artist.user_id,
        eligible_artist.region,
        date_trunc('week', now()),
        date_trunc('week', now()) + interval '7 days',
        'active',
        eligible_artist.weekly_growth_pct,
        eligible_artist.total_likes,
        eligible_artist.completion_rate,
        eligible_artist.last_upload,
        true,
        current_order
      );
      
      current_order := current_order + 1;
    END IF;
  END LOOP;
  
END;
$$;

-- Function to track featured artist impressions
CREATE OR REPLACE FUNCTION track_featured_artist_view(
  p_artist_id uuid,
  p_view_type text  -- 'impression' or 'profile_click'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This will be called from the frontend to track analytics
  -- For now, we'll just ensure the artist exists in featured_artists
  IF EXISTS (
    SELECT 1 FROM featured_artists
    WHERE artist_id = p_artist_id AND status = 'active'
  ) THEN
    -- Update history metrics would go here in a production system
    -- For simplicity, we're acknowledging the view
    NULL;
  END IF;
END;
$$;

-- Create a trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_featured_artists_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_featured_artists_timestamp
BEFORE UPDATE ON featured_artists
FOR EACH ROW
EXECUTE FUNCTION update_featured_artists_updated_at();
