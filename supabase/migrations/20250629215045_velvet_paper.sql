/*
  # Fix get_top_videos_by_country function

  1. Changes
    - Drop the existing function first to avoid return type conflicts
    - Recreate the function with the correct return type
    - Ensure proper handling of metadata fields
    - Grant execute permissions to both authenticated and anonymous users

  2. Security
    - Function runs with security definer to ensure proper permissions
    - Results are limited to 20 items for performance
*/

-- Drop the existing function first to avoid return type conflicts
DROP FUNCTION IF EXISTS get_top_videos_by_country(text);

-- Create function to get top videos by country
CREATE OR REPLACE FUNCTION get_top_videos_by_country(user_country text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  title text,
  content_type text,
  user_id uuid,
  creator_name text,
  creator_avatar text,
  thumbnail_url text,
  video_url text,
  duration_seconds integer,
  play_count integer
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cu.id,
    cu.title,
    cu.content_type,
    cu.user_id,
    COALESCE(u.display_name, u.username, 'Unknown Creator') as creator_name,
    u.avatar_url as creator_avatar,
    CASE 
      WHEN cu.metadata->>'thumbnail_url' IS NOT NULL THEN cu.metadata->>'thumbnail_url'
      WHEN cu.metadata->>'cover_url' IS NOT NULL THEN cu.metadata->>'cover_url'
      ELSE NULL
    END as thumbnail_url,
    CASE 
      WHEN cu.content_type = 'video' AND cu.metadata->>'video_url' IS NOT NULL THEN cu.metadata->>'video_url'
      WHEN cu.content_type = 'short_clip' AND cu.metadata->>'file_url' IS NOT NULL THEN cu.metadata->>'file_url'
      ELSE NULL
    END as video_url,
    COALESCE(
      CASE 
        WHEN cu.metadata->>'duration_seconds' ~ '^[0-9]+$' 
        THEN (cu.metadata->>'duration_seconds')::INTEGER
        ELSE 0
      END, 
      0
    ) as duration_seconds,
    COALESCE(cu.play_count, 0) as play_count
  FROM content_uploads cu
  JOIN users u ON cu.user_id = u.id
  WHERE 
    cu.status = 'approved'
    AND cu.content_type IN ('video', 'short_clip')
    AND (
      user_country IS NULL 
      OR u.country = user_country 
      OR u.country IS NULL
    )
  ORDER BY 
    COALESCE(cu.play_count, 0) DESC,
    cu.created_at DESC
  LIMIT 20;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_top_videos_by_country(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_videos_by_country(text) TO anon;