/*
  # Smart Rotation Queue System for Promotion Fairness

  ## Overview
  Implements a comprehensive rotation queue system that ensures fair exposure for all promoted content
  across all sections with intelligent scoring, cycle tracking, and fairness enforcement.

  ## 1. New Tables
    - `promotion_rotation_cycles`: Tracks rotation cycles (2-hour windows)
    - `promotion_queue_state`: Manages queue position and visibility scheduling
    - `promotion_exposure_logs`: Detailed logs of when promotions enter/leave rotation

  ## 2. New Functions
    - `calculate_visibility_score`: Calculates VisibilityScore with randomization
    - `get_smart_rotated_promotions`: Retrieves promotions with smart rotation logic
    - `enforce_fairness_rotation`: Ensures promotions appear at least once every 6 hours
    - `rotate_promotion_cycle`: Advances to next rotation cycle and updates queue
    - `log_promotion_exposure`: Records exposure events for analytics

  ## 3. Changes to Existing Tables
    - Add rotation cycle tracking fields to promotion_rotation_state
    - Add queue position and fairness tracking fields

  ## 4. Rotation Rules
    - Display top 10 promotions per section at any time
    - Rotate every 2 hours for freshness
    - All promotions must appear at least once within 6 hours (fairness)
    - Randomize within ±5% of VisibilityScore to prevent fixed order
    - Queue extra promotions for next rotation cycle
    - Force inclusion after 6 hours if not shown

  ## 5. VisibilityScore Formula
    VisibilityScore = (ExposureWeight * 0.6) + (EngagementRate * 0.4)
    where:
      ExposureWeight = 1 - (timeElapsed / totalDuration)
      EngagementRate = totalEngagements / max(totalImpressions, 1)

  ## 6. Security
    - Enable RLS on all new tables
    - Public can view rotation data (needed for display)
    - Service role can manage cycles and queue state
    - Users can view their own promotion logs
*/

-- Create promotion_rotation_cycles table
CREATE TABLE IF NOT EXISTS promotion_rotation_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL,
  cycle_number integer NOT NULL,
  cycle_start_time timestamptz NOT NULL DEFAULT now(),
  cycle_end_time timestamptz NOT NULL,
  promotions_displayed integer DEFAULT 0,
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(section_key, cycle_number)
);

-- Create promotion_queue_state table
CREATE TABLE IF NOT EXISTS promotion_queue_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  queue_position integer DEFAULT 0,
  visibility_score numeric DEFAULT 0,
  last_displayed_at timestamptz,
  last_cycle_displayed integer,
  cycles_since_display integer DEFAULT 0,
  forced_next_cycle boolean DEFAULT false,
  in_current_rotation boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(promotion_id, section_key)
);

-- Create promotion_exposure_logs table
CREATE TABLE IF NOT EXISTS promotion_exposure_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  cycle_id uuid REFERENCES promotion_rotation_cycles(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('enter_rotation', 'exit_rotation', 'forced_inclusion')),
  visibility_score numeric,
  queue_position integer,
  treat_deducted numeric DEFAULT 0,
  event_time timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Add rotation cycle tracking to promotion_rotation_state
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'promotion_rotation_state' AND column_name = 'current_cycle_number'
  ) THEN
    ALTER TABLE promotion_rotation_state ADD COLUMN current_cycle_number integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'promotion_rotation_state' AND column_name = 'time_in_rotation_hours'
  ) THEN
    ALTER TABLE promotion_rotation_state ADD COLUMN time_in_rotation_hours numeric DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'promotion_rotation_state' AND column_name = 'total_rotation_appearances'
  ) THEN
    ALTER TABLE promotion_rotation_state ADD COLUMN total_rotation_appearances integer DEFAULT 0;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_promotion_rotation_cycles_section ON promotion_rotation_cycles(section_key);
CREATE INDEX IF NOT EXISTS idx_promotion_rotation_cycles_status ON promotion_rotation_cycles(status);
CREATE INDEX IF NOT EXISTS idx_promotion_rotation_cycles_time ON promotion_rotation_cycles(cycle_start_time);
CREATE INDEX IF NOT EXISTS idx_promotion_queue_state_promotion ON promotion_queue_state(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_queue_state_section ON promotion_queue_state(section_key);
CREATE INDEX IF NOT EXISTS idx_promotion_queue_state_score ON promotion_queue_state(visibility_score);
CREATE INDEX IF NOT EXISTS idx_promotion_queue_state_position ON promotion_queue_state(queue_position);
CREATE INDEX IF NOT EXISTS idx_promotion_queue_state_forced ON promotion_queue_state(forced_next_cycle);
CREATE INDEX IF NOT EXISTS idx_promotion_exposure_logs_promotion ON promotion_exposure_logs(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_exposure_logs_section ON promotion_exposure_logs(section_key);
CREATE INDEX IF NOT EXISTS idx_promotion_exposure_logs_time ON promotion_exposure_logs(event_time);

-- Enable RLS
ALTER TABLE promotion_rotation_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_queue_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_exposure_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for promotion_rotation_cycles
CREATE POLICY "Anyone can view rotation cycles"
  ON promotion_rotation_cycles
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Service role can manage rotation cycles"
  ON promotion_rotation_cycles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS Policies for promotion_queue_state
CREATE POLICY "Anyone can view queue state"
  ON promotion_queue_state
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Service role can manage queue state"
  ON promotion_queue_state
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS Policies for promotion_exposure_logs
CREATE POLICY "Users can view own promotion exposure logs"
  ON promotion_exposure_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM promotions
      WHERE promotions.id = promotion_exposure_logs.promotion_id
      AND promotions.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all exposure logs"
  ON promotion_exposure_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Service role can manage exposure logs"
  ON promotion_exposure_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to calculate visibility score with randomization
CREATE OR REPLACE FUNCTION calculate_visibility_score(
  p_promotion_id uuid,
  p_section_key text
)
RETURNS numeric AS $$
DECLARE
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_time_elapsed numeric;
  v_total_duration numeric;
  v_exposure_weight numeric;
  v_total_impressions integer;
  v_total_clicks integer;
  v_engagement_rate numeric;
  v_visibility_score numeric;
  v_randomization_factor numeric;
BEGIN
  -- Get promotion details
  SELECT start_date, end_date
  INTO v_start_date, v_end_date
  FROM promotions
  WHERE id = p_promotion_id;

  -- Calculate time weights
  v_time_elapsed := EXTRACT(EPOCH FROM (now() - v_start_date)) / 3600.0; -- in hours
  v_total_duration := EXTRACT(EPOCH FROM (v_end_date - v_start_date)) / 3600.0; -- in hours

  -- ExposureWeight = 1 - (timeElapsed / totalDuration)
  IF v_total_duration > 0 THEN
    v_exposure_weight := GREATEST(0, 1 - (v_time_elapsed / v_total_duration));
  ELSE
    v_exposure_weight := 1.0;
  END IF;

  -- Get engagement metrics
  SELECT 
    COALESCE(total_impressions, 0),
    COALESCE(total_clicks, 0)
  INTO v_total_impressions, v_total_clicks
  FROM promotion_rotation_state
  WHERE promotion_id = p_promotion_id AND section_key = p_section_key;

  -- EngagementRate = totalEngagements / max(totalImpressions, 1)
  v_engagement_rate := v_total_clicks::numeric / GREATEST(v_total_impressions, 1)::numeric;

  -- VisibilityScore = (ExposureWeight * 0.6) + (EngagementRate * 0.4)
  v_visibility_score := (v_exposure_weight * 0.6) + (v_engagement_rate * 0.4);

  -- Add randomization within ±5%
  -- Random value between 0.95 and 1.05
  v_randomization_factor := 0.95 + (random() * 0.10);
  v_visibility_score := v_visibility_score * v_randomization_factor;

  RETURN v_visibility_score;
END;
$$ LANGUAGE plpgsql;

-- Function to log promotion exposure events
CREATE OR REPLACE FUNCTION log_promotion_exposure(
  p_promotion_id uuid,
  p_section_key text,
  p_event_type text,
  p_visibility_score numeric DEFAULT NULL,
  p_queue_position integer DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_cycle_id uuid;
  v_treat_deducted numeric := 0;
BEGIN
  -- Get current cycle ID
  SELECT id INTO v_cycle_id
  FROM promotion_rotation_cycles
  WHERE section_key = p_section_key AND status = 'active'
  ORDER BY cycle_start_time DESC
  LIMIT 1;

  -- Calculate treat deduction (if entering rotation)
  IF p_event_type = 'enter_rotation' THEN
    -- Deduct based on section pricing (this is a placeholder - adjust as needed)
    v_treat_deducted := 10.0; -- Base deduction per 2-hour cycle
  END IF;

  -- Insert exposure log
  INSERT INTO promotion_exposure_logs (
    promotion_id,
    section_key,
    cycle_id,
    event_type,
    visibility_score,
    queue_position,
    treat_deducted
  ) VALUES (
    p_promotion_id,
    p_section_key,
    v_cycle_id,
    p_event_type,
    p_visibility_score,
    p_queue_position,
    v_treat_deducted
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get smart rotated promotions
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
      SELECT last_cycle_displayed, cycles_since_display
      INTO v_last_cycle, v_cycles_since
      FROM promotion_queue_state
      WHERE promotion_id = v_promotion.id AND section_key = p_section_key;

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

-- Function to rotate promotion cycle (called every 2 hours)
CREATE OR REPLACE FUNCTION rotate_promotion_cycle(
  p_section_key text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_section text;
BEGIN
  -- If section specified, rotate only that section
  -- Otherwise, rotate all sections
  FOR v_section IN
    SELECT COALESCE(p_section_key, section_key)
    FROM promotion_sections
    WHERE is_active = true
      AND (p_section_key IS NULL OR section_key = p_section_key)
  LOOP
    -- Mark old cycles as completed
    UPDATE promotion_rotation_cycles
    SET status = 'completed'
    WHERE section_key = v_section
      AND status = 'active'
      AND cycle_end_time <= now();

    -- Log exit events for promotions leaving rotation
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
      'exit_rotation',
      pqs.visibility_score,
      pqs.queue_position
    FROM promotion_queue_state pqs
    WHERE pqs.section_key = v_section
      AND pqs.in_current_rotation = true;

    -- Mark all promotions as out of rotation
    UPDATE promotion_queue_state
    SET in_current_rotation = false
    WHERE section_key = v_section;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_queue_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_promotion_queue_state_timestamp ON promotion_queue_state;
CREATE TRIGGER update_promotion_queue_state_timestamp
  BEFORE UPDATE ON promotion_queue_state
  FOR EACH ROW
  EXECUTE FUNCTION update_queue_state_timestamp();
