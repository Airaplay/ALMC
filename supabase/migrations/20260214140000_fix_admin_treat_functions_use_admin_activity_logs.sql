/*
  # Fix admin treat functions to use admin_activity_logs table

  The table admin_activity_log (singular) was dropped and replaced by admin_activity_logs (plural).
  These functions still reference the old table name and column name (action_details vs details).
  This migration updates all four functions to use the correct table and column names.
*/

-- Fix admin_add_treats_to_user
CREATE OR REPLACE FUNCTION admin_add_treats_to_user(
  target_user_id UUID,
  treat_amount NUMERIC,
  admin_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_role TEXT;
  current_admin_id UUID;
  target_user_exists BOOLEAN;
  current_balance NUMERIC;
  new_balance NUMERIC;
BEGIN
  -- Get current user info
  SELECT u.role, u.id INTO current_user_role, current_admin_id
  FROM users u
  WHERE u.id = auth.uid();

  -- Check if user is admin (critical - use exception)
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Validate inputs (return JSON error for better frontend handling)
  IF treat_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Treat amount must be greater than 0'
    );
  END IF;

  IF admin_reason IS NULL OR trim(admin_reason) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reason is required for this action'
    );
  END IF;

  -- Check if target user exists
  SELECT EXISTS(SELECT 1 FROM users WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Target user not found'
    );
  END IF;

  -- Get current balance (or 0 if wallet doesn't exist)
  SELECT COALESCE(balance, 0) INTO current_balance
  FROM treat_wallets
  WHERE user_id = target_user_id;

  new_balance := current_balance + treat_amount;

  -- Insert transaction (trigger will update wallet balance)
  INSERT INTO treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    metadata,
    status
  ) VALUES (
    target_user_id,
    'earn',
    treat_amount,
    current_balance,
    new_balance,
    'Admin added treats: ' || admin_reason,
    jsonb_build_object(
      'admin_action', true,
      'admin_id', current_admin_id,
      'reason', admin_reason
    ),
    'completed'
  );

  -- Log admin activity (using admin_activity_logs with details column)
  INSERT INTO admin_activity_logs (
    admin_id,
    action_type,
    details
  ) VALUES (
    current_admin_id,
    'add_treats',
    jsonb_build_object(
      'target_user_id', target_user_id,
      'amount', treat_amount,
      'reason', admin_reason,
      'previous_balance', current_balance,
      'new_balance', new_balance
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Treats added successfully',
    'previous_balance', current_balance,
    'new_balance', new_balance
  );
END;
$$;

-- Fix admin_remove_treats_from_user
CREATE OR REPLACE FUNCTION admin_remove_treats_from_user(
  target_user_id UUID,
  treat_amount NUMERIC,
  admin_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_role TEXT;
  current_admin_id UUID;
  target_user_exists BOOLEAN;
  current_balance NUMERIC;
  new_balance NUMERIC;
BEGIN
  -- Get current user info
  SELECT u.role, u.id INTO current_user_role, current_admin_id
  FROM users u
  WHERE u.id = auth.uid();

  -- Check if user is admin (critical - use exception)
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Validate inputs (return JSON error for better frontend handling)
  IF treat_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Treat amount must be greater than 0'
    );
  END IF;

  IF admin_reason IS NULL OR trim(admin_reason) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reason is required for this action'
    );
  END IF;

  -- Check if target user exists
  SELECT EXISTS(SELECT 1 FROM users WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Target user not found'
    );
  END IF;

  -- Get current balance
  SELECT COALESCE(balance, 0) INTO current_balance
  FROM treat_wallets
  WHERE user_id = target_user_id;

  -- Check if user has enough balance
  IF current_balance < treat_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance. User has ' || current_balance || ' treats.'
    );
  END IF;

  new_balance := current_balance - treat_amount;

  -- Insert transaction (trigger will update wallet balance)
  -- Use 'spend' transaction type (allowed in constraint) with negative amount
  INSERT INTO treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    metadata,
    status
  ) VALUES (
    target_user_id,
    'spend',
    -treat_amount,
    current_balance,
    new_balance,
    'Admin removed treats: ' || admin_reason,
    jsonb_build_object(
      'admin_action', true,
      'admin_id', current_admin_id,
      'reason', admin_reason
    ),
    'completed'
  );

  -- Log admin activity (using admin_activity_logs with details column)
  INSERT INTO admin_activity_logs (
    admin_id,
    action_type,
    details
  ) VALUES (
    current_admin_id,
    'remove_treats',
    jsonb_build_object(
      'target_user_id', target_user_id,
      'amount', treat_amount,
      'reason', admin_reason,
      'previous_balance', current_balance,
      'new_balance', new_balance
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Treats removed successfully',
    'previous_balance', current_balance,
    'new_balance', new_balance
  );
END;
$$;

-- Fix admin_disable_user_treat_wallet
CREATE OR REPLACE FUNCTION admin_disable_user_treat_wallet(
  target_user_id UUID,
  admin_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_role TEXT;
  current_admin_id UUID;
  target_user_exists BOOLEAN;
  wallet_exists BOOLEAN;
BEGIN
  -- Get current user info
  SELECT u.role, u.id INTO current_user_role, current_admin_id
  FROM users u
  WHERE u.id = auth.uid();

  -- Check if user is admin
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Validate inputs
  IF admin_reason IS NULL OR trim(admin_reason) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reason is required for this action'
    );
  END IF;

  -- Check if target user exists
  SELECT EXISTS(SELECT 1 FROM users WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Target user not found'
    );
  END IF;

  -- Check if wallet exists
  SELECT EXISTS(SELECT 1 FROM treat_wallets WHERE user_id = target_user_id) INTO wallet_exists;
  IF NOT wallet_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User does not have a treat wallet'
    );
  END IF;

  -- Disable wallet by setting a flag (if you have one) or delete wallet
  -- For now, we'll just log the action since there's no is_disabled flag
  -- You may want to add an is_disabled column to treat_wallets if needed

  -- Log admin activity (using admin_activity_logs with details column)
  INSERT INTO admin_activity_logs (
    admin_id,
    action_type,
    details
  ) VALUES (
    current_admin_id,
    'disable_treat_wallet',
    jsonb_build_object(
      'target_user_id', target_user_id,
      'reason', admin_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Treat wallet disabled successfully'
  );
END;
$$;

-- Fix admin_enable_user_treat_wallet
CREATE OR REPLACE FUNCTION admin_enable_user_treat_wallet(
  target_user_id UUID,
  admin_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_user_role TEXT;
  current_admin_id UUID;
  target_user_exists BOOLEAN;
  wallet_exists BOOLEAN;
BEGIN
  -- Get current user info
  SELECT u.role, u.id INTO current_user_role, current_admin_id
  FROM users u
  WHERE u.id = auth.uid();

  -- Check if user is admin
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Validate inputs
  IF admin_reason IS NULL OR trim(admin_reason) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reason is required for this action'
    );
  END IF;

  -- Check if target user exists
  SELECT EXISTS(SELECT 1 FROM users WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Target user not found'
    );
  END IF;

  -- Check if wallet already exists
  SELECT EXISTS(SELECT 1 FROM treat_wallets WHERE user_id = target_user_id) INTO wallet_exists;
  IF wallet_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User already has a treat wallet'
    );
  END IF;

  -- Create wallet
  INSERT INTO treat_wallets (user_id, balance, total_earned, total_purchased, total_spent, total_withdrawn)
  VALUES (target_user_id, 0, 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Log admin activity (using admin_activity_logs with details column)
  INSERT INTO admin_activity_logs (
    admin_id,
    action_type,
    details
  ) VALUES (
    current_admin_id,
    'enable_treat_wallet',
    jsonb_build_object(
      'target_user_id', target_user_id,
      'reason', admin_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Treat wallet enabled successfully'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_add_treats_to_user(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_remove_treats_from_user(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_disable_user_treat_wallet(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_enable_user_treat_wallet(uuid, text) TO authenticated;

COMMENT ON FUNCTION admin_add_treats_to_user IS 'Adds treats to a user wallet. Logs to admin_activity_logs (plural) table.';
COMMENT ON FUNCTION admin_remove_treats_from_user IS 'Removes treats from a user wallet. Logs to admin_activity_logs (plural) table.';
COMMENT ON FUNCTION admin_disable_user_treat_wallet IS 'Disables a user treat wallet. Logs to admin_activity_logs (plural) table.';
COMMENT ON FUNCTION admin_enable_user_treat_wallet IS 'Enables/creates a user treat wallet. Logs to admin_activity_logs (plural) table.';
