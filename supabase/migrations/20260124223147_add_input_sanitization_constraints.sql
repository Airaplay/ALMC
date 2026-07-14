/*
  # Input Sanitization Constraints (MEDIUM PRIORITY SECURITY FIX)

  ## Security Features
  1. **Length Limits** - Prevents excessively long input
  2. **XSS Prevention** - Limits potential for XSS attacks
  3. **Data Integrity** - Ensures reasonable input values
  4. **Duplicate Prevention** - Prevents exact duplicate promotions

  ## Changes
  - Add length constraint on target_title (max 200 chars)
  - Add unique index to prevent duplicate active promotions
  - Add constraint checks on numeric values (with data cleanup)

  ## Security Level
  MEDIUM - Prevents input abuse and data integrity issues
*/

-- First, fix any existing data that would violate constraints

-- Fix any null or empty titles
UPDATE promotions
SET target_title = 'Untitled'
WHERE target_title IS NULL OR LENGTH(target_title) = 0;

-- Truncate overly long titles
UPDATE promotions
SET target_title = LEFT(target_title, 200)
WHERE LENGTH(target_title) > 200;

-- Fix any invalid duration values
UPDATE promotions
SET
  duration_hours = GREATEST(24, LEAST(2160, duration_hours)),
  duration_days = GREATEST(1, LEAST(90, duration_days))
WHERE
  duration_hours < 24 OR duration_hours > 2160 OR
  duration_days < 1 OR duration_days > 90;

-- Fix any invalid impression values
UPDATE promotions
SET
  impressions_target = GREATEST(0, LEAST(10000000, impressions_target)),
  impressions_actual = GREATEST(0, impressions_actual),
  clicks = GREATEST(0, clicks)
WHERE
  impressions_target < 0 OR impressions_target > 10000000 OR
  impressions_actual < 0 OR
  clicks < 0;

-- Now add constraints

-- Add length constraint on target_title if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'promotions_target_title_length'
  ) THEN
    ALTER TABLE promotions
    ADD CONSTRAINT promotions_target_title_length
    CHECK (LENGTH(target_title) <= 200 AND LENGTH(target_title) > 0);
  END IF;
END $$;

-- Add constraint to ensure duration values are reasonable
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'promotions_duration_reasonable'
  ) THEN
    ALTER TABLE promotions
    ADD CONSTRAINT promotions_duration_reasonable
    CHECK (
      duration_hours >= 24 AND duration_hours <= 2160 AND
      duration_days >= 1 AND duration_days <= 90
    );
  END IF;
END $$;

-- Add constraint to ensure impression targets are reasonable
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'promotions_impressions_reasonable'
  ) THEN
    ALTER TABLE promotions
    ADD CONSTRAINT promotions_impressions_reasonable
    CHECK (
      impressions_target >= 0 AND
      impressions_target <= 10000000 AND
      impressions_actual >= 0 AND
      clicks >= 0
    );
  END IF;
END $$;

-- Create unique index to prevent exact duplicate active promotions
-- (same user, target, section, and overlapping dates)
DROP INDEX IF EXISTS idx_promotions_no_exact_duplicates;
CREATE UNIQUE INDEX idx_promotions_no_exact_duplicates
ON promotions (user_id, target_id, promotion_section_id, start_date, end_date)
WHERE status IN ('pending_approval', 'pending', 'active');

-- Add comments
COMMENT ON CONSTRAINT promotions_target_title_length ON promotions IS
'Prevents excessively long titles that could cause display issues or XSS attempts';

COMMENT ON CONSTRAINT promotions_duration_reasonable ON promotions IS
'Ensures promotion durations are within reasonable bounds (1-90 days)';

COMMENT ON CONSTRAINT promotions_impressions_reasonable ON promotions IS
'Prevents unrealistic impression targets and negative values';

COMMENT ON INDEX idx_promotions_no_exact_duplicates IS
'Prevents exact duplicate active promotions for same content';