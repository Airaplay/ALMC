/*
  # Fix add_treat_balance() function definition

  Prior migration `20251008125110_fix_referral_reward_system.sql` contains a syntax error:
  an extra ':' after the parameter list in CREATE FUNCTION.

  This migration safely (re)creates the function with the intended signature and behavior.
*/

CREATE OR REPLACE FUNCTION public.add_treat_balance(
  p_user_id uuid,
  p_amount integer,
  p_transaction_type text DEFAULT 'bonus',
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.treat_wallets (
    user_id,
    balance,
    total_purchased,
    total_spent,
    total_earned,
    total_withdrawn
  )
  VALUES (p_user_id, p_amount, 0, 0, p_amount, 0)
  ON CONFLICT (user_id)
  DO UPDATE SET
    balance = public.treat_wallets.balance + p_amount,
    total_earned = public.treat_wallets.total_earned + p_amount,
    updated_at = now();

  INSERT INTO public.treat_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    status
  )
  VALUES (
    p_user_id,
    p_amount,
    p_transaction_type,
    COALESCE(p_description, 'Treat balance added'),
    'completed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_treat_balance(uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_treat_balance(uuid, integer, text, text) TO service_role;

