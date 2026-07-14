/*
  # Add Specific Social Contribution Activities

  1. New Activity Types
    - song_like: When a user likes/favorites a song (3 points)
    - video_like: When a user likes/favorites a video (3 points)
    - content_comment: When a user comments on content (5 points)
    - artist_follow: When a user follows an artist (5 points)
    - content_share: When a user shares content (3 points)
    - video_completion: When a user watches 80 percent of a video (4 points)

  2. Changes
    - Adds 6 new specific activity types to contribution_activities table
    - All are set to active and limited appropriately
    - Points balanced to reward higher-value actions more

  3. Notes
    - Existing daily_engagement activity remains for backwards compatibility
    - Frontend code needs to be updated to use these specific types
    - Deduplication is enforced at the database function level
*/

-- Add specific social contribution activity types
INSERT INTO contribution_activities (
  activity_type,
  activity_name,
  description,
  base_reward_points,
  is_active
) VALUES
  (
    'song_like',
    'Like Song',
    'User likes or favorites a song (once per day)',
    3,
    true
  ),
  (
    'video_like',
    'Like Video',
    'User likes or favorites a video (once per day)',
    3,
    true
  ),
  (
    'content_comment',
    'Comment on Content',
    'User comments on a song, video, or album (once per day)',
    5,
    true
  ),
  (
    'artist_follow',
    'Follow Artist',
    'User follows an artist or creator (once per artist)',
    5,
    true
  ),
  (
    'content_share',
    'Share Content',
    'User shares a song, video, album, or playlist (once per day)',
    3,
    true
  ),
  (
    'video_completion',
    'Complete Video',
    'User watches at least 80 percent of a video (once per video per day)',
    4,
    true
  )
ON CONFLICT (activity_type) DO UPDATE SET
  activity_name = EXCLUDED.activity_name,
  description = EXCLUDED.description,
  base_reward_points = EXCLUDED.base_reward_points,
  is_active = EXCLUDED.is_active;