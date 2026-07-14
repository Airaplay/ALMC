/*
  # Add Account Admin Role

  1. Changes
    - Add 'account' role to the users table role constraint
    - Update admin_assign_role function to accept 'account' role
    - Update admin_revoke_role function to handle 'account' role
    - Update admin_get_admin_users function to include 'account' role
    - Update all admin privilege checks to include 'account' role where appropriate

  2. Security
    - Account role will have access to financial sections only
    - Account role can view withdrawal requests, payment monitoring, earnings, etc.
    - Account role cannot manage content, users, or other admin functions
    - All changes maintain existing RLS policies
*/

-- Update the role check constraint to include 'account'
DO $$
BEGIN
  ALTER TABLE users 
  DROP CONSTRAINT IF EXISTS users_role_check;
  
  ALTER TABLE users 
  ADD CONSTRAINT users_role_check 
  CHECK (role = ANY (ARRAY['listener'::text, 'creator'::text, 'admin'::text, 'manager'::text, 'editor'::text, 'account'::text]));
END $$;

-- Update admin_assign_role function to accept 'account' role
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
  IF role_param NOT IN ('admin', 'manager', 'editor', 'account') THEN
    RETURN jsonb_build_object('error', 'Invalid role. Must be admin, manager, editor, or account');
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

-- Update admin_revoke_role function to handle 'account' role
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
  IF target_user_role NOT IN ('admin', 'manager', 'editor', 'account') THEN
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

-- Update admin_get_admin_users function to include 'account' role
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
  WHERE u.role IN ('admin', 'manager', 'editor', 'account')
  ORDER BY 
    CASE u.role
      WHEN 'admin' THEN 1
      WHEN 'manager' THEN 2
      WHEN 'editor' THEN 3
      WHEN 'account' THEN 4
    END,
    u.created_at DESC;
END;
$$;

-- Update log_admin_activity function to include 'account' role
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
    AND role IN ('admin', 'manager', 'editor', 'account')
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

-- Grant execute permissions to authenticated users for updated functions
GRANT EXECUTE ON FUNCTION admin_assign_role(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_revoke_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_admin_users() TO authenticated;
GRANT EXECUTE ON FUNCTION log_admin_activity(text, jsonb, text, text) TO authenticated;
