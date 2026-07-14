/*
  # Add Contribution System Announcement

  ## Overview
  Add a system announcement to inform users about the new contribution-based
  earnings system that rewards value-adding activities.

  ## Changes
  - Insert announcement about contribution rewards system
  - Highlight key earning opportunities
  - Explain the compliant earning model
*/

-- Insert announcement about the new contribution system
INSERT INTO announcements (title, message, target_type, status, scheduled_at, created_at)
VALUES (
  '🎉 New Earning System: Contribute & Earn!',
  E'We''ve upgraded how you earn on Airaplay!\n\n' ||
  E'✨ Earn from Your Contributions:\n' ||
  E'• Create playlists that others love\n' ||
  E'• Discover new music & emerging artists\n' ||
  E'• Stay active with daily listening goals\n' ||
  E'• Build listening streaks for bonus points\n' ||
  E'• Curate quality content for the community\n\n' ||
  E'📊 Your Contribution Score:\n' ||
  E'Your earnings come from a monthly community pool, distributed based on your contribution score. The more you contribute, the larger your share!\n\n' ||
  E'🎯 Check Your Progress:\n' ||
  E'Visit your Profile > Earnings to see your contribution score and track your earnings.\n\n' ||
  E'💰 Start Earning Today:\n' ||
  E'Every playlist you create, every song you discover, and every day you stay active adds to your score. Get started now!',
  'all',
  'sent',
  now(),
  now()
)
ON CONFLICT DO NOTHING;
