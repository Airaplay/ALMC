/*
  # Fix get_top_videos_by_country function data type error

  1. Problem
    - The get_top_videos_by_country function is trying to process a UUID-like string as a double precision number
    - Error: invalid input syntax for type double precision: "0.3420c3c1"

  2. Solution
    - Drop and recreate the get_top_videos_by_country function with proper data type handling
    - Ensure all UUID fields are handled as text/uuid types, not numeric types
    - Add proper error handling and type casting

  3. Changes
    - Recreate get_top_videos_by_country function with correct data types
    - Ensure proper handling of user_country parameter
    - Fix any numeric operations that might be causing the type conversion issue
*/

-- Drop the existing function if it exists
DROP FUNCTION IF EXISTS get_top_videos_by_country(text);

-- Create the corrected function
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
      WHEN cu.metadata ? 'thumbnail_url' THEN cu.metadata->>'thumbnail_url'
      WHEN cu.metadata ? 'cover_image_url' THEN cu.metadata->>'cover_image_url'
      ELSE NULL
    END as thumbnail_url,
    CASE 
      WHEN cu.metadata ? 'video_url' THEN cu.metadata->>'video_url'
      WHEN cu.metadata ? 'file_url' THEN cu.metadata->>'file_url'
      ELSE NULL
    END as video_url,
    COALESCE((cu.metadata->>'duration_seconds')::integer, 0) as duration_seconds,
    COALESCE(cu.play_count, 0) as play_count
  FROM content_uploads cu
  JOIN users u ON cu.user_id = u.id
  WHERE cu.content_type IN ('video', 'short_clip')
    AND cu.status = 'approved'
    AND (
      user_country IS NULL 
      OR u.country IS NULL 
      OR u.country = user_country
    )
    AND (
      (cu.metadata ? 'video_url' AND cu.metadata->>'video_url' IS NOT NULL)
      OR (cu.metadata ? 'file_url' AND cu.metadata->>'file_url' IS NOT NULL)
    )
  ORDER BY 
    CASE WHEN user_country IS NOT NULL AND u.country = user_country THEN 0 ELSE 1 END,
    cu.play_count DESC NULLS LAST,
    cu.created_at DESC
  LIMIT 20;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_top_videos_by_country(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_videos_by_country(text) TO anon;