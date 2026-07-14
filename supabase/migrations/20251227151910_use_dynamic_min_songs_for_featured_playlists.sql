/*
  # Use Dynamic Minimum Songs Setting for Featured Playlists
  
  ## Overview
  Updates the get_featured_playlists function to use the dynamic minimum songs
  setting from curator_settings instead of a hardcoded value.
  
  ## Changes
  - Function now reads min_songs from curator_settings.curator_eligibility
  - Falls back to 5 songs if setting is not configured
  - Respects admin configuration for flexibility
  
  ## Benefits
  - Admins can adjust minimum requirement without code changes
  - More flexible content curation
  - Matches the value shown in admin dashboard (currently 6 songs)
*/

CREATE OR REPLACE FUNCTION get_featured_playlists(limit_count integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  cover_image_url text,
  song_count integer,
  play_count integer,
  curator_id uuid,
  curator_name text,
  curator_avatar text,
  featured_at timestamptz,
  created_at timestamptz
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_min_songs integer;
BEGIN
  -- Get minimum songs requirement from curator_settings
  SELECT COALESCE(
    (setting_value->>'min_songs')::integer,
    5  -- Default fallback to 5 songs
  ) INTO v_min_songs
  FROM curator_settings
  WHERE setting_key = 'curator_eligibility';

  RETURN QUERY
  SELECT
    p.id,
    p.title,
    p.description,
    p.cover_image_url,
    p.song_count,
    p.play_count,
    p.user_id as curator_id,
    u.display_name as curator_name,
    u.avatar_url as curator_avatar,
    p.featured_at,
    p.created_at
  FROM playlists p
  JOIN users u ON p.user_id = u.id
  WHERE p.is_public = true
    AND p.song_count >= v_min_songs
  ORDER BY
    p.play_count DESC,
    p.created_at DESC
  LIMIT limit_count;
END;
$$;

-- Ensure function is accessible to everyone
GRANT EXECUTE ON FUNCTION get_featured_playlists(integer) TO authenticated, anon;
