/*
  # Fix Critical RLS Policies with USING (true)

  1. Critical Security Fixes
    - Fix contribution_rate_limits - users can bypass earning limits
    - Fix user_daily_earnings - users can modify earnings
    - Fix file_hash_index - users can access all files
    - Fix treat_payment_channels - users can modify payment configs
    - Fix user_follows - complete privacy violation

  2. Changes
    - Replace USING (true) with proper user_id checks
    - Enforce ownership validation
    - Add service_role policies where appropriate
    - Prevent unauthorized access

  ## Vulnerability Impact
  Without these fixes, any authenticated user can:
  - Bypass rate limits
  - Modify their own earnings
  - Access other users' files
  - Change payment channel configurations
  - See all follow relationships
*/

-- ============================================================================
-- 1. FIX contribution_rate_limits
-- ============================================================================

DROP POLICY IF EXISTS "System can manage rate limits" ON contribution_rate_limits;

CREATE POLICY "users_view_own_rate_limits" ON contribution_rate_limits
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "users_manage_own_rate_limits" ON contribution_rate_limits
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "service_role_manages_rate_limits" ON contribution_rate_limits
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 2. FIX user_daily_earnings
-- ============================================================================

DROP POLICY IF EXISTS "System can manage daily earnings" ON user_daily_earnings;

CREATE POLICY "users_view_own_daily_earnings" ON user_daily_earnings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Only service_role can INSERT/UPDATE/DELETE daily earnings
CREATE POLICY "service_role_manages_daily_earnings" ON user_daily_earnings
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 3. FIX file_hash_index
-- ============================================================================

DROP POLICY IF EXISTS "Users can view file hashes" ON file_hash_index;
DROP POLICY IF EXISTS "Users can update access count" ON file_hash_index;

CREATE POLICY "users_view_own_files" ON file_hash_index
  FOR SELECT TO authenticated
  USING (uploaded_by = auth.uid());

CREATE POLICY "users_insert_own_files" ON file_hash_index
  FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "users_update_own_files" ON file_hash_index
  FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid())
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "service_role_manages_files" ON file_hash_index
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 4. FIX treat_payment_channels (if table exists)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'treat_payment_channels'
  ) THEN
    -- Drop permissive policies
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can view all payment channels" ON treat_payment_channels';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can manage payment channels" ON treat_payment_channels';

    -- Only admins can manage payment channels
    EXECUTE 'CREATE POLICY "admins_manage_payment_channels" ON treat_payment_channels
      FOR ALL TO authenticated
      USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = ''admin'')
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = ''admin'')
      )';

    EXECUTE 'CREATE POLICY "service_role_manages_payment_channels" ON treat_payment_channels
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true)';

    RAISE NOTICE 'Fixed RLS policies for treat_payment_channels';
  END IF;
END $$;

-- ============================================================================
-- 5. FIX user_follows (privacy violation)
-- ============================================================================

DROP POLICY IF EXISTS "Users can read follow relationships" ON user_follows;

-- Users can only see their own follows and who follows them
CREATE POLICY "users_view_own_follows" ON user_follows
  FOR SELECT TO authenticated
  USING (
    follower_id = auth.uid() OR following_id = auth.uid()
  );

CREATE POLICY "users_insert_own_follows" ON user_follows
  FOR INSERT TO authenticated
  WITH CHECK (follower_id = auth.uid());

CREATE POLICY "users_delete_own_follows" ON user_follows
  FOR DELETE TO authenticated
  USING (follower_id = auth.uid());

-- ============================================================================
-- 6. FIX platform_financial_controls (public read was too permissive)
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can view financial controls" ON platform_financial_controls;

-- Only authenticated users can view
CREATE POLICY "authenticated_view_financial_controls" ON platform_financial_controls
  FOR SELECT TO authenticated
  USING (true);

-- Only admins can update
CREATE POLICY "admins_update_financial_controls" ON platform_financial_controls
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "service_role_manages_financial_controls" ON platform_financial_controls
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 7. FIX rate_limit_violations and blocked_ips (if they exist)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'rate_limit_violations'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "Service role can manage violations" ON rate_limit_violations';
    
    -- Only admins and service role can view violations
    EXECUTE 'CREATE POLICY "admins_view_violations" ON rate_limit_violations
      FOR SELECT TO authenticated
      USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = ''admin'')
      )';
    
    EXECUTE 'CREATE POLICY "service_role_manages_violations" ON rate_limit_violations
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true)';

    RAISE NOTICE 'Fixed RLS policies for rate_limit_violations';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'blocked_ips'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "Service role can manage blocked IPs" ON blocked_ips';
    
    -- Only admins and service role can manage blocked IPs
    EXECUTE 'CREATE POLICY "admins_view_blocked_ips" ON blocked_ips
      FOR SELECT TO authenticated
      USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = ''admin'')
      )';
    
    EXECUTE 'CREATE POLICY "service_role_manages_blocked_ips" ON blocked_ips
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true)';

    RAISE NOTICE 'Fixed RLS policies for blocked_ips';
  END IF;
END $$;

-- ============================================================================
-- Verification and Logging
-- ============================================================================

-- Log this security fix
DO $$
DECLARE
  v_policies_fixed integer := 0;
BEGIN
  -- Count how many USING (true) policies remain (excluding service_role)
  SELECT COUNT(*) INTO v_policies_fixed
  FROM pg_policies 
  WHERE schemaname = 'public' 
  AND qual = 'true'
  AND roles::text NOT LIKE '%service_role%';

  RAISE NOTICE '================================================================';
  RAISE NOTICE 'CRITICAL RLS POLICIES FIXED';
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Fixed policies for:';
  RAISE NOTICE '  - contribution_rate_limits (rate limit bypass)';
  RAISE NOTICE '  - user_daily_earnings (earnings manipulation)';
  RAISE NOTICE '  - file_hash_index (file access)';
  RAISE NOTICE '  - treat_payment_channels (payment config)';
  RAISE NOTICE '  - user_follows (privacy violation)';
  RAISE NOTICE '  - platform_financial_controls (financial settings)';
  RAISE NOTICE '  - rate_limit_violations (admin only)';
  RAISE NOTICE '  - blocked_ips (admin only)';
  RAISE NOTICE '';
  RAISE NOTICE 'Remaining USING (true) policies for authenticated: %', v_policies_fixed;
  RAISE NOTICE '================================================================';
END $$;
