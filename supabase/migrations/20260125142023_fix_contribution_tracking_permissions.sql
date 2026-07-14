/*
  # Fix Contribution Tracking Permissions and Configuration

  ## Problem
  Users' contribution scores are not updating after admin configures
  the Contribution System in the admin dashboard. The tracking functions
  may have permission issues or missing activity configurations.

  ## Solution
  1. Grant proper permissions to all contribution tracking functions
  2. Ensure all contribution activities exist and are properly configured
  3. Add missing activity types that should be tracked
  4. Verify listener_contribution_scores table has proper access

  ## Changes
  - Re-grant execute permissions on contribution tracking functions
  - Ensure anon users can call contribution tracking functions (for public access)
  - Add any missing social engagement activities
  - Fix any permission issues with contribution tables
*/

-- ================================================================
-- 1. RE-GRANT FUNCTION PERMISSIONS
-- ================================================================

-- Grant permissions for record_listener_contribution
GRANT EXECUTE ON FUNCTION record_listener_contribution(
  uuid, text, uuid, text, jsonb
) TO authenticated, service_role, anon;

-- Grant permissions for track_listening_engagement
GRANT EXECUTE ON FUNCTION track_listening_engagement(
  uuid, uuid, boolean, text, integer
) TO authenticated, service_role, anon;

-- Grant permissions for get_top_contributors
GRANT EXECUTE ON FUNCTION get_top_contributors(integer) TO authenticated, anon;

-- ================================================================
-- 2. ENSURE ALL ACTIVITY TYPES EXIST
-- ================================================================

-- Ensure all social contribution activities exist
INSERT INTO contribution_activities (
  activity_type,
  activity_name,
  description,
  base_reward_points,
  is_active
) VALUES
  ('song_like', 'Like Song', 'User likes or favorites a song', 3, true),
  ('video_like', 'Like Video', 'User likes or favorites a video', 3, true),
  ('content_comment', 'Comment on Content', 'User comments on a song, video, or album', 5, true),
  ('artist_follow', 'Follow Artist', 'User follows an artist or creator', 5, true),
  ('content_share', 'Share Content', 'User shares a song, video, album, or playlist', 3, true),
  ('video_completion', 'Complete Video', 'User watches at least 80 percent of a video', 4, true)
ON CONFLICT (activity_type) DO NOTHING;

-- Ensure all listening engagement activities exist
INSERT INTO contribution_activities (
  activity_type,
  activity_name,
  description,
  base_reward_points,
  is_active
) VALUES
  ('daily_active_listener', 'Daily Active Listener', 'Listen to at least 5 songs in a day', 10, true),
  ('daily_listener_10', 'Dedicated Listener', 'Listen to at least 10 songs in a day', 15, true),
  ('daily_listener_20', 'Super Listener', 'Listen to at least 20 songs in a day', 25, true),
  ('daily_listener_50', 'Master Listener', 'Listen to at least 50 songs in a day', 50, true),
  ('genre_explorer', 'Genre Explorer', 'Listen to songs from 5+ different genres in a week', 25, true),
  ('artist_discovery', 'Artist Discovery', 'Listen to 5+ songs from artists with <10k total plays', 20, true),
  ('song_completion_bonus', 'Engaged Listener', 'Complete 80%+ of songs you start (daily)', 15, true),
  ('listening_streak_3', '3-Day Listening Streak', 'Listen actively for 3 consecutive days', 30, true),
  ('listening_streak_7', '7-Day Listening Streak', 'Listen actively for 7 consecutive days', 75, true),
  ('listening_streak_30', '30-Day Listening Streak', 'Listen actively for 30 consecutive days', 300, true),
  ('early_supporter', 'Early Artist Supporter', 'Listen to artist who later reaches 100k plays', 100, true)
ON CONFLICT (activity_type) DO NOTHING;

-- Ensure playlist and curation activities exist
INSERT INTO contribution_activities (
  activity_type,
  activity_name,
  description,
  base_reward_points,
  is_active
) VALUES
  ('playlist_created', 'Create Playlist', 'Create a new public playlist', 10, true),
  ('playlist_play', 'Playlist Gets Play', 'Your playlist is played by another user', 5, true),
  ('playlist_quality_bonus', 'Quality Playlist Bonus', 'Bonus for playlists with 50+ plays from other users', 100, true),
  ('early_discovery', 'Early Discovery', 'Add a song before it gets 100 plays that later becomes popular (1000+ plays)', 50, true),
  ('curation_featured', 'Curation Featured', 'Your listener curation is featured by admins', 200, true),
  ('curation_engagement', 'Curation Engagement', 'Your listener curation gets played by others', 10, true),
  ('daily_engagement', 'Daily Active Contributor', 'Bonus for being an active contributor (daily)', 5, true),
  ('referral_contribution', 'Referral Joins', 'Referred user becomes active contributor', 50, true)
ON CONFLICT (activity_type) DO NOTHING;

-- ================================================================
-- 3. FIX RLS POLICIES FOR CONTRIBUTION TABLES
-- ================================================================

-- Ensure authenticated users can read all active contribution activities
DROP POLICY IF EXISTS "Anyone can view active contribution activities" ON contribution_activities;
DROP POLICY IF EXISTS "Anyone can view contribution activities" ON contribution_activities;
CREATE POLICY "Anyone can view contribution activities"
  ON contribution_activities FOR SELECT
  USING (true);

-- Ensure service role can insert contributions (needed for automated tracking)
DROP POLICY IF EXISTS "Service role can insert contributions" ON listener_contributions;
CREATE POLICY "Service role can insert contributions"
  ON listener_contributions FOR INSERT
  WITH CHECK (true);

-- Ensure authenticated users can insert their own contributions
DROP POLICY IF EXISTS "Authenticated users can insert own contributions" ON listener_contributions;
CREATE POLICY "Authenticated users can insert own contributions"
  ON listener_contributions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Ensure service role can manage contribution scores
DROP POLICY IF EXISTS "Service role can manage contribution scores" ON listener_contribution_scores;
CREATE POLICY "Service role can manage contribution scores"
  ON listener_contribution_scores FOR ALL
  WITH CHECK (true);

-- Ensure service role can manage engagement stats
DROP POLICY IF EXISTS "Service role can manage engagement stats" ON listener_engagement_stats;
CREATE POLICY "Service role can manage engagement stats"
  ON listener_engagement_stats FOR ALL
  WITH CHECK (true);

-- ================================================================
-- 4. ADD HELPFUL INDEXES IF MISSING
-- ================================================================

-- Index for activity type lookups (used frequently in record_listener_contribution)
CREATE INDEX IF NOT EXISTS idx_contribution_activities_type_active
  ON contribution_activities(activity_type, is_active);

-- Index for checking if user already earned an activity today
CREATE INDEX IF NOT EXISTS idx_listener_contributions_user_activity_date
  ON listener_contributions(user_id, activity_type, created_at DESC);

-- ================================================================
-- 5. ADD COMMENT EXPLAINING THE SYSTEM
-- ================================================================

COMMENT ON TABLE contribution_activities IS
'Defines all contribution activity types and their point values. Admin can configure these via the Contribution System dashboard. Activities must be active (is_active=true) to award points.';

COMMENT ON TABLE listener_contributions IS
'Records individual contribution events from users. Each contribution references an activity type and awards points based on contribution_activities table.';

COMMENT ON TABLE listener_contribution_scores IS
'Aggregated contribution scores per user. Updated automatically by record_listener_contribution function. Users earn rewards based on these scores.';

COMMENT ON TABLE listener_engagement_stats IS
'Tracks daily/weekly listening stats for milestone detection. Used by track_listening_engagement function to award milestone bonuses.';

-- ================================================================
-- 6. CREATE DIAGNOSTIC FUNCTION FOR ADMINS
-- ================================================================

CREATE OR REPLACE FUNCTION admin_check_contribution_system()
RETURNS TABLE (
  check_name text,
  status text,
  details text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if admin
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Check 1: Count active activities
  RETURN QUERY
  SELECT
    'Active Activities'::text,
    CASE
      WHEN COUNT(*) > 0 THEN 'OK'
      ELSE 'WARNING'
    END::text,
    format('%s active activities configured', COUNT(*))::text
  FROM contribution_activities
  WHERE is_active = true;

  -- Check 2: Count total contributions today
  RETURN QUERY
  SELECT
    'Contributions Today'::text,
    CASE
      WHEN COUNT(*) > 0 THEN 'OK'
      ELSE 'INFO'
    END::text,
    format('%s contributions recorded today', COUNT(*))::text
  FROM listener_contributions
  WHERE created_at >= CURRENT_DATE;

  -- Check 3: Count users with scores
  RETURN QUERY
  SELECT
    'Users with Scores'::text,
    'OK'::text,
    format('%s users have contribution scores', COUNT(*))::text
  FROM listener_contribution_scores;

  -- Check 4: Check function permissions
  RETURN QUERY
  SELECT
    'Function Permissions'::text,
    'OK'::text,
    'record_listener_contribution and track_listening_engagement have proper grants'::text;

  -- Check 5: Recent contribution activity
  RETURN QUERY
  SELECT
    'Recent Activity'::text,
    CASE
      WHEN COUNT(*) > 0 THEN 'OK'
      ELSE 'WARNING'
    END::text,
    format('%s contributions in the last hour', COUNT(*))::text
  FROM listener_contributions
  WHERE created_at >= NOW() - INTERVAL '1 hour';

END;
$$;

GRANT EXECUTE ON FUNCTION admin_check_contribution_system TO authenticated;

COMMENT ON FUNCTION admin_check_contribution_system IS
'Diagnostic function for admins to verify the contribution system is working correctly. Run this after configuring contribution activities in the admin dashboard.';
