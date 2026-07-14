/*
  # Admin Treat Users Management Functions

  1. Functions
    - `admin_get_treat_users` - Get paginated list of users with treat wallet data
    - `admin_count_treat_users` - Count users for pagination
    - `admin_add_treats_to_user` - Add treats to a user's wallet
    - `admin_remove_treats_from_user` - Remove treats from a user's wallet
    - `admin_disable_user_treat_wallet` - Disable a user's treat wallet
    - `admin_enable_user_treat_wallet` - Enable/create a user's treat wallet

  2. Security
    - All functions require admin role
    - Proper logging of admin actions
    - Transaction safety for wallet operations
*/

-- Function to get paginated list of users with treat wallet data
CREATE OR REPLACE FUNCTION admin_get_treat_users(
  search_query TEXT DEFAULT NULL,
  role_filter TEXT DEFAULT NULL,
  status_filter BOOLEAN DEFAULT NULL,
  sort_by TEXT DEFAULT 'balance_high',
  limit_param INTEGER DEFAULT 20,
  offset_param INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  role TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  avatar_url TEXT,
  treat_wallet JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_role TEXT;
BEGIN
  -- Check if current user is admin
  SELECT users.role INTO current_user_role
  FROM users 
  WHERE users.id = auth.uid();
  
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Build and execute query with filters and sorting
  RETURN QUERY
  SELECT 
    u.id,
    u.email,
    u.display_name,
    u.role,
    u.is_active,
    u.created_at,
    u.avatar_url,
    CASE 
      WHEN tw.id IS NOT NULL THEN
        jsonb_build_object(
          'balance', tw.balance,
          'total_purchased', tw.total_purchased,
          'total_spent', tw.total_spent,
          'total_earned', tw.total_earned,
          'total_withdrawn', tw.total_withdrawn,
          'created_at', tw.created_at,
          'updated_at', tw.updated_at
        )
      ELSE NULL
    END as treat_wallet
  FROM users u
  LEFT JOIN treat_wallets tw ON u.id = tw.user_id
  WHERE 
    (search_query IS NULL OR 
     u.email ILIKE '%' || search_query || '%' OR 
     u.display_name ILIKE '%' || search_query || '%')
    AND (role_filter IS NULL OR u.role = role_filter)
    AND (status_filter IS NULL OR u.is_active = status_filter)
  ORDER BY 
    CASE 
      WHEN sort_by = 'balance_high' THEN COALESCE(tw.balance, 0)
      WHEN sort_by = 'balance_low' THEN -COALESCE(tw.balance, 0)
      ELSE 0
    END DESC,
    CASE 
      WHEN sort_by = 'name' THEN COALESCE(u.display_name, u.email)
      ELSE ''
    END ASC,
    CASE 
      WHEN sort_by = 'recent' THEN u.created_at
      ELSE u.created_at
    END DESC
  LIMIT limit_param
  OFFSET offset_param;
END;
$$;

-- Function to count users for pagination
CREATE OR REPLACE FUNCTION admin_count_treat_users(
  search_query TEXT DEFAULT NULL,
  role_filter TEXT DEFAULT NULL,
  status_filter BOOLEAN DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_role TEXT;
  user_count INTEGER;
BEGIN
  -- Check if current user is admin
  SELECT users.role INTO current_user_role
  FROM users 
  WHERE users.id = auth.uid();
  
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Count users with filters
  SELECT COUNT(*)::INTEGER INTO user_count
  FROM users u
  WHERE 
    (search_query IS NULL OR 
     u.email ILIKE '%' || search_query || '%' OR 
     u.display_name ILIKE '%' || search_query || '%')
    AND (role_filter IS NULL OR u.role = role_filter)
    AND (status_filter IS NULL OR u.is_active = status_filter);

  RETURN user_count;
END;
$$;

-- Function to add treats to a user's wallet
CREATE OR REPLACE FUNCTION admin_add_treats_to_user(
  target_user_id UUID,
  treat_amount NUMERIC,
  admin_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_role TEXT;
  current_admin_id UUID;
  target_user_exists BOOLEAN;
  current_balance NUMERIC;
  new_balance NUMERIC;
BEGIN
  -- Check if current user is admin
  SELECT users.role, users.id INTO current_user_role, current_admin_id
  FROM users 
  WHERE users.id = auth.uid();
  
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Validate inputs
  IF treat_amount <= 0 THEN
    RAISE EXCEPTION 'Treat amount must be greater than 0';
  END IF;

  IF admin_reason IS NULL OR trim(admin_reason) = '' THEN
    RAISE EXCEPTION 'Reason is required for this action';
  END IF;

  -- Check if target user exists
  SELECT EXISTS(SELECT 1 FROM users WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  -- Get or create treat wallet
  INSERT INTO treat_wallets (user_id, balance, total_purchased, total_spent, total_earned, total_withdrawn)
  VALUES (target_user_id, 0, 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Get current balance
  SELECT balance INTO current_balance
  FROM treat_wallets
  WHERE user_id = target_user_id;

  -- Calculate new balance
  new_balance := current_balance + treat_amount;

  -- Update wallet balance and total_earned
  UPDATE treat_wallets
  SET 
    balance = new_balance,
    total_earned = total_earned + treat_amount,
    updated_at = NOW()
  WHERE user_id = target_user_id;

  -- Record transaction
  INSERT INTO treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    metadata
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
    )
  );

  -- Log admin activity
  INSERT INTO admin_activity_log (
    admin_id,
    action_type,
    action_details
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

-- Function to remove treats from a user's wallet
CREATE OR REPLACE FUNCTION admin_remove_treats_from_user(
  target_user_id UUID,
  treat_amount NUMERIC,
  admin_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_role TEXT;
  current_admin_id UUID;
  target_user_exists BOOLEAN;
  current_balance NUMERIC;
  new_balance NUMERIC;
BEGIN
  -- Check if current user is admin
  SELECT users.role, users.id INTO current_user_role, current_admin_id
  FROM users 
  WHERE users.id = auth.uid();
  
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Validate inputs
  IF treat_amount <= 0 THEN
    RAISE EXCEPTION 'Treat amount must be greater than 0';
  END IF;

  IF admin_reason IS NULL OR trim(admin_reason) = '' THEN
    RAISE EXCEPTION 'Reason is required for this action';
  END IF;

  -- Check if target user exists
  SELECT EXISTS(SELECT 1 FROM users WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  -- Get current balance
  SELECT COALESCE(balance, 0) INTO current_balance
  FROM treat_wallets
  WHERE user_id = target_user_id;

  -- Check if user has enough balance
  IF current_balance < treat_amount THEN
    RAISE EXCEPTION 'User does not have enough treats. Current balance: %', current_balance;
  END IF;

  -- Calculate new balance
  new_balance := current_balance - treat_amount;

  -- Update wallet balance and total_spent
  UPDATE treat_wallets
  SET 
    balance = new_balance,
    total_spent = total_spent + treat_amount,
    updated_at = NOW()
  WHERE user_id = target_user_id;

  -- Record transaction
  INSERT INTO treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    metadata
  ) VALUES (
    target_user_id,
    'spend',
    treat_amount,
    current_balance,
    new_balance,
    'Admin removed treats: ' || admin_reason,
    jsonb_build_object(
      'admin_action', true,
      'admin_id', current_admin_id,
      'reason', admin_reason
    )
  );

  -- Log admin activity
  INSERT INTO admin_activity_log (
    admin_id,
    action_type,
    action_details
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

-- Function to disable a user's treat wallet
CREATE OR REPLACE FUNCTION admin_disable_user_treat_wallet(
  target_user_id UUID,
  admin_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_role TEXT;
  current_admin_id UUID;
  target_user_exists BOOLEAN;
  wallet_exists BOOLEAN;
BEGIN
  -- Check if current user is admin
  SELECT users.role, users.id INTO current_user_role, current_admin_id
  FROM users 
  WHERE users.id = auth.uid();
  
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Validate inputs
  IF admin_reason IS NULL OR trim(admin_reason) = '' THEN
    RAISE EXCEPTION 'Reason is required for this action';
  END IF;

  -- Check if target user exists
  SELECT EXISTS(SELECT 1 FROM users WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  -- Check if wallet exists
  SELECT EXISTS(SELECT 1 FROM treat_wallets WHERE user_id = target_user_id) INTO wallet_exists;
  IF NOT wallet_exists THEN
    RAISE EXCEPTION 'User does not have a treat wallet';
  END IF;

  -- Delete the treat wallet (this will cascade and remove related data)
  DELETE FROM treat_wallets WHERE user_id = target_user_id;

  -- Log admin activity
  INSERT INTO admin_activity_log (
    admin_id,
    action_type,
    action_details
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

-- Function to enable/create a user's treat wallet
CREATE OR REPLACE FUNCTION admin_enable_user_treat_wallet(
  target_user_id UUID,
  admin_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_role TEXT;
  current_admin_id UUID;
  target_user_exists BOOLEAN;
  wallet_exists BOOLEAN;
BEGIN
  -- Check if current user is admin
  SELECT users.role, users.id INTO current_user_role, current_admin_id
  FROM users 
  WHERE users.id = auth.uid();
  
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  -- Validate inputs
  IF admin_reason IS NULL OR trim(admin_reason) = '' THEN
    RAISE EXCEPTION 'Reason is required for this action';
  END IF;

  -- Check if target user exists
  SELECT EXISTS(SELECT 1 FROM users WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  -- Check if wallet already exists
  SELECT EXISTS(SELECT 1 FROM treat_wallets WHERE user_id = target_user_id) INTO wallet_exists;
  IF wallet_exists THEN
    RAISE EXCEPTION 'User already has an active treat wallet';
  END IF;

  -- Create new treat wallet
  INSERT INTO treat_wallets (
    user_id,
    balance,
    total_purchased,
    total_spent,
    total_earned,
    total_withdrawn
  ) VALUES (
    target_user_id,
    0,
    0,
    0,
    0,
    0
  );

  -- Log admin activity
  INSERT INTO admin_activity_log (
    admin_id,
    action_type,
    action_details
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

-- Grant execute permissions to authenticated users (RLS will handle admin check)
GRANT EXECUTE ON FUNCTION admin_get_treat_users TO authenticated;
GRANT EXECUTE ON FUNCTION admin_count_treat_users TO authenticated;
GRANT EXECUTE ON FUNCTION admin_add_treats_to_user TO authenticated;
GRANT EXECUTE ON FUNCTION admin_remove_treats_from_user TO authenticated;
GRANT EXECUTE ON FUNCTION admin_disable_user_treat_wallet TO authenticated;
GRANT EXECUTE ON FUNCTION admin_enable_user_treat_wallet TO authenticated;