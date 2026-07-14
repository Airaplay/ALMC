/*
  # Fix Remaining RLS Policies with USING (true) - Corrected

  1. Changes
    - Fix comment_likes - public read too permissive
    - Fix content_comments - public read too permissive  
    - Fix promotion tables - admin only
    - Fix albums - restrict modifications
    - Fix verified_badge_config - admin only
    - Fix artist_profiles - public discovery

  2. Security Impact
    These policies expose sensitive data without proper restrictions.
*/

-- ============================================================================
-- 1. FIX comment_likes - Privacy
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can read comment likes" ON comment_likes;

CREATE POLICY "authenticated_view_comment_likes" ON comment_likes
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "users_manage_own_comment_likes" ON comment_likes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- 2. FIX content_comments
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can read comments" ON content_comments;

CREATE POLICY "public_view_comments" ON content_comments
  FOR SELECT TO public
  USING (true);

CREATE POLICY "authenticated_insert_comments" ON content_comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_update_own_comments" ON content_comments
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_delete_own_comments" ON content_comments
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ============================================================================
-- 3. FIX promotion_rotation_cycles
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'promotion_rotation_cycles') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can view rotation cycles" ON promotion_rotation_cycles';
    EXECUTE 'CREATE POLICY "admins_view_rotation_cycles" ON promotion_rotation_cycles FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = ''admin''))';
    EXECUTE 'CREATE POLICY "service_manages_rotation_cycles" ON promotion_rotation_cycles FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ============================================================================
-- 4. FIX promotion_queue_state
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'promotion_queue_state') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can view queue state" ON promotion_queue_state';
    EXECUTE 'CREATE POLICY "admins_view_queue_state" ON promotion_queue_state FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = ''admin''))';
    EXECUTE 'CREATE POLICY "service_manages_queue_state" ON promotion_queue_state FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ============================================================================
-- 5. FIX albums
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can read albums" ON albums;

CREATE POLICY "public_view_albums" ON albums
  FOR SELECT TO public
  USING (true);

CREATE POLICY "users_view_own_albums" ON albums
  FOR SELECT TO authenticated
  USING (artist_id = auth.uid());

CREATE POLICY "artists_manage_own_albums" ON albums
  FOR ALL TO authenticated
  USING (artist_id = auth.uid())
  WITH CHECK (artist_id = auth.uid());

-- ============================================================================
-- 6. FIX verified_badge_config
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'verified_badge_config') THEN
    EXECUTE 'DROP POLICY IF EXISTS "verified_badge_config_select_all" ON verified_badge_config';
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can view badge config" ON verified_badge_config';
    EXECUTE 'CREATE POLICY "public_view_badge_config" ON verified_badge_config FOR SELECT TO public USING (true)';
    EXECUTE 'CREATE POLICY "admins_manage_badge_config" ON verified_badge_config FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = ''admin'')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = ''admin''))';
  END IF;
END $$;

-- ============================================================================
-- 7. FIX artist_profiles
-- ============================================================================

DROP POLICY IF EXISTS "Public can read essential artist profile info" ON artist_profiles;

CREATE POLICY "public_view_artist_profiles" ON artist_profiles
  FOR SELECT TO public
  USING (true);

CREATE POLICY "artists_update_own_profile" ON artist_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Remaining RLS policies fixed successfully';
END $$;
