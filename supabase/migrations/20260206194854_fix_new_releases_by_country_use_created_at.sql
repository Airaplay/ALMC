/*
  # Fix get_new_releases_by_country to use created_at

  1. Changes
    - Drop and recreate with updated return type
    - Replace release_date filter with created_at (no songs have release_date set)
    - Add artist_user_id, featured_artists, play_count to return columns
    - Use local-first, global-fill pattern

  2. Important Notes
    - The old function filtered by release_date which returned 0 rows
    - Now uses created_at with a 30-day window
    - Local content appears first, then global content fills remaining slots
*/

DROP FUNCTION IF EXISTS public.get_new_releases_by_country(text);

CREATE OR REPLACE FUNCTION public.get_new_releases_by_country(user_country text DEFAULT NULL::text)
RETURNS TABLE(
  id uuid,
  title text,
  artist_name text,
  artist_user_id uuid,
  duration_seconds integer,
  audio_url text,
  cover_image_url text,
  play_count integer,
  featured_artists text[],
  created_at timestamptz,
  is_local boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH local_releases AS (
    SELECT
      s.id,
      s.title,
      a.name as artist_name,
      ap.user_id as artist_user_id,
      COALESCE(s.duration_seconds, 0) as duration_seconds,
      s.audio_url,
      s.cover_image_url,
      COALESCE(s.play_count, 0) as play_count,
      s.featured_artists,
      s.created_at,
      true as is_local
    FROM songs s
    LEFT JOIN artists a ON s.artist_id = a.id
    LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
    LEFT JOIN users u ON ap.user_id = u.id
    WHERE s.audio_url IS NOT NULL
      AND s.album_id IS NULL
      AND s.created_at >= NOW() - INTERVAL '30 days'
      AND user_country IS NOT NULL
      AND (u.country = user_country)
    ORDER BY s.created_at DESC
    LIMIT 30
  ),
  global_releases AS (
    SELECT
      s.id,
      s.title,
      a.name as artist_name,
      ap.user_id as artist_user_id,
      COALESCE(s.duration_seconds, 0) as duration_seconds,
      s.audio_url,
      s.cover_image_url,
      COALESCE(s.play_count, 0) as play_count,
      s.featured_artists,
      s.created_at,
      false as is_local
    FROM songs s
    LEFT JOIN artists a ON s.artist_id = a.id
    LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
    WHERE s.audio_url IS NOT NULL
      AND s.album_id IS NULL
      AND s.created_at >= NOW() - INTERVAL '30 days'
      AND s.id NOT IN (SELECT lr.id FROM local_releases lr)
    ORDER BY s.created_at DESC
    LIMIT 30
  ),
  combined AS (
    SELECT * FROM local_releases
    UNION ALL
    SELECT * FROM global_releases
  )
  SELECT
    c.id,
    c.title,
    c.artist_name,
    c.artist_user_id,
    c.duration_seconds,
    c.audio_url,
    c.cover_image_url,
    c.play_count,
    c.featured_artists,
    c.created_at,
    c.is_local
  FROM combined c
  ORDER BY c.is_local DESC, c.created_at DESC
  LIMIT 30;
END;
$function$;
