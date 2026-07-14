/*
  # Create get_top_videos_last_3h function

  1. New Functions
    - `get_top_videos_last_3h()` - Returns top 25 videos/clips by views in last 3 hours
      - Fetches both video and short_clip content types
      - Ranks by total views (listening_history) in last 3 hours
      - Returns content_upload_id, title, creator info, metadata
      - Global access with SECURITY DEFINER
      - Only approved content

  2. Security
    - Grant EXECUTE to anon and authenticated roles
    - Uses SECURITY DEFINER to bypass RLS for global access
    - Ensures data is available to all users regardless of auth status

  3. Performance
    - Optimized query with proper joins and filtering
    - Indexes on listening_history.listened_at for performance
    - Limits results to top 25 for efficiency
*/

-- Create function to get top videos/clips by views in last 3 hours
CREATE OR REPLACE FUNCTION public.get_top_videos_last_3h()
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
  play_count bigint,
  views_last_3h bigint
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
    COALESCE(u.display_name, 'Unknown Creator') as creator_name,
    u.avatar_url as creator_avatar,
    (cu.metadata->>'thumbnail_url')::text as thumbnail_url,
    (cu.metadata->>'video_url')::text as video_url,
    COALESCE((cu.metadata->>'duration_seconds')::integer, 0) as duration_seconds,
    COALESCE(cu.play_count, 0) as play_count,
    COALESCE(recent_views.view_count, 0) as views_last_3h
  FROM content_uploads cu
  LEFT JOIN users u ON cu.user_id = u.id
  LEFT JOIN (
    SELECT 
      lh.content_upload_id,
      COUNT(*) as view_count
    FROM listening_history lh
    WHERE 
      lh.content_upload_id IS NOT NULL
      AND lh.listened_at >= NOW() - INTERVAL '3 hours'
    GROUP BY lh.content_upload_id
  ) recent_views ON cu.id = recent_views.content_upload_id
  WHERE 
    cu.content_type IN ('video', 'short_clip')
    AND cu.status = 'approved'
    AND (cu.metadata->>'video_url') IS NOT NULL
  ORDER BY 
    COALESCE(recent_views.view_count, 0) DESC,
    cu.play_count DESC,
    cu.created_at DESC
  LIMIT 25;
END;
$$;

-- Grant execute permissions to all users
GRANT EXECUTE ON FUNCTION public.get_top_videos_last_3h() TO anon;
GRANT EXECUTE ON FUNCTION public.get_top_videos_last_3h() TO authenticated;