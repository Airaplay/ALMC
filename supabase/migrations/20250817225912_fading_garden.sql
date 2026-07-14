/*
  # Create Wave Albums Function

  1. New Functions
    - `get_wave_albums()` - Fetches top 25 trending albums based on play counts in last 6 hours
      - Returns album details with aggregated play counts
      - Ranks by total plays across all songs in each album
      - Includes album metadata, artist info, and user IDs for linking
      - Uses SECURITY DEFINER to bypass RLS for global access

  2. Security
    - Grant EXECUTE permissions to anon and authenticated roles
    - Function uses SECURITY DEFINER for global data access
    - Returns only approved content

  3. Performance
    - Optimized query with proper joins and aggregations
    - Limited to last 6 hours for trending calculation
    - Returns top 25 results only
*/

-- Create the get_wave_albums function
CREATE OR REPLACE FUNCTION public.get_wave_albums()
RETURNS TABLE (
  content_upload_id uuid,
  album_id uuid,
  album_title text,
  album_description text,
  album_cover_url text,
  artist_name text,
  artist_user_id uuid,
  total_plays_last_6h bigint,
  song_count bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cu.id as content_upload_id,
    a.id as album_id,
    a.title as album_title,
    a.description as album_description,
    a.cover_image_url as album_cover_url,
    ar.name as artist_name,
    ap.user_id as artist_user_id,
    COALESCE(SUM(
      CASE 
        WHEN lh.listened_at >= NOW() - INTERVAL '6 hours' 
        THEN 1 
        ELSE 0 
      END
    ), 0) as total_plays_last_6h,
    COUNT(DISTINCT s.id) as song_count,
    cu.created_at
  FROM content_uploads cu
  INNER JOIN albums a ON a.id = (cu.metadata->>'album_id')::uuid
  INNER JOIN artists ar ON ar.id = a.artist_id
  INNER JOIN artist_profiles ap ON ap.artist_id = ar.id
  LEFT JOIN songs s ON s.album_id = a.id
  LEFT JOIN listening_history lh ON lh.song_id = s.id
  WHERE 
    cu.content_type = 'album'
    AND cu.status = 'approved'
    AND a.id IS NOT NULL
    AND ar.id IS NOT NULL
    AND ap.user_id IS NOT NULL
  GROUP BY 
    cu.id, 
    a.id, 
    a.title, 
    a.description, 
    a.cover_image_url, 
    ar.name, 
    ap.user_id,
    cu.created_at
  HAVING COUNT(DISTINCT s.id) > 0  -- Only include albums with songs
  ORDER BY 
    total_plays_last_6h DESC,
    cu.created_at DESC
  LIMIT 25;
END;
$$;

-- Grant execute permissions to anon and authenticated roles
GRANT EXECUTE ON FUNCTION public.get_wave_albums() TO anon;
GRANT EXECUTE ON FUNCTION public.get_wave_albums() TO authenticated;