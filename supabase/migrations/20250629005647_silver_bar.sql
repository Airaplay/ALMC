/*
  # Create trending songs view and country-based trending function

  1. New View
    - `trending_songs` - Simplifies queries for trending songs with artist and album info
    - Properly aliases columns to avoid naming conflicts

  2. New Function
    - `get_trending_songs_by_country` - Returns trending songs filtered by user country
    - Supports global trending if no country is specified
    - Uses listening history from the last 48 hours for country-specific trending

  3. Performance
    - Adds indexes for better query performance
    - Optimizes for country-based and time-based filtering
*/

-- Drop the view if it exists to avoid conflicts
DROP VIEW IF EXISTS trending_songs;

-- Create a view for trending songs to simplify queries
CREATE VIEW trending_songs AS
SELECT 
  s.id,
  s.title,
  s.artist_id,
  a.name as artist_name,
  s.album_id,
  al.title as album_title,
  s.duration_seconds,
  s.audio_url,
  s.cover_image_url,
  al.cover_image_url as album_cover,
  s.play_count,
  s.is_trending,
  s.created_at,
  s.updated_at
FROM 
  songs s
LEFT JOIN 
  artists a ON s.artist_id = a.id
LEFT JOIN 
  albums al ON s.album_id = al.id;

-- Function to get trending songs by country
CREATE OR REPLACE FUNCTION get_trending_songs_by_country(user_country text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  title text,
  artist_id uuid,
  artist_name text,
  album_id uuid,
  album_title text,
  duration_seconds integer,
  audio_url text,
  cover_image_url text,
  album_cover text,
  play_count integer,
  is_trending boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- If no country is provided, return global trending songs
  IF user_country IS NULL OR user_country = '' THEN
    RETURN QUERY
    SELECT 
      ts.id,
      ts.title,
      ts.artist_id,
      ts.artist_name,
      ts.album_id,
      ts.album_title,
      ts.duration_seconds,
      ts.audio_url,
      ts.cover_image_url,
      ts.album_cover,
      ts.play_count,
      ts.is_trending
    FROM 
      trending_songs ts
    WHERE 
      ts.is_trending = true OR ts.play_count > 0
    ORDER BY 
      ts.play_count DESC, ts.created_at DESC
    LIMIT 25;
  ELSE
    -- Return trending songs filtered by country
    -- This uses listening history from the last 48 hours
    RETURN QUERY
    WITH country_listens AS (
      SELECT 
        lh.song_id,
        COUNT(*) as recent_plays
      FROM 
        listening_history lh
      JOIN 
        users u ON lh.user_id = u.id
      WHERE 
        u.country = user_country
        AND lh.listened_at >= NOW() - INTERVAL '48 hours'
      GROUP BY 
        lh.song_id
    )
    SELECT 
      ts.id,
      ts.title,
      ts.artist_id,
      ts.artist_name,
      ts.album_id,
      ts.album_title,
      ts.duration_seconds,
      ts.audio_url,
      ts.cover_image_url,
      ts.album_cover,
      ts.play_count,
      ts.is_trending
    FROM 
      trending_songs ts
    LEFT JOIN 
      country_listens cl ON ts.id = cl.song_id
    ORDER BY 
      COALESCE(cl.recent_plays, 0) DESC, 
      ts.play_count DESC, 
      ts.created_at DESC
    LIMIT 25;
  END IF;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_trending_songs_by_country TO authenticated;
GRANT EXECUTE ON FUNCTION get_trending_songs_by_country TO anon;

-- Create index for better performance on listening_history queries
CREATE INDEX IF NOT EXISTS idx_listening_history_listened_at 
ON listening_history(listened_at DESC);

-- Create index for better performance on user country queries
CREATE INDEX IF NOT EXISTS idx_users_country 
ON users(country) WHERE country IS NOT NULL;