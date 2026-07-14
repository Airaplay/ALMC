/*
  # Spending Velocity Limits (MEDIUM PRIORITY SECURITY FIX)

  ## Security Features
  1. **Daily Spending Cap** - Limits daily promotion spending (default 10,000 treats)
  2. **Weekly Spending Cap** - Limits weekly promotion spending (default 50,000 treats)
  3. **Velocity Tracking** - Tracks spending patterns
  4. **Auto-Reset** - Automatically resets daily/weekly counters

  ## Changes
  - New table: `user_spending_limits`
  - New trigger function: `check_spending_limits()`
  - Configurable per-user limits
  - Automatic counter resets

  ## Security Level
  MEDIUM - Prevents rapid wallet drainage and compromised account abuse
*/

-- Create user spending limits table
CREATE TABLE IF NOT EXISTS user_spending_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  daily_limit numeric DEFAULT 10000,
  weekly_limit numeric DEFAULT 50000,
  daily_spent numeric DEFAULT 0,
  weekly_spent numeric DEFAULT 0,
  last_daily_reset timestamptz DEFAULT now(),
  last_weekly_reset timestamptz DEFAULT now(),
  is_custom boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_spending_limits_user ON user_spending_limits(user_id);
CREATE INDEX IF NOT EXISTS idx_user_spending_limits_daily_reset ON user_spending_limits(last_daily_reset);
CREATE INDEX IF NOT EXISTS idx_user_spending_limits_weekly_reset ON user_spending_limits(last_weekly_reset);

-- Enable RLS
ALTER TABLE user_spending_limits ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own spending limits"
  ON user_spending_limits
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all spending limits"
  ON user_spending_limits
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can manage spending limits"
  ON user_spending_limits
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Service role can manage spending limits"
  ON user_spending_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to check and enforce spending limits
CREATE OR REPLACE FUNCTION public.check_spending_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits RECORD;
  v_new_daily numeric;
  v_new_weekly numeric;
BEGIN
  -- Get or create spending limits for user
  INSERT INTO user_spending_limits (user_id)
  VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_limits
  FROM user_spending_limits
  WHERE user_id = NEW.user_id
  FOR UPDATE;

  -- Reset daily counter if needed (new day)
  IF v_limits.last_daily_reset < CURRENT_DATE THEN
    UPDATE user_spending_limits
    SET
      daily_spent = 0,
      last_daily_reset = now(),
      updated_at = now()
    WHERE user_id = NEW.user_id;
    v_limits.daily_spent := 0;
  END IF;

  -- Reset weekly counter if needed (7 days passed)
  IF v_limits.last_weekly_reset < (now() - INTERVAL '7 days') THEN
    UPDATE user_spending_limits
    SET
      weekly_spent = 0,
      last_weekly_reset = now(),
      updated_at = now()
    WHERE user_id = NEW.user_id;
    v_limits.weekly_spent := 0;
  END IF;

  -- Calculate new spending amounts
  v_new_daily := v_limits.daily_spent + NEW.treats_cost;
  v_new_weekly := v_limits.weekly_spent + NEW.treats_cost;

  -- Check daily limit
  IF v_new_daily > v_limits.daily_limit THEN
    RAISE EXCEPTION 'Daily spending limit exceeded. Please try again tomorrow or contact support to increase your limit.';
  END IF;

  -- Check weekly limit
  IF v_new_weekly > v_limits.weekly_limit THEN
    RAISE EXCEPTION 'Weekly spending limit exceeded. Please try again next week or contact support to increase your limit.';
  END IF;

  -- Update spending counters
  UPDATE user_spending_limits
  SET
    daily_spent = v_new_daily,
    weekly_spent = v_new_weekly,
    updated_at = now()
  WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS check_spending_limits_trigger ON public.promotions;

-- Create trigger on promotions table (BEFORE INSERT)
CREATE TRIGGER check_spending_limits_trigger
BEFORE INSERT ON public.promotions
FOR EACH ROW
EXECUTE FUNCTION public.check_spending_limits();

-- Add helpful comments
COMMENT ON TABLE user_spending_limits IS
'Tracks and enforces daily and weekly spending limits on promotions to prevent rapid wallet drainage';

COMMENT ON FUNCTION public.check_spending_limits() IS
'MEDIUM PRIORITY SECURITY: Enforces daily and weekly spending velocity limits to prevent abuse';

COMMENT ON TRIGGER check_spending_limits_trigger ON public.promotions IS
'MEDIUM PRIORITY SECURITY: Spending velocity enforcement';

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.check_spending_limits() TO authenticated;