/*
  # Anti-Fraud Detection for Promotions (HIGH PRIORITY SECURITY FIX)

  ## Security Features
  1. **Rapid Creation Detection** - Alerts on 10+ promotions in 1 hour
  2. **Same Target Spam** - Detects multiple promotions for same content
  3. **Pattern Analysis** - Tracks suspicious behavior
  4. **Admin Alerts** - Notifies admins of fraud attempts

  ## Changes
  - New table: `promotion_fraud_alerts`
  - New trigger function: `detect_promotion_fraud()`
  - Automatic alert generation
  - Severity classification (low, medium, high, critical)

  ## Security Level
  HIGH - Enables fraud monitoring and prevention
*/

-- Create promotion fraud alerts table
CREATE TABLE IF NOT EXISTS promotion_fraud_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('rapid_creation', 'same_target_spam', 'suspicious_pattern', 'cost_manipulation', 'quota_abuse')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  is_resolved boolean DEFAULT false,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_promotion_fraud_alerts_user ON promotion_fraud_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_promotion_fraud_alerts_severity ON promotion_fraud_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_promotion_fraud_alerts_resolved ON promotion_fraud_alerts(is_resolved);
CREATE INDEX IF NOT EXISTS idx_promotion_fraud_alerts_created ON promotion_fraud_alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_promotion_fraud_alerts_type ON promotion_fraud_alerts(alert_type);

-- Enable RLS
ALTER TABLE promotion_fraud_alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can view all fraud alerts"
  ON promotion_fraud_alerts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins can manage fraud alerts"
  ON promotion_fraud_alerts
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

CREATE POLICY "Service role can manage fraud alerts"
  ON promotion_fraud_alerts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to detect promotion fraud patterns
CREATE OR REPLACE FUNCTION public.detect_promotion_fraud()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count integer;
  v_same_target_count integer;
  v_total_spent numeric;
  v_user_created_at timestamptz;
BEGIN
  -- Check for rapid creation (more than 10 in 1 hour)
  SELECT COUNT(*) INTO v_recent_count
  FROM promotions
  WHERE user_id = NEW.user_id
  AND created_at > now() - interval '1 hour';

  IF v_recent_count > 10 THEN
    INSERT INTO promotion_fraud_alerts (user_id, alert_type, severity, description, metadata)
    VALUES (
      NEW.user_id,
      'rapid_creation',
      'high',
      'User created more than 10 promotions in 1 hour',
      jsonb_build_object(
        'count', v_recent_count,
        'promotion_id', NEW.id,
        'time_window', '1 hour'
      )
    );
  END IF;

  -- Check for same target spam (more than 3 promotions for same target in 24 hours)
  SELECT COUNT(*) INTO v_same_target_count
  FROM promotions
  WHERE user_id = NEW.user_id
  AND target_id = NEW.target_id
  AND status IN ('pending_approval', 'pending', 'active')
  AND created_at > now() - interval '24 hours';

  IF v_same_target_count > 3 THEN
    INSERT INTO promotion_fraud_alerts (user_id, alert_type, severity, description, metadata)
    VALUES (
      NEW.user_id,
      'same_target_spam',
      'medium',
      'User created multiple promotions for same target in 24 hours',
      jsonb_build_object(
        'count', v_same_target_count,
        'target_id', NEW.target_id,
        'promotion_type', NEW.promotion_type
      )
    );
  END IF;

  -- Check for new user with high spending
  SELECT created_at INTO v_user_created_at
  FROM users
  WHERE id = NEW.user_id;

  IF v_user_created_at > now() - interval '7 days' THEN
    SELECT COALESCE(SUM(treats_cost), 0) INTO v_total_spent
    FROM promotions
    WHERE user_id = NEW.user_id
    AND created_at > now() - interval '24 hours';

    IF v_total_spent > 10000 THEN
      INSERT INTO promotion_fraud_alerts (user_id, alert_type, severity, description, metadata)
      VALUES (
        NEW.user_id,
        'suspicious_pattern',
        'high',
        'New user with unusually high promotion spending',
        jsonb_build_object(
          'total_spent_24h', v_total_spent,
          'account_age_days', EXTRACT(EPOCH FROM (now() - v_user_created_at)) / 86400
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS detect_promotion_fraud_trigger ON public.promotions;

-- Create trigger on promotions table (AFTER INSERT)
CREATE TRIGGER detect_promotion_fraud_trigger
AFTER INSERT ON public.promotions
FOR EACH ROW
EXECUTE FUNCTION public.detect_promotion_fraud();

-- Add helpful comments
COMMENT ON TABLE promotion_fraud_alerts IS
'Tracks suspicious promotion activity patterns for admin review and fraud prevention';

COMMENT ON FUNCTION public.detect_promotion_fraud() IS
'HIGH PRIORITY SECURITY: Detects fraud patterns in promotion creation and generates admin alerts';

COMMENT ON TRIGGER detect_promotion_fraud_trigger ON public.promotions IS
'HIGH PRIORITY SECURITY: Monitors for fraud patterns and generates alerts';

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.detect_promotion_fraud() TO authenticated;