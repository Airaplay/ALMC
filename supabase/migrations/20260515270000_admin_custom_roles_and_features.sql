/*
  # Admin custom roles and dashboard features

  Adds a feature-based admin role layer on top of the existing users.role values.
  Existing legacy roles keep their backend behavior, while custom roles can define
  exactly which dashboard sections appear and render in the admin UI.
*/

CREATE TABLE IF NOT EXISTS public.admin_dashboard_features (
  key text PRIMARY KEY,
  label text NOT NULL,
  group_key text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_dashboard_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  legacy_role text NOT NULL CHECK (legacy_role IN ('admin', 'manager', 'editor', 'account')),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_dashboard_role_features (
  role_id uuid NOT NULL REFERENCES public.admin_dashboard_roles(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES public.admin_dashboard_features(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, feature_key)
);

CREATE TABLE IF NOT EXISTS public.admin_user_role_assignments (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.admin_dashboard_roles(id) ON DELETE RESTRICT,
  assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_dashboard_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_dashboard_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_dashboard_role_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_user_role_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_dashboard_features FROM PUBLIC;
REVOKE ALL ON public.admin_dashboard_roles FROM PUBLIC;
REVOKE ALL ON public.admin_dashboard_role_features FROM PUBLIC;
REVOKE ALL ON public.admin_user_role_assignments FROM PUBLIC;

CREATE INDEX IF NOT EXISTS idx_admin_dashboard_roles_key ON public.admin_dashboard_roles(key);
CREATE INDEX IF NOT EXISTS idx_admin_dashboard_roles_active ON public.admin_dashboard_roles(is_active);
CREATE INDEX IF NOT EXISTS idx_admin_user_role_assignments_role_id ON public.admin_user_role_assignments(role_id);

INSERT INTO public.admin_dashboard_features (key, label, group_key, sort_order) VALUES
  ('analytics', 'Dashboard', 'overview', 10),
  ('country_performance', 'Country Performance', 'overview', 20),
  ('analysis', 'Ad Analysis', 'overview', 30),
  ('users', 'User Management', 'users', 110),
  ('content', 'Content Management', 'users', 120),
  ('content_thresholds', 'Section Thresholds', 'users', 130),
  ('featured_artists', 'Featured Artists', 'users', 140),
  ('reports', 'Reports', 'users', 150),
  ('flagged', 'Flagged', 'users', 160),
  ('earnings', 'Earnings & Payouts', 'monetization', 210),
  ('support', 'Support & Withdrawals', 'monetization', 220),
  ('treat_manager', 'Treat Manager', 'monetization', 230),
  ('external_revenue', 'External Revenue', 'monetization', 240),
  ('promotional_credits', 'Promo Credits', 'monetization', 250),
  ('payment_monitoring', 'Payment Monitoring', 'accountant', 310),
  ('withdrawal_requests', 'Withdrawal Requests', 'accountant', 320),
  ('exchange_rates', 'Exchange Rates', 'accountant', 330),
  ('financial_controls', 'Financial Controls', 'accountant', 340),
  ('accounting', 'Accounting', 'accountant', 350),
  ('artist_earnings_ledger', 'Artist Earnings Ledger', 'accountant', 360),
  ('listener_earnings_ledger', 'Listener Earnings Ledger', 'accountant', 370),
  ('ad_management', 'Ad Management', 'advertising', 410),
  ('native_ads', 'Native Ads', 'advertising', 420),
  ('web_ads', 'Web Ads', 'advertising', 430),
  ('feature_banners', 'Feature Banners', 'advertising', 440),
  ('promotion_manager', 'Promotions', 'engagement', 510),
  ('listener_curations', 'Listener Curations', 'engagement', 520),
  ('contribution_rewards', 'Contribution System', 'engagement', 530),
  ('daily_checkin', 'Daily Check-in', 'engagement', 540),
  ('referral_management', 'Referrals', 'engagement', 550),
  ('announcements', 'Announcements', 'engagement', 560),
  ('mix_manager', 'Mix Manager', 'system', 610),
  ('daily_mix_manager', 'Daily Mix AI', 'system', 620),
  ('global_daily_mix_manager', 'Global Daily Mix', 'system', 630),
  ('genre_manager', 'Genre Manager', 'system', 640),
  ('mood_analysis', 'Mood Analysis', 'system', 650),
  ('faqs', 'FAQs', 'system', 660),
  ('blog', 'Blog', 'system', 670),
  ('settings', 'Settings', 'account', 710),
  ('admin_settings', 'Admin Settings & Roles', 'account', 720)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  group_key = EXCLUDED.group_key,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

INSERT INTO public.admin_dashboard_roles (key, name, description, legacy_role, is_system, is_active)
VALUES
  ('admin', 'Admin', 'Full access to all admin dashboard features.', 'admin', true, true),
  ('manager', 'Manager', 'Operational admin role for content, engagement, analytics, ads, and system tools.', 'manager', true, true),
  ('editor', 'Editor', 'Content publishing and documentation role.', 'editor', true, true),
  ('account', 'Account', 'Finance and accounting role.', 'account', true, true)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  legacy_role = EXCLUDED.legacy_role,
  is_system = true,
  is_active = true,
  updated_at = now();

DELETE FROM public.admin_dashboard_role_features
WHERE role_id IN (
  SELECT id FROM public.admin_dashboard_roles WHERE key IN ('admin', 'manager', 'editor', 'account')
);

INSERT INTO public.admin_dashboard_role_features (role_id, feature_key)
SELECT r.id, f.key
FROM public.admin_dashboard_roles r
CROSS JOIN public.admin_dashboard_features f
WHERE r.key = 'admin'
  AND f.is_active = true;

INSERT INTO public.admin_dashboard_role_features (role_id, feature_key)
SELECT r.id, f.key
FROM public.admin_dashboard_roles r
JOIN public.admin_dashboard_features f ON f.key = ANY (ARRAY[
  'analytics', 'analysis', 'users', 'content', 'content_thresholds', 'featured_artists',
  'reports', 'flagged', 'earnings', 'support', 'ad_management', 'native_ads', 'web_ads',
  'feature_banners', 'promotion_manager', 'listener_curations', 'contribution_rewards',
  'daily_checkin', 'referral_management', 'announcements', 'mix_manager', 'daily_mix_manager',
  'global_daily_mix_manager', 'genre_manager', 'mood_analysis', 'faqs', 'blog', 'settings'
])
WHERE r.key = 'manager'
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_dashboard_role_features (role_id, feature_key)
SELECT r.id, f.key
FROM public.admin_dashboard_roles r
JOIN public.admin_dashboard_features f ON f.key = ANY (ARRAY['content', 'faqs', 'blog'])
WHERE r.key = 'editor'
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_dashboard_role_features (role_id, feature_key)
SELECT r.id, f.key
FROM public.admin_dashboard_roles r
JOIN public.admin_dashboard_features f ON f.key = ANY (ARRAY[
  'analytics', 'earnings', 'withdrawal_requests', 'exchange_rates', 'support',
  'payment_monitoring', 'financial_controls', 'promotional_credits', 'treat_manager',
  'country_performance', 'accounting', 'artist_earnings_ledger',
  'listener_earnings_ledger', 'external_revenue'
])
WHERE r.key = 'account'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_current_user_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
      AND COALESCE(is_active, true) = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.admin_current_user_is_super_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_slugify_role_name(name_param text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO public, pg_temp
AS $$
  SELECT trim(both '_' FROM regexp_replace(lower(coalesce(name_param, '')), '[^a-z0-9]+', '_', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.admin_get_current_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_role text;
  v_is_active boolean;
  v_role public.admin_dashboard_roles%ROWTYPE;
  v_features text[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('has_access', false, 'features', '[]'::jsonb);
  END IF;

  SELECT role, COALESCE(is_active, true)
  INTO v_user_role, v_is_active
  FROM public.users
  WHERE id = v_uid;

  IF NOT FOUND OR v_is_active IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('has_access', false, 'features', '[]'::jsonb);
  END IF;

  IF v_user_role = 'admin' THEN
    SELECT * INTO v_role
    FROM public.admin_dashboard_roles
    WHERE key = 'admin' AND is_active = true
    LIMIT 1;
  ELSE
    SELECT r.* INTO v_role
    FROM public.admin_user_role_assignments ura
    JOIN public.admin_dashboard_roles r ON r.id = ura.role_id
    WHERE ura.user_id = v_uid
      AND r.is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT * INTO v_role
      FROM public.admin_dashboard_roles
      WHERE key = v_user_role
        AND is_system = true
        AND is_active = true
      LIMIT 1;
    END IF;
  END IF;

  IF v_role.id IS NULL THEN
    RETURN jsonb_build_object('has_access', false, 'features', '[]'::jsonb, 'legacy_role', v_user_role);
  END IF;

  SELECT COALESCE(array_agg(f.key ORDER BY f.sort_order), ARRAY[]::text[])
  INTO v_features
  FROM public.admin_dashboard_role_features rf
  JOIN public.admin_dashboard_features f ON f.key = rf.feature_key
  WHERE rf.role_id = v_role.id
    AND f.is_active = true;

  RETURN jsonb_build_object(
    'has_access', true,
    'role_id', v_role.id,
    'role_key', v_role.key,
    'role_name', v_role.name,
    'legacy_role', v_user_role,
    'role_legacy_role', v_role.legacy_role,
    'is_super_admin', v_user_role = 'admin',
    'features', COALESCE(to_jsonb(v_features), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_current_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_has_feature(feature_key_param text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_access jsonb;
BEGIN
  v_access := public.admin_get_current_access();
  IF COALESCE((v_access ->> 'is_super_admin')::boolean, false) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(v_access -> 'features', '[]'::jsonb)) AS feature(key)
    WHERE feature.key = feature_key_param
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_has_feature(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_features()
RETURNS TABLE (
  key text,
  label text,
  group_key text,
  sort_order integer,
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_current_user_is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can manage admin roles';
  END IF;

  RETURN QUERY
  SELECT f.key, f.label, f.group_key, f.sort_order, f.is_active
  FROM public.admin_dashboard_features f
  ORDER BY f.sort_order, f.label;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_features() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_roles()
RETURNS TABLE (
  id uuid,
  key text,
  name text,
  description text,
  legacy_role text,
  is_system boolean,
  is_active boolean,
  feature_keys text[],
  feature_count bigint,
  assigned_count bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_current_user_is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can manage admin roles';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.key,
    r.name,
    r.description,
    r.legacy_role,
    r.is_system,
    r.is_active,
    COALESCE(array_agg(rf.feature_key ORDER BY f.sort_order) FILTER (WHERE rf.feature_key IS NOT NULL), ARRAY[]::text[]) AS feature_keys,
    COUNT(rf.feature_key)::bigint AS feature_count,
    COUNT(DISTINCT ura.user_id)::bigint AS assigned_count,
    r.created_at
  FROM public.admin_dashboard_roles r
  LEFT JOIN public.admin_dashboard_role_features rf ON rf.role_id = r.id
  LEFT JOIN public.admin_dashboard_features f ON f.key = rf.feature_key
  LEFT JOIN public.admin_user_role_assignments ura ON ura.role_id = r.id
  GROUP BY r.id
  ORDER BY r.is_system DESC, r.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_roles() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_role(
  name_param text,
  description_param text DEFAULT NULL,
  legacy_role_param text DEFAULT 'manager',
  feature_keys_param text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_key text;
  v_role_id uuid;
BEGIN
  IF NOT public.admin_current_user_is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only super admins can create roles');
  END IF;

  IF length(trim(coalesce(name_param, ''))) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Role name is required');
  END IF;

  IF legacy_role_param NOT IN ('manager', 'editor', 'account') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Custom roles must use manager, editor, or account as their backend role');
  END IF;

  v_key := 'custom_' || public.admin_slugify_role_name(name_param);
  IF v_key = 'custom_' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Role name must contain letters or numbers');
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_dashboard_roles WHERE key = v_key) THEN
    v_key := v_key || '_' || substr(md5(random()::text), 1, 6);
  END IF;

  INSERT INTO public.admin_dashboard_roles (key, name, description, legacy_role, is_system, created_by)
  VALUES (v_key, trim(name_param), nullif(trim(coalesce(description_param, '')), ''), legacy_role_param, false, auth.uid())
  RETURNING id INTO v_role_id;

  INSERT INTO public.admin_dashboard_role_features (role_id, feature_key)
  SELECT v_role_id, f.key
  FROM public.admin_dashboard_features f
  WHERE f.key = ANY (COALESCE(feature_keys_param, ARRAY[]::text[]))
    AND f.is_active = true
  ON CONFLICT DO NOTHING;

  PERFORM public.log_admin_activity_with_context(
    'create_admin_role',
    jsonb_build_object('role_id', v_role_id, 'role_key', v_key, 'role_name', trim(name_param), 'legacy_role', legacy_role_param),
    '',
    ''
  );

  RETURN jsonb_build_object('success', true, 'role_id', v_role_id, 'role_key', v_key);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_role(text, text, text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_role_features(
  role_id_param uuid,
  feature_keys_param text[] DEFAULT ARRAY[]::text[],
  name_param text DEFAULT NULL,
  description_param text DEFAULT NULL,
  legacy_role_param text DEFAULT NULL,
  is_active_param boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_role public.admin_dashboard_roles%ROWTYPE;
BEGIN
  IF NOT public.admin_current_user_is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only super admins can update roles');
  END IF;

  SELECT * INTO v_role
  FROM public.admin_dashboard_roles
  WHERE id = role_id_param;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Role not found');
  END IF;

  IF v_role.key = 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'The Admin role always has full access and cannot be edited');
  END IF;

  IF legacy_role_param IS NOT NULL AND legacy_role_param NOT IN ('manager', 'editor', 'account') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Custom roles must use manager, editor, or account as their backend role');
  END IF;

  UPDATE public.admin_dashboard_roles
  SET
    name = CASE WHEN NOT is_system AND name_param IS NOT NULL AND length(trim(name_param)) > 0 THEN trim(name_param) ELSE name END,
    description = CASE WHEN NOT is_system AND description_param IS NOT NULL THEN nullif(trim(description_param), '') ELSE description END,
    legacy_role = CASE WHEN NOT is_system AND legacy_role_param IS NOT NULL THEN legacy_role_param ELSE legacy_role END,
    is_active = COALESCE(is_active_param, is_active),
    updated_at = now()
  WHERE id = role_id_param;

  DELETE FROM public.admin_dashboard_role_features
  WHERE role_id = role_id_param;

  INSERT INTO public.admin_dashboard_role_features (role_id, feature_key)
  SELECT role_id_param, f.key
  FROM public.admin_dashboard_features f
  WHERE f.key = ANY (COALESCE(feature_keys_param, ARRAY[]::text[]))
    AND f.is_active = true
  ON CONFLICT DO NOTHING;

  PERFORM public.log_admin_activity_with_context(
    'update_admin_role',
    jsonb_build_object('role_id', role_id_param, 'role_key', v_role.key),
    '',
    ''
  );

  RETURN jsonb_build_object('success', true, 'role_id', role_id_param);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_role_features(uuid, text[], text, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_assign_role(
  user_email_param text,
  role_param text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_current_user_id uuid := auth.uid();
  v_target_user_id uuid;
  v_target_user_role text;
  v_role public.admin_dashboard_roles%ROWTYPE;
BEGIN
  IF NOT public.admin_current_user_is_super_admin() THEN
    RETURN jsonb_build_object('error', 'Only super admins can assign admin roles');
  END IF;

  SELECT * INTO v_role
  FROM public.admin_dashboard_roles r
  WHERE r.is_active = true
    AND (r.key = lower(role_param) OR r.id::text = role_param)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Role not found or inactive');
  END IF;

  SELECT id, role INTO v_target_user_id, v_target_user_role
  FROM public.users
  WHERE lower(email) = lower(trim(user_email_param));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  UPDATE public.users
  SET
    role = CASE WHEN v_role.is_system THEN v_role.key ELSE v_role.legacy_role END,
    updated_at = now()
  WHERE id = v_target_user_id;

  IF v_role.is_system THEN
    DELETE FROM public.admin_user_role_assignments
    WHERE user_id = v_target_user_id;
  ELSE
    INSERT INTO public.admin_user_role_assignments (user_id, role_id, assigned_by, assigned_at)
    VALUES (v_target_user_id, v_role.id, v_current_user_id, now())
    ON CONFLICT (user_id) DO UPDATE SET
      role_id = EXCLUDED.role_id,
      assigned_by = EXCLUDED.assigned_by,
      assigned_at = EXCLUDED.assigned_at;
  END IF;

  PERFORM public.log_admin_activity_with_context(
    'assign_role',
    jsonb_build_object(
      'user_id', v_target_user_id,
      'user_email', user_email_param,
      'previous_role', v_target_user_role,
      'new_role', v_role.key,
      'new_role_name', v_role.name,
      'legacy_role', CASE WHEN v_role.is_system THEN v_role.key ELSE v_role.legacy_role END
    ),
    '',
    ''
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', format('User %s role updated to %s', user_email_param, v_role.name),
    'user_id', v_target_user_id,
    'role_id', v_role.id,
    'role_key', v_role.key
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_assign_role(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_role(
  user_id_param uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_current_user_id uuid := auth.uid();
  v_target_user_email text;
  v_target_user_role text;
  v_target_custom_role text;
BEGIN
  IF NOT public.admin_current_user_is_super_admin() THEN
    RETURN jsonb_build_object('error', 'Only super admins can revoke admin roles');
  END IF;

  IF user_id_param = v_current_user_id THEN
    RETURN jsonb_build_object('error', 'You cannot revoke your own admin role');
  END IF;

  SELECT u.email, u.role, r.key
  INTO v_target_user_email, v_target_user_role, v_target_custom_role
  FROM public.users u
  LEFT JOIN public.admin_user_role_assignments ura ON ura.user_id = u.id
  LEFT JOIN public.admin_dashboard_roles r ON r.id = ura.role_id
  WHERE u.id = user_id_param;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  IF v_target_user_role NOT IN ('admin', 'manager', 'editor', 'account') AND v_target_custom_role IS NULL THEN
    RETURN jsonb_build_object('error', 'User does not have an admin role to revoke');
  END IF;

  DELETE FROM public.admin_user_role_assignments
  WHERE user_id = user_id_param;

  UPDATE public.users
  SET role = 'listener',
      updated_at = now()
  WHERE id = user_id_param;

  PERFORM public.log_admin_activity_with_context(
    'revoke_role',
    jsonb_build_object(
      'user_id', user_id_param,
      'user_email', v_target_user_email,
      'previous_role', COALESCE(v_target_custom_role, v_target_user_role),
      'new_role', 'listener'
    ),
    '',
    ''
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Admin role revoked from user %s', v_target_user_email),
    'user_id', user_id_param
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_revoke_role(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_get_admin_users();

CREATE OR REPLACE FUNCTION public.admin_get_admin_users()
RETURNS TABLE (
  id uuid,
  email text,
  display_name text,
  role text,
  role_name text,
  legacy_role text,
  is_custom_role boolean,
  feature_count bigint,
  created_at timestamptz,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_current_user_is_super_admin() THEN
    RAISE EXCEPTION 'Access denied. Super admin privileges required.';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.display_name,
    COALESCE(r.key, u.role) AS role,
    COALESCE(r.name, initcap(u.role)) AS role_name,
    u.role AS legacy_role,
    (r.id IS NOT NULL AND r.is_system = false) AS is_custom_role,
    COUNT(rf.feature_key)::bigint AS feature_count,
    u.created_at,
    (
      SELECT MAX(al.created_at)
      FROM public.admin_activity_logs al
      WHERE al.admin_id = u.id
    ) AS last_activity
  FROM public.users u
  LEFT JOIN public.admin_user_role_assignments ura ON ura.user_id = u.id
  LEFT JOIN public.admin_dashboard_roles r ON r.id = ura.role_id
  LEFT JOIN public.admin_dashboard_role_features rf ON rf.role_id = COALESCE(r.id, (
    SELECT sr.id FROM public.admin_dashboard_roles sr WHERE sr.key = u.role AND sr.is_system = true LIMIT 1
  ))
  WHERE u.role IN ('admin', 'manager', 'editor', 'account')
     OR ura.user_id IS NOT NULL
  GROUP BY u.id, r.id
  ORDER BY
    CASE COALESCE(r.legacy_role, u.role)
      WHEN 'admin' THEN 1
      WHEN 'manager' THEN 2
      WHEN 'editor' THEN 3
      WHEN 'account' THEN 4
      ELSE 5
    END,
    u.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_admin_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_activity_logs(
  admin_id_filter uuid DEFAULT NULL,
  action_type_filter text DEFAULT NULL,
  start_date timestamptz DEFAULT (now() - interval '30 days'),
  end_date timestamptz DEFAULT now(),
  limit_param integer DEFAULT 100,
  offset_param integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  admin_id uuid,
  admin_email text,
  admin_name text,
  admin_role text,
  action_type text,
  action_details jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_current_user_is_super_admin() THEN
    RAISE EXCEPTION 'Access denied. Super admin privileges required.';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    al.admin_id,
    u.email AS admin_email,
    u.display_name AS admin_name,
    COALESCE(r.name, initcap(u.role)) AS admin_role,
    al.action_type,
    al.details AS action_details,
    COALESCE(al.ip_address, '') AS ip_address,
    COALESCE(al.user_agent, '') AS user_agent,
    al.created_at
  FROM public.admin_activity_logs al
  LEFT JOIN public.users u ON al.admin_id = u.id
  LEFT JOIN public.admin_user_role_assignments ura ON ura.user_id = u.id
  LEFT JOIN public.admin_dashboard_roles r ON r.id = ura.role_id
  WHERE (admin_id_filter IS NULL OR al.admin_id = admin_id_filter)
    AND (action_type_filter IS NULL OR al.action_type = action_type_filter)
    AND al.created_at BETWEEN start_date AND end_date
  ORDER BY al.created_at DESC
  LIMIT limit_param
  OFFSET offset_param;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_activity_logs(uuid, text, timestamptz, timestamptz, integer, integer) TO authenticated;
