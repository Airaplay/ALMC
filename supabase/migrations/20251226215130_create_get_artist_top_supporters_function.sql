/*
  # Add Function to Get Artist's Top Supporters

  ## Overview
  Creates a function to retrieve top supporters/fans for an artist,
  showing who their biggest supporters are in the Top 1% Club.

  ## New Functions
  
  ### `get_artist_top_supporters(p_artist_id uuid, p_limit integer)`
  Returns top supporters for an artist with their stats:
  - user_id, username, avatar_url
  - total_plays, total_treats_sent
  - loyalty_score, rank_position
  - is_top_1_percent status

  ## Security
  - Function is SECURITY DEFINER for cross-table joins
  - Public read access (anyone can see top supporters)
  - Returns only public user information
*/

-- Function: Get artist's top supporters
CREATE OR REPLACE FUNCTION get_artist_top_supporters(
  p_artist_id uuid,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  user_id uuid,
  username text,
  avatar_url text,
  full_name text,
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
    u.id as user_id,
    u.username,
    u.avatar_url,
    u.full_name,
    als.total_plays,
    als.total_treats_sent,
    als.loyalty_score,
    als.rank_position,
    (
      SELECT COUNT(*)::integer
      FROM artist_listener_stats als2
      WHERE als2.artist_id = p_artist_id
    ) as total_listeners
  FROM artist_listener_stats als
  JOIN users u ON u.id = als.user_id
  WHERE als.artist_id = p_artist_id
    AND als.is_top_1_percent = true
  ORDER BY als.loyalty_score DESC, als.rank_position ASC
  LIMIT p_limit;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_artist_top_supporters(uuid, integer) TO authenticated, anon;
