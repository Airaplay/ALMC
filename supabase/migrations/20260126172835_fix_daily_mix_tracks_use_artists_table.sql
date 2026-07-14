/*
  # Fix daily mix tracks to use artists table

  1. Changes
    - Updated get_daily_mix_tracks_with_artists function to join with artists table
    - The artists table contains the actual artist names in the 'name' column
    - Previous version incorrectly joined with users/artist_profiles tables

  2. Data Structure
    - songs.artist_id → artists.id
    - artists.name contains the artist display name
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
    COALESCE(a.name, 'Unknown Artist') as artist_name,
    s.cover_image_url,
    s.duration_seconds,
    s.audio_url,
    s.play_count
  FROM daily_mix_tracks dmt
  INNER JOIN songs s ON dmt.song_id = s.id
  LEFT JOIN artists a ON s.artist_id = a.id
  WHERE dmt.mix_id = p_mix_id
  ORDER BY dmt.position;
END;
$$;
