/*
  # Add User Contribution Diagnostic Function

  ## Purpose
  Help users understand why some activities didn't award points.
  Shows activity attempts vs actual rewards, plus time-gating rules.

  ## Function
  - Shows what activities the user performed today
  - Shows which ones were rewarded vs blocked
  - Explains time-gating rules
*/

-- Create function to show user's contribution activity breakdown
CREATE OR REPLACE FUNCTION get_user_contribution_breakdown(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  category text,
  activity_name text,
  times_earned_today integer,
  points_earned_today integer,
  can_earn_again text,
  max_per_day text,
  last_earned_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_today date := CURRENT_DATE;
BEGIN
  -- Use provided user_id or current user
  v_user_id := COALESCE(p_user_id, auth.uid());
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated or provide user_id';
  END IF;

  RETURN QUERY
  WITH user_activities_today AS (
    SELECT 
      lc.activity_type,
      COUNT(*) as times_earned,
      SUM(lc.contribution_points) as points_earned,
      MAX(lc.created_at) as last_earned
    FROM listener_contributions lc
    WHERE lc.user_id = v_user_id
      AND lc.created_at >= v_today
    GROUP BY lc.activity_type
  )
  SELECT 
    CASE 
      WHEN ca.activity_type LIKE '%playlist%' THEN 'Playlist Contributions'
      WHEN ca.activity_type IN ('early_discovery', 'early_supporter', 'artist_discovery') THEN 'Discovery & Exploration'
      WHEN ca.activity_type LIKE '%listening%' OR ca.activity_type LIKE '%listener%' OR ca.activity_type = 'song_completion_bonus' OR ca.activity_type = 'genre_explorer' THEN 'Listening Engagement'
      WHEN ca.activity_type IN ('curation_featured', 'curation_engagement') THEN 'Curation'
      ELSE 'Community Engagement'
    END::text as category,
    ca.activity_name::text,
    COALESCE(uat.times_earned, 0)::integer as times_earned_today,
    COALESCE(uat.points_earned, 0)::integer as points_earned_today,
    CASE 
      WHEN NOT ca.is_active THEN 'Activity is disabled'
      WHEN ca.activity_type IN ('song_like', 'video_like') THEN 'Once per item'
      WHEN ca.activity_type IN ('content_comment', 'content_share', 'daily_active_listener', 'daily_listener_10', 'daily_listener_20', 'daily_listener_50', 'song_completion_bonus') THEN
        CASE WHEN uat.times_earned >= 1 THEN 'Tomorrow' ELSE 'Now' END
      WHEN ca.activity_type IN ('genre_explorer', 'artist_discovery') THEN 
        CASE WHEN uat.times_earned >= 1 THEN 'Next week' ELSE 'Now' END
      WHEN ca.activity_type LIKE '%streak%' THEN 'When streak reached'
      WHEN ca.activity_type = 'artist_follow' THEN 'Once per artist'
      WHEN ca.activity_type = 'playlist_created' THEN 'Per new playlist'
      ELSE 'Now'
    END::text as can_earn_again,
    CASE 
      WHEN ca.activity_type IN ('song_like', 'video_like') THEN 'Once per item (no daily limit)'
      WHEN ca.activity_type IN ('content_comment', 'content_share', 'daily_active_listener', 'daily_listener_10', 'daily_listener_20', 'daily_listener_50', 'song_completion_bonus') THEN 'Once per day'
      WHEN ca.activity_type IN ('genre_explorer', 'artist_discovery') THEN 'Once per week'
      WHEN ca.activity_type LIKE '%streak%' THEN 'Once per streak achievement'
      WHEN ca.activity_type = 'artist_follow' THEN 'Once per artist'
      WHEN ca.activity_type = 'playlist_created' THEN 'Unlimited'
      ELSE 'Varies'
    END::text as max_per_day,
    uat.last_earned::timestamptz as last_earned_at
  FROM contribution_activities ca
  LEFT JOIN user_activities_today uat ON uat.activity_type = ca.activity_type
  WHERE ca.is_active = true
    OR uat.times_earned IS NOT NULL
  ORDER BY 
    category,
    COALESCE(uat.points_earned, 0) DESC,
    ca.activity_name;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_user_contribution_breakdown TO authenticated;

COMMENT ON FUNCTION get_user_contribution_breakdown IS
'Shows breakdown of user contributions today, including what they earned and when they can earn again. Helps users understand time-gating rules.';

-- Create a simpler function to show today's total
CREATE OR REPLACE FUNCTION get_user_points_today(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  total_contributions integer,
  total_points_earned integer,
  unique_activities integer,
  breakdown jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_today date := CURRENT_DATE;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated or provide user_id';
  END IF;

  RETURN QUERY
  SELECT 
    COUNT(*)::integer as total_contributions,
    SUM(contribution_points)::integer as total_points_earned,
    COUNT(DISTINCT activity_type)::integer as unique_activities,
    jsonb_object_agg(
      activity_type,
      jsonb_build_object(
        'count', count,
        'points', points
      )
    ) as breakdown
  FROM (
    SELECT 
      activity_type,
      COUNT(*) as count,
      SUM(contribution_points) as points
    FROM listener_contributions
    WHERE user_id = v_user_id
      AND created_at >= v_today
    GROUP BY activity_type
  ) activities;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_points_today TO authenticated;

COMMENT ON FUNCTION get_user_points_today IS
'Quick summary of points earned today with activity breakdown.';
