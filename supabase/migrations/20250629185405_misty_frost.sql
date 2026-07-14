/*
  # Admin Roles and Settings System

  1. Changes
    - Update users.role constraint to include 'manager' and 'editor' roles
    - Create admin_activity_log table to track admin actions
    - Add functions to manage admin users and roles
    - Add functions to log admin activity

  2. Security
    - Only super admins can manage other admin users
    - All admin actions are logged for accountability
    - Proper RLS policies for admin activity logs
*/

-- Update the role check constraint to include new roles
DO $$
BEGIN
  ALTER TABLE users 
  DROP CONSTRAINT IF EXISTS users_role_check;
  
  ALTER TABLE users 
  ADD CONSTRAINT users_role_check 
  CHECK (role = ANY (ARRAY['listener'::text, 'creator'::text, 'admin'::text, 'manager'::text, 'editor'::text]));
END $$;

-- Create admin_activity_log table
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  action_details jsonb NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE admin_activity_log ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_admin_id ON admin_activity_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_action_type ON admin_activity_log(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created_at ON admin_activity_log(created_at DESC);

-- RLS Policies for admin_activity_log table
-- Only admins can view admin activity logs
CREATE POLICY "Admins can view admin activity logs"
ON admin_activity_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager')
  )
);

-- Function to log admin activity
CREATE OR REPLACE FUNCTION log_admin_activity(
  action_type_param text,
  action_details_param jsonb,
  ip_address_param text DEFAULT NULL,
  user_agent_param text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  log_id uuid;
BEGIN
  -- Check if user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = current_user_id
    AND role IN ('admin', 'manager', 'editor')
  ) THEN
    RAISE EXCEPTION 'Only administrators can log activities';
  END IF;

  -- Insert activity log
  INSERT INTO admin_activity_log (
    admin_id,
    action_type,
    action_details,
    ip_address,
    user_agent
  ) VALUES (
    current_user_id,
    action_type_param,
    action_details_param,
    ip_address_param,
    user_agent_param
  )
  RETURNING id INTO log_id;

  RETURN log_id;
END;
$$;

-- Function to assign admin role to a user
CREATE OR REPLACE FUNCTION admin_assign_role(
  user_email_param text,
  role_param text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_user_role text;
  target_user_id uuid;
  target_user_role text;
  result jsonb;
BEGIN
  -- Check if current user is a super admin
  SELECT role INTO current_user_role
  FROM users
  WHERE id = current_user_id;
  
  IF current_user_role != 'admin' THEN
    RETURN jsonb_build_object('error', 'Only super admins can assign admin roles');
  END IF;

  -- Validate role
  IF role_param NOT IN ('admin', 'manager', 'editor') THEN
    RETURN jsonb_build_object('error', 'Invalid role. Must be admin, manager, or editor');
  END IF;

  -- Find the target user by email
  SELECT id, role INTO target_user_id, target_user_role
  FROM users
  WHERE email = user_email_param;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  -- Update user role
  UPDATE users
  SET 
    role = role_param,
    updated_at = now()
  WHERE id = target_user_id;

  -- Log the activity
  PERFORM log_admin_activity(
    'assign_role',
    jsonb_build_object(
      'user_id', target_user_id,
      'user_email', user_email_param,
      'previous_role', target_user_role,
      'new_role', role_param
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', format('User %s role updated to %s', user_email_param, role_param),
    'user_id', target_user_id
  );
END;
$$;

-- Function to revoke admin role from a user
CREATE OR REPLACE FUNCTION admin_revoke_role(
  user_id_param uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_user_role text;
  target_user_email text;
  target_user_role text;
  result jsonb;
BEGIN
  -- Check if current user is a super admin
  SELECT role INTO current_user_role
  FROM users
  WHERE id = current_user_id;
  
  IF current_user_role != 'admin' THEN
    RETURN jsonb_build_object('error', 'Only super admins can revoke admin roles');
  END IF;

  -- Prevent revoking your own admin role
  IF user_id_param = current_user_id THEN
    RETURN jsonb_build_object('error', 'You cannot revoke your own admin role');
  END IF;

  -- Find the target user
  SELECT email, role INTO target_user_email, target_user_role
  FROM users
  WHERE id = user_id_param;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  -- Check if user has an admin role to revoke
  IF target_user_role NOT IN ('admin', 'manager', 'editor') THEN
    RETURN jsonb_build_object('error', 'User does not have an admin role to revoke');
  END IF;

  -- Update user role to listener
  UPDATE users
  SET 
    role = 'listener',
    updated_at = now()
  WHERE id = user_id_param;

  -- Log the activity
  PERFORM log_admin_activity(
    'revoke_role',
    jsonb_build_object(
      'user_id', user_id_param,
      'user_email', target_user_email,
      'previous_role', target_user_role,
      'new_role', 'listener'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Admin role revoked from user %s', target_user_email),
    'user_id', user_id_param
  );
END;
$$;

-- Function to get admin users
CREATE OR REPLACE FUNCTION admin_get_admin_users()
RETURNS TABLE (
  id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role IN ('admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  -- Return admin users
  RETURN QUERY
  SELECT 
    u.id,
    u.email,
    u.display_name,
    u.role,
    u.created_at,
    (
      SELECT MAX(created_at)
      FROM admin_activity_log
      WHERE admin_id = u.id
    ) as last_activity
  FROM users u
  WHERE u.role IN ('admin', 'manager', 'editor')
  ORDER BY 
    CASE u.role
      WHEN 'admin' THEN 1
      WHEN 'manager' THEN 2
      WHEN 'editor' THEN 3
    END,
    u.created_at DESC;
END;
$$;

-- Function to get admin activity logs
CREATE OR REPLACE FUNCTION admin_get_activity_logs(
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
AS $$
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role IN ('admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  -- Return activity logs with optional filters
  RETURN QUERY
  SELECT 
    al.id,
    al.admin_id,
    u.email as admin_email,
    u.display_name as admin_name,
    u.role as admin_role,
    al.action_type,
    al.action_details,
    al.ip_address,
    al.user_agent,
    al.created_at
  FROM admin_activity_log al
  JOIN users u ON al.admin_id = u.id
  WHERE 
    (admin_id_filter IS NULL OR al.admin_id = admin_id_filter)
    AND (action_type_filter IS NULL OR al.action_type = action_type_filter)
    AND al.created_at BETWEEN start_date AND end_date
  ORDER BY al.created_at DESC
  LIMIT limit_param
  OFFSET offset_param;
END;
$$;

-- Function to set system-wide notice
CREATE OR REPLACE FUNCTION admin_set_system_notice(
  title_param text,
  message_param text,
  expires_at_param timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_user_role text;
  notice_id uuid;
  result jsonb;
BEGIN
  -- Check if current user is an admin
  SELECT role INTO current_user_role
  FROM users
  WHERE id = current_user_id;
  
  IF current_user_role NOT IN ('admin', 'manager') THEN
    RETURN jsonb_build_object('error', 'Only admins can set system notices');
  END IF;

  -- Create a system announcement
  INSERT INTO announcements (
    title,
    message,
    target_type,
    status,
    created_by
  ) VALUES (
    title_param,
    message_param,
    'all',
    'sent',
    current_user_id
  )
  RETURNING id INTO notice_id;

  -- Create notifications for all users
  INSERT INTO notifications (
    user_id,
    type,
    message,
    metadata
  )
  SELECT 
    id,
    'system',
    message_param,
    jsonb_build_object(
      'title', title_param,
      'announcement_id', notice_id,
      'expires_at', expires_at_param
    )
  FROM users
  WHERE is_active = true
    AND receive_system_notifications = true;

  -- Log the activity
  PERFORM log_admin_activity(
    'set_system_notice',
    jsonb_build_object(
      'notice_id', notice_id,
      'title', title_param,
      'expires_at', expires_at_param
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'System notice sent successfully',
    'notice_id', notice_id
  );
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION log_admin_activity(text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_assign_role(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_revoke_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_admin_users() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_activity_logs(uuid, text, timestamptz, timestamptz, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_system_notice(text, text, timestamptz) TO authenticated;

-- Fix the admin_get_announcements function to use bigint for target_count
DROP FUNCTION IF EXISTS admin_get_announcements(text, integer, integer);

CREATE OR REPLACE FUNCTION admin_get_announcements(
  status_filter text DEFAULT NULL,
  limit_param integer DEFAULT 100,
  offset_param integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  title text,
  message text,
  link_url text,
  embedded_media_url text,
  target_type text,
  target_country_code text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  status text,
  created_at timestamptz,
  created_by uuid,
  admin_name text,
  target_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role IN ('admin', 'manager', 'editor')
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  -- Return announcements with optional status filter
  RETURN QUERY
  SELECT 
    a.id,
    a.title,
    a.message,
    a.link_url,
    a.embedded_media_url,
    a.target_type,
    a.target_country_code,
    a.scheduled_at,
    a.sent_at,
    a.status,
    a.created_at,
    a.created_by,
    u.display_name as admin_name,
    CASE a.target_type
      WHEN 'all' THEN (SELECT COUNT(*)::bigint FROM users WHERE is_active = true)
      WHEN 'listener' THEN (SELECT COUNT(*)::bigint FROM users WHERE role = 'listener' AND is_active = true)
      WHEN 'creator' THEN (SELECT COUNT(*)::bigint FROM users WHERE role = 'creator' AND is_active = true)
      WHEN 'country' THEN (SELECT COUNT(*)::bigint FROM users WHERE country = a.target_country_code AND is_active = true)
      ELSE 0
    END as target_count
  FROM announcements a
  LEFT JOIN users u ON a.created_by = u.id
  WHERE 
    (status_filter IS NULL OR a.status = status_filter)
  ORDER BY 
    CASE a.status
      WHEN 'draft' THEN 1
      WHEN 'scheduled' THEN 2
      WHEN 'sent' THEN 3
      WHEN 'failed' THEN 4
    END,
    COALESCE(a.scheduled_at, a.created_at) DESC
  LIMIT limit_param
  OFFSET offset_param;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION admin_get_announcements(text, integer, integer) TO authenticated;