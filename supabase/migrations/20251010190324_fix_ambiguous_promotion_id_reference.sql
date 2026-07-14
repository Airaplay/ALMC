/*
  # Fix Ambiguous Column Reference in get_smart_rotated_promotions

  ## Overview
  Fixes the ambiguous "promotion_id" column reference error in the get_smart_rotated_promotions function
  by explicitly qualifying the table name in the WHERE clause.

  ## Changes
  - Updates get_smart_rotated_promotions function to use pqs.promotion_id instead of promotion_id
  - This eliminates ambiguity between the table column and the function parameter
*/

-- Drop and recreate the function with the fix
CREATE OR REPLACE FUNCTION get_smart_rotated_promotions(
  p_section_key text,
  p_content_type text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  promotion_id uuid,
  target_id uuid,
  target_title text,
  user_id uuid,
  visibility_score numeric,
  queue_position integer,
  forced_inclusion boolean
) AS $$
DECLARE
  v_section_id uuid;
  v_current_cycle integer;
  v_promotion record;
  v_position integer := 1;
BEGIN
  -- Get section ID
  SELECT id INTO v_section_id
  FROM promotion_sections
  WHERE section_key = p_section_key AND is_active = true;

  IF v_section_id IS NULL THEN
    RETURN;
  END IF;

  -- Get or create current cycle number
  SELECT COALESCE(MAX(cycle_number), 0) INTO v_current_cycle
  FROM promotion_rotation_cycles
  WHERE section_key = p_section_key;

  -- Ensure active cycle exists
  INSERT INTO promotion_rotation_cycles (
    section_key,
    cycle_number,
    cycle_start_time,
    cycle_end_time,
    status
  )
  SELECT
    p_section_key,
    v_current_cycle + 1,
    now(),
    now() + interval '2 hours',
    'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM promotion_rotation_cycles
    WHERE section_key = p_section_key AND status = 'active'
  );

  -- Update queue state for all active promotions
  FOR v_promotion IN
    SELECT p.id
    FROM promotions p
    WHERE p.promotion_section_id = v_section_id
      AND p.promotion_type = p_content_type
      AND p.status = 'active'
      AND p.start_date <= now()
      AND p.end_date >= now()
  LOOP
    -- Calculate visibility score
    DECLARE
      v_score numeric;
      v_force boolean := false;
      v_last_cycle integer;
      v_cycles_since integer;
    BEGIN
      v_score := calculate_visibility_score(v_promotion.id, p_section_key);

      -- Check fairness: force inclusion if not shown in last 3 cycles (6 hours)
      -- FIX: Explicitly qualify promotion_id with table alias pqs
      SELECT pqs.last_cycle_displayed, pqs.cycles_since_display
      INTO v_last_cycle, v_cycles_since
      FROM promotion_queue_state pqs
      WHERE pqs.promotion_id = v_promotion.id AND pqs.section_key = p_section_key;

      IF v_cycles_since >= 3 THEN
        v_force := true;
        v_score := v_score + 1.0; -- Boost score for forced inclusion
      END IF;

      -- Upsert queue state
      INSERT INTO promotion_queue_state (
        promotion_id,
        section_key,
        visibility_score,
        forced_next_cycle
      ) VALUES (
        v_promotion.id,
        p_section_key,
        v_score,
        v_force
      )
      ON CONFLICT (promotion_id, section_key) DO UPDATE SET
        visibility_score = v_score,
        forced_next_cycle = v_force,
        cycles_since_display = COALESCE(promotion_queue_state.cycles_since_display, 0) + 1,
        updated_at = now();
    END;
  END LOOP;

  -- Return top promotions sorted by visibility score
  RETURN QUERY
  SELECT
    pqs.promotion_id,
    p.target_id,
    p.target_title,
    p.user_id,
    pqs.visibility_score,
    v_position as queue_position,
    pqs.forced_next_cycle as forced_inclusion
  FROM promotion_queue_state pqs
  JOIN promotions p ON p.id = pqs.promotion_id
  WHERE pqs.section_key = p_section_key
    AND p.status = 'active'
    AND p.start_date <= now()
    AND p.end_date >= now()
  ORDER BY
    pqs.forced_next_cycle DESC, -- Forced promotions first
    pqs.visibility_score DESC,
    RANDOM()
  LIMIT p_limit;

  -- Update queue positions and log exposure
  UPDATE promotion_queue_state pqs
  SET
    queue_position = sub.rn,
    in_current_rotation = (sub.rn <= p_limit),
    last_displayed_at = CASE WHEN sub.rn <= p_limit THEN now() ELSE pqs.last_displayed_at END,
    last_cycle_displayed = CASE WHEN sub.rn <= p_limit THEN v_current_cycle ELSE pqs.last_cycle_displayed END,
    cycles_since_display = CASE WHEN sub.rn <= p_limit THEN 0 ELSE COALESCE(pqs.cycles_since_display, 0) + 1 END,
    forced_next_cycle = false,
    updated_at = now()
  FROM (
    SELECT
      pqs2.promotion_id,
      ROW_NUMBER() OVER (
        ORDER BY pqs2.forced_next_cycle DESC, pqs2.visibility_score DESC, RANDOM()
      ) as rn
    FROM promotion_queue_state pqs2
    JOIN promotions p2 ON p2.id = pqs2.promotion_id
    WHERE pqs2.section_key = p_section_key
      AND p2.status = 'active'
      AND p2.start_date <= now()
      AND p2.end_date >= now()
  ) sub
  WHERE pqs.promotion_id = sub.promotion_id
    AND pqs.section_key = p_section_key;

  -- Log exposure for promotions entering rotation
  INSERT INTO promotion_exposure_logs (
    promotion_id,
    section_key,
    event_type,
    visibility_score,
    queue_position
  )
  SELECT
    pqs.promotion_id,
    pqs.section_key,
    'enter_rotation',
    pqs.visibility_score,
    pqs.queue_position
  FROM promotion_queue_state pqs
  WHERE pqs.section_key = p_section_key
    AND pqs.in_current_rotation = true
    AND pqs.last_displayed_at >= now() - interval '5 minutes';

END;
$$ LANGUAGE plpgsql;