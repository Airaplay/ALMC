/*
  # Create Must Watch Videos and Clips Function

  1. New Function
    - `get_random_videos_and_clips()` - Returns 25 random videos and clips
    - Fetches from content_uploads where content_type is 'video' or 'short_clip'
    - Only includes approved content with valid video URLs
    - Joins with users table for creator information
    - Uses SECURITY DEFINER for global access

  2. Security
    - Grant EXECUTE permissions to anon and authenticated roles
    - Function bypasses RLS for global content access
*/

-- Create function to get random videos and clips
CREATE OR REPLACE FUNCTION public.get_random_videos_and_clips()
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  content_type text,
  video_url text,
  thumbnail_url text,
  play_count integer,
  duration_seconds integer,
  created_at timestamptz,
  creator_id uuid,
  creator_name text,
  creator_avatar text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cu.id,
    cu.title,
    cu.description,
    cu.content_type,
    COALESCE(cu.metadata->>'video_url', cu.metadata->>'file_url') as video_url,
    COALESCE(cu.metadata->>'thumbnail_url', cu.metadata->>'cover_url') as thumbnail_url,
    COALESCE(cu.play_count, 0) as play_count,
    COALESCE((cu.metadata->>'duration_seconds')::integer, 0) as duration_seconds,
    cu.created_at,
    cu.user_id as creator_id,
    COALESCE(u.display_name, 'Unknown Creator') as creator_name,
    u.avatar_url as creator_avatar
  FROM content_uploads cu
  LEFT JOIN users u ON cu.user_id = u.id
  WHERE cu.content_type IN ('video', 'short_clip')
    AND cu.status = 'approved'
    AND (cu.metadata->>'video_url' IS NOT NULL OR cu.metadata->>'file_url' IS NOT NULL)
  ORDER BY RANDOM()
  LIMIT 25;
END;
$$;

-- Grant execute permissions to anon and authenticated users
GRANT EXECUTE ON FUNCTION public.get_random_videos_and_clips() TO anon;
GRANT EXECUTE ON FUNCTION public.get_random_videos_and_clips() TO authenticated;