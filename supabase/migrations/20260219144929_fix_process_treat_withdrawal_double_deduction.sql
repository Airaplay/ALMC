/*
  # Fix process_treat_withdrawal double deduction

  The function was manually updating treat_wallets AND inserting into treat_transactions,
  which triggered trigger_update_treat_wallet to deduct a second time.

  Fix: Remove the manual UPDATE treat_wallets from the function body.
  The trigger handles the wallet update atomically on transaction INSERT.

  The trigger expects a NEGATIVE amount for 'withdrawal' type (uses ABS()).
  So we pass a negative amount in the transaction insert to match trigger expectations.
*/

CREATE OR REPLACE FUNCTION public.process_treat_withdrawal(p_user_id uuid, p_treats_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet_record RECORD;
  v_settings RECORD;
  v_user_record RECORD;
  v_current_balance numeric;
  v_current_earned numeric;
  v_usd_gross_amount numeric;
  v_fee_amount numeric;
  v_net_amount numeric;
  v_new_balance numeric;
  v_new_earned numeric;
  v_fee_percentage numeric;
  v_fee_fixed numeric;
BEGIN
  IF p_treats_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal amount must be greater than 0');
  END IF;

  SELECT treat_to_usd_rate, withdrawal_fee_percentage, withdrawal_fee_fixed, is_withdrawal_enabled, minimum_withdrawal_amount
  INTO v_settings FROM treat_withdrawal_settings LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal settings not configured. Please contact administrator.');
  END IF;

  IF NOT v_settings.is_withdrawal_enabled THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawals are currently disabled by administrator');
  END IF;

  v_usd_gross_amount := p_treats_amount * v_settings.treat_to_usd_rate;

  IF p_treats_amount < v_settings.minimum_withdrawal_amount THEN
    RETURN jsonb_build_object('success', false, 'error', format('Minimum withdrawal is %s treats (approximately $%s USD)', v_settings.minimum_withdrawal_amount, ROUND(v_settings.minimum_withdrawal_amount * v_settings.treat_to_usd_rate, 2)));
  END IF;

  SELECT balance, total_earned, total_purchased, total_spent, total_withdrawn, earned_balance
  INTO v_wallet_record FROM treat_wallets WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  v_current_balance := v_wallet_record.balance;
  v_current_earned := v_wallet_record.earned_balance;

  IF v_current_earned < p_treats_amount THEN
    RETURN jsonb_build_object('success', false, 'error', format('Insufficient earned balance. You have %s earned treats available but tried to withdraw %s', v_current_earned, p_treats_amount));
  END IF;

  IF v_current_balance < p_treats_amount THEN
    RETURN jsonb_build_object('success', false, 'error', format('Insufficient balance. Current balance: %s treats', v_current_balance));
  END IF;

  v_fee_percentage := COALESCE(v_settings.withdrawal_fee_percentage, 0);
  v_fee_fixed := COALESCE(v_settings.withdrawal_fee_fixed, 0);
  v_fee_amount := (v_usd_gross_amount * v_fee_percentage / 100) + v_fee_fixed;
  v_net_amount := GREATEST(v_usd_gross_amount - v_fee_amount, 0);

  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal amount too small after fees. Please withdraw a larger amount.');
  END IF;

  v_new_balance := v_current_balance - p_treats_amount;
  v_new_earned := v_current_earned - p_treats_amount;

  IF v_new_balance < 0 OR v_new_earned < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Balance calculation error. Please contact support.');
  END IF;

  SELECT total_earnings INTO v_user_record FROM users WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Update live earnings balance
  UPDATE users
  SET total_earnings = COALESCE(total_earnings, 0) + v_net_amount, updated_at = now()
  WHERE id = p_user_id;

  -- Insert transaction with NEGATIVE amount so the trigger (which uses ABS()) deducts correctly.
  -- The trigger handles the treat_wallets update atomically — no manual wallet update here.
  INSERT INTO treat_transactions (
    user_id, transaction_type, amount, balance_before, balance_after,
    description, status, metadata
  )
  VALUES (
    p_user_id,
    'withdrawal',
    -p_treats_amount,
    v_current_balance,
    v_new_balance,
    format('Withdrew %s treats to Live Balance ($%s USD)', p_treats_amount, ROUND(v_net_amount, 2)),
    'completed',
    jsonb_build_object(
      'treats_amount', p_treats_amount,
      'usd_gross', ROUND(v_usd_gross_amount, 2),
      'fee_percentage', v_fee_percentage,
      'fee_fixed', v_fee_fixed,
      'fee_amount', ROUND(v_fee_amount, 2),
      'net_amount', ROUND(v_net_amount, 2),
      'treat_to_usd_rate', v_settings.treat_to_usd_rate,
      'withdrawn_from_earned', true,
      'live_balance_before', COALESCE(v_user_record.total_earnings, 0),
      'live_balance_after', COALESCE(v_user_record.total_earnings, 0) + v_net_amount,
      'added_to_live_balance', true
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'treats_withdrawn', p_treats_amount,
    'usd_gross', ROUND(v_usd_gross_amount, 2),
    'fee_percentage', v_fee_percentage,
    'fee_fixed', v_fee_fixed,
    'fee_amount', ROUND(v_fee_amount, 2),
    'net_amount', ROUND(v_net_amount, 2),
    'treat_to_usd_rate', v_settings.treat_to_usd_rate,
    'new_balance', v_new_balance,
    'new_earned_balance', v_new_earned,
    'live_balance_before', COALESCE(v_user_record.total_earnings, 0),
    'live_balance_after', COALESCE(v_user_record.total_earnings, 0) + v_net_amount,
    'message', format('Successfully withdrawn %s treats ($%s USD added to Live Balance)', p_treats_amount, ROUND(v_net_amount, 2))
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', format('Withdrawal failed: %s', SQLERRM));
END;
$function$;
