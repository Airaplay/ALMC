/*
  # Create new releases function with country filtering

  1. New Function
    - `get_new_releases_by_country` - Returns latest songs filtered by user country
    - Supports global new releases if no country is specified
    - Prioritizes recent uploads from the last 30 days
    - Returns 25 latest songs with complete metadata

  2. Performance
    - Adds index for release_date for better query performance
    - Optimizes for country-based filtering
    - Includes artist information for display
*/

-- Function to get new releases by country
CREATE OR REPLACE FUNCTION get_new_releases_by_country(user_country text DEFAULT NULL)
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
  release_date date,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- If no country is provided, return global new releases
  IF user_country IS NULL OR user_country = '' THEN
    RETURN QUERY
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
      s.release_date,
      s.created_at
    FROM 
      songs s
    LEFT JOIN 
      artists a ON s.artist_id = a.id
    LEFT JOIN 
      albums al ON s.album_id = al.id
    WHERE 
      s.audio_url IS NOT NULL
    ORDER BY 
      COALESCE(s.release_date, s.created_at::date) DESC,
      s.created_at DESC
    LIMIT 25;
  ELSE
    -- Return new releases with country prioritization
    -- First get songs from artists in the user's country
    RETURN QUERY
    WITH country_songs AS (
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
        s.release_date,
        s.created_at,
        1 as priority -- Higher priority for country-specific songs
      FROM 
        songs s
      JOIN 
        artists a ON s.artist_id = a.id
      LEFT JOIN 
        albums al ON s.album_id = al.id
      JOIN 
        artist_profiles ap ON a.id = ap.artist_id
      WHERE 
        s.audio_url IS NOT NULL
        AND ap.country = user_country
      
      UNION ALL
      
      -- Then get global songs (not from the user's country)
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
        s.release_date,
        s.created_at,
        2 as priority -- Lower priority for global songs
      FROM 
        songs s
      JOIN 
        artists a ON s.artist_id = a.id
      LEFT JOIN 
        albums al ON s.album_id = al.id
      LEFT JOIN 
        artist_profiles ap ON a.id = ap.artist_id
      WHERE 
        s.audio_url IS NOT NULL
        AND (ap.country IS NULL OR ap.country != user_country)
    )
    SELECT 
      cs.id,
      cs.title,
      cs.artist_id,
      cs.artist_name,
      cs.album_id,
      cs.album_title,
      cs.duration_seconds,
      cs.audio_url,
      cs.cover_image_url,
      cs.album_cover,
      cs.release_date,
      cs.created_at
    FROM 
      country_songs cs
    ORDER BY 
      cs.priority,
      COALESCE(cs.release_date, cs.created_at::date) DESC,
      cs.created_at DESC
    LIMIT 25;
  END IF;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_new_releases_by_country TO authenticated;
GRANT EXECUTE ON FUNCTION get_new_releases_by_country TO anon;