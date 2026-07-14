/*
  # Creator Top Fans System

  1. New Functions
    - `get_artist_top_fans(p_artist_id uuid)` - Returns top 5 supporters for a creator
    
  2. Changes
    - Query artist_listener_stats to find top supporters
    - Filter by minimum 20 plays threshold
    - Filter by is_top_1_percent = true
    - Return top 5 ordered by loyalty score
    - Include user details and engagement metrics
    
  3. Security
    - SECURITY DEFINER with proper search_path
    - RLS enforced - creators can only view their own fans
    - Grant execute to authenticated users
*/

-- Function: Get artist's top fans
CREATE OR REPLACE FUNCTION get_artist_top_fans(p_artist_id uuid)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  avatar_url text,
  total_plays integer,
  total_treats_sent integer,
  loyalty_score integer,
  rank_position integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify the requesting user owns the artist profile
  IF NOT EXISTS (
    SELECT 1 FROM artist_profiles
    WHERE id = p_artist_id
    AND user_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: You can only view your own top fans';
  END IF;

  RETURN QUERY
  SELECT
    u.id as user_id,
    COALESCE(u.display_name, u.email) as display_name,
    u.avatar_url,
    als.total_plays,
    als.total_treats_sent,
    als.loyalty_score,
    als.rank_position
  FROM artist_listener_stats als
  JOIN users u ON u.id = als.user_id
  WHERE als.artist_id = p_artist_id
    AND als.is_top_1_percent = true
    AND als.total_plays >= 20
  ORDER BY als.loyalty_score DESC, als.rank_position ASC
  LIMIT 5;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_artist_top_fans(uuid) TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION get_artist_top_fans(uuid) IS 
'Returns the top 5 supporters for a creator with minimum 20 plays. Only accessible by the artist owner or admins.';
