/*
  # Add user_id to Top 1% Artists Function

  1. Changes
    - Modify `get_user_top_1_percent_artists` function to include `user_id` field
    - This allows navigation to the user's public profile page

  2. Details
    - Adds `user_id` field from artist_profiles table
    - Maintains all existing functionality
    - No breaking changes to existing columns
*/

-- Drop existing function
DROP FUNCTION IF EXISTS get_user_top_1_percent_artists(uuid);

-- Recreate function with user_id field
CREATE OR REPLACE FUNCTION get_user_top_1_percent_artists(p_user_id uuid)
RETURNS TABLE(
  artist_id uuid,
  user_id uuid,
  artist_name text,
  artist_photo text,
  is_verified boolean,
  total_plays integer,
  total_treats_sent integer,
  loyalty_score integer,
  rank_position integer,
  total_listeners integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ap.id as artist_id,
    ap.user_id,
    ap.stage_name as artist_name,
    ap.profile_photo_url as artist_photo,
    ap.is_verified,
    als.total_plays,
    als.total_treats_sent,
    als.loyalty_score,
    als.rank_position,
    (
      SELECT COUNT(*)::integer
      FROM artist_listener_stats als2
      WHERE als2.artist_id = ap.id
    ) as total_listeners
  FROM artist_listener_stats als
  JOIN artist_profiles ap ON ap.id = als.artist_id
  WHERE als.user_id = p_user_id
    AND als.is_top_1_percent = true
  ORDER BY als.loyalty_score DESC, als.rank_position ASC;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_top_1_percent_artists(uuid) TO authenticated, anon;
