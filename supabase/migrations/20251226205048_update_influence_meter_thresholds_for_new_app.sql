/*
  # Update Fan Influence Meter for New App Launch

  ## Overview
  Updates the Fan Influence Meter system with realistic thresholds for a new app launch.
  Simplifies from points-based to discovery-count-based ranking system.

  ## Changes Made

  ### 1. Updated Discovery Thresholds
  - **Early Discovery**: Changed from <1000 plays to **<50 plays**
  - **Trending Threshold**: Changed from ≥10,000 plays to **≥100 plays**

  ### 2. Simplified Ranking System
  Now based purely on total discoveries (trending_discoveries count):
  - **Explorer**: 0 discoveries (starting rank)
  - **Active Scout**: 3 trending discoveries
  - **Rising Trendsetter**: 10 trending discoveries
  - **Veteran Discoverer**: 20 trending discoveries
  - **Master Influencer**: 40 trending discoveries
  - **Elite Curator**: 75 trending discoveries
  - **Legendary Tastemaker**: 150 trending discoveries

  ### 3. Function Updates
  - `track_early_discovery()`: Now tracks content with <50 plays
  - `update_trending_discoveries()`: Now detects trending at ≥100 plays
  - `calculate_influence_rank()`: Now uses trending_discoveries count instead of points

  ## Rationale
  These lower thresholds are appropriate for a new app where:
  - Most content will have low play counts initially
  - Users can actually achieve ranks and feel progression
  - Discovery feels meaningful and attainable
  - The system can scale up as the app grows
*/

-- Drop and recreate the calculate_influence_rank function with discovery count logic
DROP FUNCTION IF EXISTS calculate_influence_rank(integer);

CREATE FUNCTION calculate_influence_rank(score integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Now using trending_discoveries count instead of points
  IF score >= 150 THEN
    RETURN 'Legendary Tastemaker';
  ELSIF score >= 75 THEN
    RETURN 'Elite Curator';
  ELSIF score >= 40 THEN
    RETURN 'Master Influencer';
  ELSIF score >= 20 THEN
    RETURN 'Veteran Discoverer';
  ELSIF score >= 10 THEN
    RETURN 'Rising Trendsetter';
  ELSIF score >= 3 THEN
    RETURN 'Active Scout';
  ELSE
    RETURN 'Explorer';
  END IF;
END;
$$;

-- Update track_early_discovery to use 50 plays threshold
CREATE OR REPLACE FUNCTION track_early_discovery(
  p_user_id uuid,
  p_song_id uuid DEFAULT NULL,
  p_video_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_play_count integer;
  v_creator_id uuid;
  v_already_discovered boolean;
BEGIN
  -- Validate input
  IF (p_song_id IS NULL AND p_video_id IS NULL) OR (p_song_id IS NOT NULL AND p_video_id IS NOT NULL) THEN
    RETURN;
  END IF;

  -- Get play count and creator ID
  IF p_song_id IS NOT NULL THEN
    SELECT play_count, artist_id INTO v_play_count, v_creator_id
    FROM songs
    WHERE id = p_song_id;
  ELSE
    SELECT play_count, user_id INTO v_play_count, v_creator_id
    FROM content_uploads
    WHERE id = p_video_id AND content_type = 'video';
  END IF;

  -- Don't track if user is the creator (creators can't earn influence from own content)
  IF v_creator_id = p_user_id THEN
    RETURN;
  END IF;

  -- Only track if play count is under 50 (NEW THRESHOLD)
  IF v_play_count >= 50 THEN
    RETURN;
  END IF;

  -- Check if already discovered
  IF p_song_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM early_discoveries
      WHERE user_id = p_user_id AND song_id = p_song_id
    ) INTO v_already_discovered;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM early_discoveries
      WHERE user_id = p_user_id AND video_id = p_video_id
    ) INTO v_already_discovered;
  END IF;

  IF v_already_discovered THEN
    RETURN;
  END IF;

  -- Record the discovery
  INSERT INTO early_discoveries (
    user_id,
    song_id,
    video_id,
    play_count_at_discovery
  ) VALUES (
    p_user_id,
    p_song_id,
    p_video_id,
    v_play_count
  );

  -- Initialize influence score if needed
  INSERT INTO user_influence_scores (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Update total discoveries count
  UPDATE user_influence_scores
  SET 
    total_discoveries = total_discoveries + 1,
    last_updated = now()
  WHERE user_id = p_user_id;
END;
$$;

-- Update trending discoveries detection to use 100 plays threshold
CREATE OR REPLACE FUNCTION update_trending_discoveries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_discovery RECORD;
  v_points integer;
  v_discoverers uuid[];
BEGIN
  -- Find songs that became trending (≥100 plays - NEW THRESHOLD)
  FOR v_discovery IN
    SELECT DISTINCT ed.song_id AS content_id, 'song' AS content_type
    FROM early_discoveries ed
    JOIN songs s ON s.id = ed.song_id
    WHERE ed.song_id IS NOT NULL
      AND ed.became_trending = false
      AND s.play_count >= 100
      AND NOT EXISTS (
        SELECT 1 FROM trending_discoveries td
        WHERE td.content_id = ed.song_id AND td.content_type = 'song'
      )
  LOOP
    -- Points are now just for record keeping (not used for ranks)
    v_points := 10;

    -- Get all discoverers for this content
    SELECT array_agg(DISTINCT user_id)
    INTO v_discoverers
    FROM early_discoveries
    WHERE song_id = v_discovery.content_id
      AND became_trending = false;

    -- Record trending discovery
    INSERT INTO trending_discoveries (
      content_id,
      content_type,
      discoverers,
      points_per_discoverer
    ) VALUES (
      v_discovery.content_id,
      v_discovery.content_type,
      v_discoverers,
      v_points
    );

    -- Mark discoveries as trending
    UPDATE early_discoveries
    SET 
      became_trending = true,
      influence_points_awarded = v_points
    WHERE song_id = v_discovery.content_id
      AND became_trending = false;

    -- Update user scores (rank now based on trending_discoveries count)
    UPDATE user_influence_scores
    SET 
      current_score = current_score + v_points,
      trending_discoveries = trending_discoveries + 1,
      this_week_score = this_week_score + v_points,
      rank = calculate_influence_rank(trending_discoveries + 1),
      last_updated = now()
    WHERE user_id = ANY(v_discoverers);
  END LOOP;

  -- Find videos that became trending (≥100 plays - NEW THRESHOLD)
  FOR v_discovery IN
    SELECT DISTINCT ed.video_id AS content_id, 'video' AS content_type
    FROM early_discoveries ed
    JOIN content_uploads cu ON cu.id = ed.video_id
    WHERE ed.video_id IS NOT NULL
      AND ed.became_trending = false
      AND cu.content_type = 'video'
      AND cu.play_count >= 100
      AND NOT EXISTS (
        SELECT 1 FROM trending_discoveries td
        WHERE td.content_id = ed.video_id AND td.content_type = 'video'
      )
  LOOP
    v_points := 10;

    SELECT array_agg(DISTINCT user_id)
    INTO v_discoverers
    FROM early_discoveries
    WHERE video_id = v_discovery.content_id
      AND became_trending = false;

    INSERT INTO trending_discoveries (
      content_id,
      content_type,
      discoverers,
      points_per_discoverer
    ) VALUES (
      v_discovery.content_id,
      v_discovery.content_type,
      v_discoverers,
      v_points
    );

    UPDATE early_discoveries
    SET 
      became_trending = true,
      influence_points_awarded = v_points
    WHERE video_id = v_discovery.content_id
      AND became_trending = false;

    UPDATE user_influence_scores
    SET 
      current_score = current_score + v_points,
      trending_discoveries = trending_discoveries + 1,
      this_week_score = this_week_score + v_points,
      rank = calculate_influence_rank(trending_discoveries + 1),
      last_updated = now()
    WHERE user_id = ANY(v_discoverers);
  END LOOP;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_influence_rank(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION track_early_discovery(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION update_trending_discoveries() TO authenticated;