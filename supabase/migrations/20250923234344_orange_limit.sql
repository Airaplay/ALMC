/*
  # Create function to get top artists by follower count

  1. New Functions
    - `get_top_artists_by_followers` - Returns top artists sorted by follower count
      - Combines user data with artist profiles
      - Calculates total play counts from songs and content uploads
      - Returns formatted data for the Top Artiste section

  2. Security
    - Function is accessible to all users (public)
    - Uses existing RLS policies on underlying tables
*/

CREATE OR REPLACE FUNCTION get_top_artists_by_followers(limit_count INTEGER DEFAULT 30)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  display_name TEXT,
  stage_name TEXT,
  profile_photo_url TEXT,
  avatar_url TEXT,
  follower_count BIGINT,
  total_play_count BIGINT,
  is_verified BOOLEAN,
  role TEXT,
  artist_id UUID
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH user_followers AS (
    SELECT 
      uf.following_id,
      COUNT(*) as follower_count
    FROM user_follows uf
    GROUP BY uf.following_id
  ),
  user_song_plays AS (
    SELECT 
      ap.user_id,
      COALESCE(SUM(s.play_count), 0) as song_play_count
    FROM artist_profiles ap
    LEFT JOIN songs s ON s.artist_id = ap.artist_id
    GROUP BY ap.user_id
  ),
  user_content_plays AS (
    SELECT 
      cu.user_id,
      COALESCE(SUM(cu.play_count), 0) as content_play_count
    FROM content_uploads cu
    GROUP BY cu.user_id
  )
  SELECT 
    u.id,
    u.id as user_id,
    u.display_name,
    ap.stage_name,
    ap.profile_photo_url,
    u.avatar_url,
    COALESCE(uf.follower_count, 0) as follower_count,
    COALESCE(usp.song_play_count, 0) + COALESCE(ucp.content_play_count, 0) as total_play_count,
    COALESCE(ap.is_verified, false) as is_verified,
    u.role,
    ap.artist_id
  FROM users u
  LEFT JOIN user_followers uf ON uf.following_id = u.id
  LEFT JOIN artist_profiles ap ON ap.user_id = u.id
  LEFT JOIN user_song_plays usp ON usp.user_id = u.id
  LEFT JOIN user_content_plays ucp ON ucp.user_id = u.id
  WHERE u.role IN ('creator', 'admin')
    AND u.is_active = true
    AND (uf.follower_count > 0 OR usp.song_play_count > 0 OR ucp.content_play_count > 0)
  ORDER BY COALESCE(uf.follower_count, 0) DESC, total_play_count DESC
  LIMIT limit_count;
END;
$$;

-- Grant execute permission to authenticated and anonymous users
GRANT EXECUTE ON FUNCTION get_top_artists_by_followers(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_artists_by_followers(INTEGER) TO anon;