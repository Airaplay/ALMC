/*
  # Create function to get daily mix tracks with artist names

  1. Purpose
    - Efficiently fetch daily mix tracks with artist names in a single query
    - Handles artist name resolution with proper fallback chain
    - Returns all track data needed for display

  2. Returns
    - song_id: UUID
    - track_position: integer
    - explanation: text
    - recommendation_type: text
    - is_familiar: boolean
    - title: text
    - artist_id: UUID
    - artist_name: text (stage_name → display_name → username → email → 'Unknown Artist')
    - cover_image_url: text
    - duration_seconds: integer
    - audio_url: text
    - play_count: integer

  3. Performance
    - Single query with JOINs instead of multiple round trips
    - Uses COALESCE for efficient fallback logic
*/

CREATE OR REPLACE FUNCTION get_daily_mix_tracks_with_artists(p_mix_id uuid)
RETURNS TABLE (
  song_id uuid,
  track_position integer,
  explanation text,
  recommendation_type text,
  is_familiar boolean,
  title text,
  artist_id uuid,
  artist_name text,
  cover_image_url text,
  duration_seconds integer,
  audio_url text,
  play_count integer
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dmt.song_id,
    dmt.position as track_position,
    dmt.explanation,
    dmt.recommendation_type,
    dmt.is_familiar,
    s.title,
    s.artist_id,
    COALESCE(
      ap.stage_name,
      u.display_name,
      u.username,
      SPLIT_PART(u.email, '@', 1),
      'Unknown Artist'
    ) as artist_name,
    s.cover_image_url,
    s.duration_seconds,
    s.audio_url,
    s.play_count
  FROM daily_mix_tracks dmt
  INNER JOIN songs s ON dmt.song_id = s.id
  LEFT JOIN artist_profiles ap ON s.artist_id = ap.user_id
  LEFT JOIN users u ON s.artist_id = u.id
  WHERE dmt.mix_id = p_mix_id
  ORDER BY dmt.position;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_daily_mix_tracks_with_artists(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_mix_tracks_with_artists(uuid) TO anon;
