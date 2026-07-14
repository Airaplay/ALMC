/*
  # Backfill Top 1% Listeners Club Data

  ## Overview
  Populates the artist_listener_stats table with existing data from:
  - listening_history (plays)
  - treat_tips (Treats sent)

  ## Process
  1. Aggregate plays per user per artist from listening_history
  2. Aggregate Treats sent per user per artist from treat_tips
  3. Combine data into artist_listener_stats
  4. Calculate loyalty scores (plays + treats*10)
  5. Run ranking calculations for all artists

  ## Notes
  - Excludes plays where user is the artist (own content)
  - Uses efficient CTEs for performance
  - Runs ranking calculation for all artists after backfill
*/

-- Backfill listener stats from existing listening history and tips
INSERT INTO artist_listener_stats (
  artist_id,
  user_id,
  total_plays,
  total_treats_sent,
  loyalty_score,
  last_updated
)
SELECT 
  s.artist_id,
  plays_treats.user_id,
  COALESCE(plays_treats.play_count, 0) as total_plays,
  COALESCE(plays_treats.treat_count, 0) as total_treats_sent,
  COALESCE(plays_treats.play_count, 0) + (COALESCE(plays_treats.treat_count, 0) * 10) as loyalty_score,
  now() as last_updated
FROM (
  -- Get play counts per user per artist
  SELECT 
    ap.id as artist_id,
    lh.user_id,
    COUNT(*) as play_count,
    0 as treat_count
  FROM listening_history lh
  JOIN songs s ON s.id = lh.song_id
  JOIN artist_profiles ap ON ap.id = s.artist_id
  WHERE lh.user_id != ap.user_id  -- Exclude own content
  GROUP BY ap.id, lh.user_id

  UNION ALL

  -- Get treat counts per user per artist
  SELECT 
    ap.id as artist_id,
    tt.sender_id as user_id,
    0 as play_count,
    SUM(tt.amount) as treat_count
  FROM treat_tips tt
  JOIN artist_profiles ap ON ap.user_id = tt.recipient_id
  WHERE tt.sender_id != ap.user_id  -- Exclude tipping yourself
  GROUP BY ap.id, tt.sender_id
) AS individual_stats
JOIN (
  -- Combine and sum plays and treats per user per artist
  SELECT 
    artist_id,
    user_id,
    SUM(play_count) as play_count,
    SUM(treat_count) as treat_count
  FROM (
    -- Plays
    SELECT 
      ap.id as artist_id,
      lh.user_id,
      COUNT(*) as play_count,
      0 as treat_count
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    JOIN artist_profiles ap ON ap.id = s.artist_id
    WHERE lh.user_id != ap.user_id
    GROUP BY ap.id, lh.user_id

    UNION ALL

    -- Treats
    SELECT 
      ap.id as artist_id,
      tt.sender_id as user_id,
      0 as play_count,
      SUM(tt.amount) as treat_count
    FROM treat_tips tt
    JOIN artist_profiles ap ON ap.user_id = tt.recipient_id
    WHERE tt.sender_id != ap.user_id
    GROUP BY ap.id, tt.sender_id
  ) combined
  GROUP BY artist_id, user_id
) plays_treats ON true
JOIN artist_profiles ap ON ap.id = plays_treats.artist_id
JOIN songs s ON s.artist_id = ap.id
GROUP BY s.artist_id, plays_treats.user_id, plays_treats.play_count, plays_treats.treat_count
ON CONFLICT (artist_id, user_id) 
DO UPDATE SET
  total_plays = artist_listener_stats.total_plays + EXCLUDED.total_plays,
  total_treats_sent = artist_listener_stats.total_treats_sent + EXCLUDED.total_treats_sent,
  loyalty_score = artist_listener_stats.loyalty_score + EXCLUDED.loyalty_score,
  last_updated = now();

-- Calculate rankings for all artists
SELECT refresh_all_top_1_percent_rankings();
