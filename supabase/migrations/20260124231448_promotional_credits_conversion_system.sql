/*
  # Promotional Credits Conversion System
  
  1. Promotional Credits Wallet
    - Separate wallet for promotional/earned credits
    - Can be used within the platform (promotions, tips, etc.)
    - Cannot be withdrawn as cash
    
  2. Balance Conversion
    - Converts existing earned_balance to promotional credits
    - Maintains transaction history
    - One-time migration of existing balances
    
  3. Updated Wallet Structure
    - treat_wallets now has promo_balance field
    - earned_balance becomes promotional (non-withdrawable)
    - purchased_balance remains withdrawable
    
  4. Usage Tracking
    - Track how promotional credits are spent
    - Analytics for promo effectiveness
    
  5. Security
    - RLS enabled on all tables
    - Audit trail for all conversions
*/

-- ============================================================================
-- 1. ADD PROMOTIONAL BALANCE TO WALLETS
-- ============================================================================

-- Add promo_balance column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'treat_wallets' 
    AND column_name = 'promo_balance'
  ) THEN
    ALTER TABLE treat_wallets 
    ADD COLUMN promo_balance integer DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- Add promotional credits tracking
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'treat_wallets' 
    AND column_name = 'promo_lifetime_earned'
  ) THEN
    ALTER TABLE treat_wallets 
    ADD COLUMN promo_lifetime_earned integer DEFAULT 0 NOT NULL;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'treat_wallets' 
    AND column_name = 'promo_lifetime_spent'
  ) THEN
    ALTER TABLE treat_wallets 
    ADD COLUMN promo_lifetime_spent integer DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 2. BALANCE CONVERSION TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS balance_conversion_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  conversion_type text NOT NULL CHECK (conversion_type IN ('earned_to_promo', 'manual_adjustment')),
  amount_treats integer NOT NULL,
  previous_earned_balance integer,
  new_promo_balance integer,
  reason text,
  converted_by uuid REFERENCES auth.users(id),
  converted_at timestamptz DEFAULT now() NOT NULL,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_conversion_user ON balance_conversion_history(user_id);
CREATE INDEX IF NOT EXISTS idx_conversion_date ON balance_conversion_history(converted_at DESC);

-- RLS
ALTER TABLE balance_conversion_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversion history"
  ON balance_conversion_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all conversion history"
  ON balance_conversion_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role = 'admin'
    )
  );

-- ============================================================================
-- 3. ONE-TIME CONVERSION OF EXISTING EARNED BALANCES
-- ============================================================================

CREATE OR REPLACE FUNCTION convert_earned_to_promotional()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_users integer := 0;
  v_total_converted integer := 0;
  v_conversion_record record;
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can perform balance conversion';
  END IF;
  
  -- Convert all earned balances to promotional credits
  FOR v_conversion_record IN 
    SELECT 
      user_id,
      earned_balance,
      promo_balance
    FROM treat_wallets
    WHERE earned_balance > 0
  LOOP
    v_total_users := v_total_users + 1;
    v_total_converted := v_total_converted + v_conversion_record.earned_balance;
    
    -- Update wallet
    UPDATE treat_wallets
    SET 
      promo_balance = promo_balance + earned_balance,
      promo_lifetime_earned = promo_lifetime_earned + earned_balance,
      earned_balance = 0,
      updated_at = NOW()
    WHERE user_id = v_conversion_record.user_id;
    
    -- Record conversion
    INSERT INTO balance_conversion_history (
      user_id,
      conversion_type,
      amount_treats,
      previous_earned_balance,
      new_promo_balance,
      reason,
      converted_by,
      notes
    ) VALUES (
      v_conversion_record.user_id,
      'earned_to_promo',
      v_conversion_record.earned_balance,
      v_conversion_record.earned_balance,
      v_conversion_record.promo_balance + v_conversion_record.earned_balance,
      'Option B restructuring: Converting earned balance to promotional credits',
      auth.uid(),
      'One-time conversion as part of financial restructuring'
    );
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'total_users_converted', v_total_users,
    'total_treats_converted', v_total_converted,
    'message', format('Successfully converted %s treats from %s users to promotional credits', 
                      v_total_converted, v_total_users)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION convert_earned_to_promotional TO authenticated;

-- ============================================================================
-- 4. PROMOTIONAL CREDITS USAGE TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS promo_credit_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  usage_type text NOT NULL CHECK (usage_type IN ('promotion', 'tip', 'purchase', 'other')),
  amount_treats integer NOT NULL,
  reference_id uuid,
  reference_type text,
  description text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_promo_usage_user ON promo_credit_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_promo_usage_date ON promo_credit_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promo_usage_type ON promo_credit_usage(usage_type);

-- RLS
ALTER TABLE promo_credit_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own promo usage"
  ON promo_credit_usage FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert promo usage"
  ON promo_credit_usage FOR INSERT
  WITH CHECK (true);

-- ============================================================================
-- 5. UPDATED TREAT BALANCE FUNCTIONS WITH PROMO SUPPORT
-- ============================================================================

CREATE OR REPLACE FUNCTION add_promo_balance(
  p_user_id uuid,
  p_amount integer,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  -- Add promotional credits
  UPDATE treat_wallets
  SET 
    promo_balance = promo_balance + p_amount,
    promo_lifetime_earned = promo_lifetime_earned + p_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING promo_balance INTO v_new_balance;
  
  IF v_new_balance IS NULL THEN
    -- Create wallet if doesn't exist
    INSERT INTO treat_wallets (
      user_id,
      promo_balance,
      promo_lifetime_earned
    ) VALUES (
      p_user_id,
      p_amount,
      p_amount
    )
    RETURNING promo_balance INTO v_new_balance;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'new_promo_balance', v_new_balance,
    'amount_added', p_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION add_promo_balance TO authenticated;

CREATE OR REPLACE FUNCTION spend_promo_balance(
  p_user_id uuid,
  p_amount integer,
  p_usage_type text,
  p_reference_id uuid DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_balance integer;
  v_new_balance integer;
BEGIN
  -- Check current balance
  SELECT promo_balance INTO v_current_balance
  FROM treat_wallets
  WHERE user_id = p_user_id;
  
  IF v_current_balance IS NULL OR v_current_balance < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient promotional credits',
      'current_balance', COALESCE(v_current_balance, 0),
      'required', p_amount
    );
  END IF;
  
  -- Deduct promotional credits
  UPDATE treat_wallets
  SET 
    promo_balance = promo_balance - p_amount,
    promo_lifetime_spent = promo_lifetime_spent + p_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING promo_balance INTO v_new_balance;
  
  -- Track usage
  INSERT INTO promo_credit_usage (
    user_id,
    usage_type,
    amount_treats,
    reference_id,
    reference_type,
    description
  ) VALUES (
    p_user_id,
    p_usage_type,
    p_amount,
    p_reference_id,
    p_reference_type,
    p_description
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'new_promo_balance', v_new_balance,
    'amount_spent', p_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION spend_promo_balance TO authenticated;

-- ============================================================================
-- 6. UPDATE CONTRIBUTION REWARDS TO USE PROMO CREDITS
-- ============================================================================

CREATE OR REPLACE FUNCTION record_listener_contribution_v2(
  p_user_id uuid,
  p_activity_type text,
  p_reference_id uuid DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contribution_result jsonb;
  v_points_earned integer;
BEGIN
  -- Call existing contribution function
  v_contribution_result := record_listener_contribution(
    p_user_id,
    p_activity_type,
    p_reference_id,
    p_reference_type,
    p_metadata
  );
  
  -- If successful, add promotional credits instead of earned balance
  IF (v_contribution_result->>'success')::boolean THEN
    v_points_earned := (v_contribution_result->>'points_earned')::integer;
    
    -- Add as promotional credits
    PERFORM add_promo_balance(
      p_user_id,
      v_points_earned,
      format('Contribution reward: %s', p_activity_type)
    );
    
    -- Update result to indicate promo credits
    v_contribution_result := v_contribution_result || jsonb_build_object(
      'reward_type', 'promotional_credits',
      'promo_credits_earned', v_points_earned
    );
  END IF;
  
  RETURN v_contribution_result;
END;
$$;

GRANT EXECUTE ON FUNCTION record_listener_contribution_v2 TO authenticated, anon;

-- ============================================================================
-- 7. ADMIN FUNCTIONS FOR PROMO CREDIT MANAGEMENT
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_promo_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can view promotional credit stats';
  END IF;
  
  RETURN jsonb_build_object(
    'total_promo_balance', (
      SELECT COALESCE(SUM(promo_balance), 0)
      FROM treat_wallets
    ),
    'total_promo_earned', (
      SELECT COALESCE(SUM(promo_lifetime_earned), 0)
      FROM treat_wallets
    ),
    'total_promo_spent', (
      SELECT COALESCE(SUM(promo_lifetime_spent), 0)
      FROM treat_wallets
    ),
    'usage_by_type', (
      SELECT jsonb_object_agg(usage_type, total)
      FROM (
        SELECT usage_type, SUM(amount_treats) as total
        FROM promo_credit_usage
        GROUP BY usage_type
      ) usage_stats
    ),
    'active_users_with_promo', (
      SELECT COUNT(*)
      FROM treat_wallets
      WHERE promo_balance > 0
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_promo_stats TO authenticated;
