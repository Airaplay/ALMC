/*
  # Fix Google Play purchase total_purchased double count

  Google Play purchases are finalized by finalize_google_play_treat_purchase().
  That RPC inserts a completed `purchase` transaction, which already fires
  trigger_update_treat_wallet() and increments balance, purchased_balance, and
  total_purchased.

  The RPC then updated treat_wallets again with:
    total_purchased = total_purchased + v_total

  Because that expression ran after the trigger, only total_purchased was
  doubled. Balance and purchased_balance were overwritten with the intended
  absolute values, so the user-facing bug appeared specifically in the
  "Purchased" lifetime stat.
*/

CREATE OR REPLACE FUNCTION public.finalize_google_play_treat_purchase(
  p_user_id uuid,
  p_package_id uuid,
  p_order_id text,
  p_purchase_token text,
  p_product_id text,
  p_payment_channel_id uuid,
  p_amount_usd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text := coalesce((auth.jwt() ->> 'role'), '');
  v_existing uuid;
  v_pkg record;
  v_total numeric;
  v_payment_id uuid;
  v_balance_before numeric;
  v_balance_after numeric;
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF p_order_id IS NULL OR length(trim(p_order_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_order_id');
  END IF;

  SELECT id INTO v_existing
  FROM public.treat_payments
  WHERE external_reference = p_order_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'payment_id', v_existing, 'duplicate', true);
  END IF;

  SELECT treats, bonus, price
  INTO v_pkg
  FROM public.treat_packages
  WHERE id = p_package_id
    AND coalesce(is_active, true) = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_package');
  END IF;

  v_total := coalesce(v_pkg.treats, 0) + coalesce(v_pkg.bonus, 0);

  IF v_total <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_package_amount');
  END IF;

  SELECT balance
  INTO v_balance_before
  FROM public.treat_wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.treat_wallets (
      user_id, balance, purchased_balance, earned_balance,
      total_purchased, total_spent, total_earned, total_withdrawn
    )
    VALUES (p_user_id, 0, 0, 0, 0, 0, 0, 0);

    v_balance_before := 0;
  END IF;

  v_balance_after := coalesce(v_balance_before, 0) + v_total;

  INSERT INTO public.treat_payments (
    user_id,
    package_id,
    status,
    amount,
    amount_usd,
    currency,
    payment_method,
    external_reference,
    completed_at,
    created_at
  )
  VALUES (
    p_user_id,
    p_package_id,
    'completed',
    coalesce(p_amount_usd, v_pkg.price),
    coalesce(p_amount_usd, v_pkg.price),
    'USD',
    'google_play',
    p_order_id,
    now(),
    now()
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.treat_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    status,
    payment_method,
    payment_reference,
    metadata,
    created_at
  )
  VALUES (
    p_user_id,
    'purchase',
    v_total,
    v_balance_before,
    v_balance_after,
    'Treat purchase (Google Play)',
    'completed',
    'google_play',
    v_payment_id::text,
    jsonb_build_object(
      'google_play', true,
      'product_id', p_product_id,
      'purchase_token', p_purchase_token,
      'payment_channel_id', p_payment_channel_id
    ),
    now()
  );

  -- Wallet aggregates are updated by trigger_update_treat_wallet().
  -- Do not update treat_wallets here, or total_purchased is counted twice.

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'treats_credited', v_total
  );
END;
$function$;
