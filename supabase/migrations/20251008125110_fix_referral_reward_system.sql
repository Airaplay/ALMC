/*
  # Fix Referral Reward System

  1. Updates
    - Update `add_treat_balance` function to support transaction logging
    - Update `process_referral_reward` to properly credit Treats and log transactions
    - Ensure total_earned is updated when referral rewards are given
    
  2. Changes
    - Add transaction type and description parameters to add_treat_balance
    - Log all referral rewards in treat_transactions table
    - Update total_earned field in treat_wallets
    
  3. Security
    - Maintains SECURITY DEFINER for safe execution
    - Proper transaction handling to ensure data consistency
*/

-- Update add_treat_balance function to support transaction logging
CREATE OR REPLACE FUNCTION add_treat_balance(
  p_user_id uuid,
  p_amount integer,
  p_transaction_type text DEFAULT 'bonus',
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert or update wallet balance
  INSERT INTO treat_wallets (user_id, balance, total_purchased, total_spent, total_earned, total_withdrawn)
  VALUES (p_user_id, p_amount, 0, 0, p_amount, 0)
  ON CONFLICT (user_id)
  DO UPDATE SET
    balance = treat_wallets.balance + p_amount,
    total_earned = treat_wallets.total_earned + p_amount,
    updated_at = now();
    
  -- Log the transaction
  INSERT INTO treat_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    status
  ) VALUES (
    p_user_id,
    p_amount,
    p_transaction_type,
    COALESCE(p_description, 'Treat balance added'),
    'completed'
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION add_treat_balance(uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION add_treat_balance(uuid, integer, text, text) TO service_role;

-- Update process_referral_reward to properly credit Treats
CREATE OR REPLACE FUNCTION process_referral_reward(p_referred_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referral_record RECORD;
  v_settings RECORD;
  v_activity_count integer;
  v_limit_check jsonb;
BEGIN
  -- Get the referral record
  SELECT * INTO v_referral_record
  FROM public.referrals
  WHERE referred_id = p_referred_id
  AND status IN ('pending', 'active')
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Get referral settings
  SELECT * INTO v_settings
  FROM public.referral_settings
  ORDER BY created_at DESC
  LIMIT 1;

  -- Check if referral program is enabled
  IF NOT FOUND OR NOT v_settings.enabled OR NOT v_settings.program_active THEN
    RETURN;
  END IF;

  -- Check activity threshold (using listening_history as activity metric)
  SELECT COUNT(*) INTO v_activity_count
  FROM public.listening_history
  WHERE user_id = p_referred_id;

  -- Update is_active status in referrals table
  IF v_activity_count >= v_settings.min_activity_threshold THEN
    UPDATE public.referrals
    SET is_active = true, last_activity = now()
    WHERE id = v_referral_record.id;
  END IF;

  -- If user is active and not yet rewarded
  IF v_activity_count >= v_settings.min_activity_threshold AND v_referral_record.status != 'rewarded' THEN
    -- Check if referrer can still receive rewards (within limits)
    SELECT public.check_referral_limit(v_referral_record.referrer_id) INTO v_limit_check;
    
    -- Check if can refer
    IF (v_limit_check->>'can_refer')::boolean = true THEN
      -- Update referral status to rewarded
      UPDATE public.referrals
      SET 
        status = 'rewarded',
        reward_amount = v_settings.reward_per_referral,
        rewarded_at = now(),
        is_active = true,
        last_activity = now()
      WHERE id = v_referral_record.id;

      -- Add treats to referrer's wallet with proper transaction logging
      PERFORM public.add_treat_balance(
        v_referral_record.referrer_id,
        v_settings.reward_per_referral,
        'referral_bonus',
        format('Referral reward - User became active (ID: %s)', p_referred_id)
      );
    ELSE
      -- User reached limit, mark referral but don't reward
      UPDATE public.referrals
      SET 
        status = 'active',
        is_active = true,
        last_activity = now()
      WHERE id = v_referral_record.id;
    END IF;
  ELSIF v_activity_count > 0 AND v_referral_record.status = 'pending' THEN
    -- Mark as active but not yet at threshold
    UPDATE public.referrals
    SET 
      status = 'active',
      is_active = true,
      last_activity = now()
    WHERE id = v_referral_record.id;
  END IF;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION process_referral_reward(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION process_referral_reward(uuid) TO service_role;