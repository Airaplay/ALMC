/*
  # Fix Listener Stats Backfill with Correct Artist Relationship

  ## Overview
  Corrects the backfill to use proper artist table relationships:
  songs.artist_id → artists.id → artist_profiles.artist_id (with user_id)

  ## Process
  1. Clear existing incorrect data
  2. Insert play counts using correct joins
  3. Update with treat counts
  4. Calculate rankings
*/

-- Step 1: Clear existing data
TRUNCATE artist_listener_stats;

-- Step 2: Insert play counts from listening history (using correct joins)
INSERT INTO artist_listener_stats (
  artist_id,
  user_id,
  total_plays,
  total_treats_sent,
  loyalty_score,
  last_updated
)
SELECT 
  ap.id as artist_id,
  lh.user_id,
  COUNT(*) as total_plays,
  0 as total_treats_sent,
  COUNT(*) as loyalty_score,
  now() as last_updated
FROM listening_history lh
JOIN songs s ON s.id = lh.song_id
JOIN artists a ON a.id = s.artist_id
JOIN artist_profiles ap ON ap.artist_id = a.id
WHERE lh.user_id != ap.user_id  -- Exclude own content
GROUP BY ap.id, lh.user_id
ON CONFLICT (artist_id, user_id) DO NOTHING;

-- Step 3: Update with treat counts
WITH treat_aggregates AS (
  SELECT 
    ap.id as artist_id,
    tt.sender_id as user_id,
    SUM(tt.amount) as total_treats
  FROM treat_tips tt
  JOIN artist_profiles ap ON ap.user_id = tt.recipient_id
  WHERE tt.sender_id != ap.user_id  -- Exclude self-tips
  GROUP BY ap.id, tt.sender_id
)
UPDATE artist_listener_stats als
SET 
  total_treats_sent = als.total_treats_sent + ta.total_treats,
  loyalty_score = als.loyalty_score + (ta.total_treats * 10),
  last_updated = now()
FROM treat_aggregates ta
WHERE als.artist_id = ta.artist_id
  AND als.user_id = ta.user_id;

-- Step 4: Insert treat-only records (users who sent treats but never played)
INSERT INTO artist_listener_stats (
  artist_id,
  user_id,
  total_plays,
  total_treats_sent,
  loyalty_score,
  last_updated
)
SELECT 
  ap.id as artist_id,
  tt.sender_id as user_id,
  0 as total_plays,
  SUM(tt.amount) as total_treats_sent,
  SUM(tt.amount) * 10 as loyalty_score,
  now() as last_updated
FROM treat_tips tt
JOIN artist_profiles ap ON ap.user_id = tt.recipient_id
WHERE tt.sender_id != ap.user_id
GROUP BY ap.id, tt.sender_id
ON CONFLICT (artist_id, user_id) DO NOTHING;

-- Step 5: Calculate rankings for all artists
SELECT refresh_all_top_1_percent_rankings();
