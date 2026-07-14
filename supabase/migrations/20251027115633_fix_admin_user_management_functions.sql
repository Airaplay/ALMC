/*
  # Fix Admin User Management Functions
  
  1. Drop and recreate existing admin functions
    - `admin_update_user_status` - Allows admins to activate/deactivate user accounts
    - `admin_adjust_user_earnings` - Allows admins to adjust user earnings (add/subtract/set)
    - `admin_generate_password_reset` - Allows admins to trigger password reset for users
  
  2. Security
    - All functions require admin role to execute
    - Functions return success/error status
    - Proper error handling and validation
*/

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS admin_update_user_status(uuid, boolean);
DROP FUNCTION IF EXISTS admin_adjust_user_earnings(uuid, numeric, text);
DROP FUNCTION IF EXISTS admin_generate_password_reset(uuid);

-- Function to update user status (activate/deactivate)
CREATE OR REPLACE FUNCTION admin_update_user_status(
  target_user_id uuid,
  new_status boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_role text;
BEGIN
  -- Get the current user's role
  SELECT role INTO current_user_role
  FROM users
  WHERE id = auth.uid();
  
  -- Check if current user is an admin
  IF current_user_role != 'admin' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Only admins can update user status'
    );
  END IF;
  
  -- Update the user's active status
  UPDATE users
  SET is_active = new_status,
      updated_at = now()
  WHERE id = target_user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'User status updated successfully'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Function to adjust user earnings
CREATE OR REPLACE FUNCTION admin_adjust_user_earnings(
  target_user_id uuid,
  adjustment_amount numeric,
  operation_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_role text;
  current_earnings numeric;
  new_earnings numeric;
BEGIN
  -- Get the current user's role
  SELECT role INTO current_user_role
  FROM users
  WHERE id = auth.uid();
  
  -- Check if current user is an admin
  IF current_user_role != 'admin' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Only admins can adjust user earnings'
    );
  END IF;
  
  -- Validate adjustment amount
  IF adjustment_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Adjustment amount must be greater than 0'
    );
  END IF;
  
  -- Get current earnings
  SELECT COALESCE(total_earnings, 0) INTO current_earnings
  FROM users
  WHERE id = target_user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;
  
  -- Calculate new earnings based on operation type
  CASE operation_type
    WHEN 'add' THEN
      new_earnings := current_earnings + adjustment_amount;
    WHEN 'subtract' THEN
      new_earnings := GREATEST(0, current_earnings - adjustment_amount);
    WHEN 'set' THEN
      new_earnings := adjustment_amount;
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Invalid operation type. Use: add, subtract, or set'
      );
  END CASE;
  
  -- Update user earnings
  UPDATE users
  SET total_earnings = new_earnings,
      updated_at = now()
  WHERE id = target_user_id;
  
  -- Insert transaction record for audit trail
  INSERT INTO transactions (user_id, type, amount, description)
  VALUES (
    target_user_id,
    'admin_adjustment',
    adjustment_amount,
    format('Admin %s: %s by $%s', operation_type, 
      CASE 
        WHEN operation_type = 'add' THEN 'Added'
        WHEN operation_type = 'subtract' THEN 'Subtracted'
        WHEN operation_type = 'set' THEN 'Set to'
      END,
      adjustment_amount
    )
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Earnings adjusted successfully',
    'old_earnings', current_earnings,
    'new_earnings', new_earnings
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Function to generate password reset
CREATE OR REPLACE FUNCTION admin_generate_password_reset(
  target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_role text;
  user_email text;
BEGIN
  -- Get the current user's role
  SELECT role INTO current_user_role
  FROM users
  WHERE id = auth.uid();
  
  -- Check if current user is an admin
  IF current_user_role != 'admin' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: Only admins can generate password resets'
    );
  END IF;
  
  -- Get user's email
  SELECT email INTO user_email
  FROM users
  WHERE id = target_user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;
  
  -- Note: Actual password reset email is sent through Supabase Auth
  -- This function validates permissions and returns success
  -- The frontend should handle the actual email sending via Supabase Auth API
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Password reset initiated',
    'email', user_email
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;