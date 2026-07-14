/*
  # Fix record_listener_contribution Function CASE Statement

  ## Problem
  The function has a CASE statement without an ELSE clause, causing it to fail
  when recording social activities (song_like, video_like, content_comment, 
  artist_follow, content_share) that were added later.

  ## Solution
  Update the function to properly categorize all activity types including
  social activities into engagement_points, and add an ELSE clause for any
  future activity types.

  ## Changes
  - Add cases for social activity types (song_like, video_like, etc.)
  - Add ELSE clause to prevent errors for unhandled activity types
  - Social activities go into engagement_points category
*/

CREATE OR REPLACE FUNCTION record_listener_contribution(
  p_user_id uuid,
  p_activity_type text,
  p_reference_id uuid DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_points integer;
BEGIN
  -- Get base reward points for this activity
  SELECT base_reward_points INTO v_points
  FROM contribution_activities
  WHERE activity_type = p_activity_type
  AND is_active = true;

  -- If activity doesn't exist or inactive, exit
  IF v_points IS NULL THEN
    RETURN;
  END IF;

  -- Insert contribution record
  INSERT INTO listener_contributions (
    user_id,
    activity_type,
    reference_id,
    reference_type,
    contribution_points,
    metadata
  ) VALUES (
    p_user_id,
    p_activity_type,
    p_reference_id,
    p_reference_type,
    v_points,
    p_metadata
  );

  -- Update user's contribution score
  INSERT INTO listener_contribution_scores (
    user_id,
    total_points,
    current_period_points,
    updated_at
  ) VALUES (
    p_user_id,
    v_points,
    v_points,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_points = listener_contribution_scores.total_points + v_points,
    current_period_points = listener_contribution_scores.current_period_points + v_points,
    updated_at = now();

  -- Update specific category points
  CASE p_activity_type
    -- Playlist activities
    WHEN 'playlist_created', 'playlist_play', 'playlist_quality_bonus' THEN
      UPDATE listener_contribution_scores
      SET playlist_creation_points = playlist_creation_points + v_points
      WHERE user_id = p_user_id;
    
    -- Discovery activities
    WHEN 'early_discovery', 'early_supporter', 'artist_discovery' THEN
      UPDATE listener_contribution_scores
      SET discovery_points = discovery_points + v_points
      WHERE user_id = p_user_id;
    
    -- Curation activities
    WHEN 'curation_featured', 'curation_engagement' THEN
      UPDATE listener_contribution_scores
      SET curation_points = curation_points + v_points
      WHERE user_id = p_user_id;
    
    -- Engagement activities (includes social activities and listening engagement)
    WHEN 'daily_engagement', 'song_like', 'video_like', 'content_comment', 
         'artist_follow', 'content_share', 'video_completion',
         'daily_active_listener', 'daily_listener_10', 'daily_listener_20',
         'genre_explorer', 'song_completion_bonus', 'listening_streak_3',
         'listening_streak_7', 'listening_streak_30', 'referral_contribution' THEN
      UPDATE listener_contribution_scores
      SET engagement_points = engagement_points + v_points
      WHERE user_id = p_user_id;
    
    -- Default case for any future activity types
    ELSE
      -- Don't fail, just don't categorize
      NULL;
  END CASE;

END;
$$;

-- Add comment explaining the categorization
COMMENT ON FUNCTION record_listener_contribution IS 
'Records a listener contribution and updates their score. Activity types are categorized as:
- Playlist activities (playlist_created, playlist_play, playlist_quality_bonus)
- Discovery activities (early_discovery, early_supporter, artist_discovery)
- Curation activities (curation_featured, curation_engagement)
- Engagement activities (all social activities, listening milestones, streaks, referrals)';
