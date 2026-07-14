/*
  # Fix approved_withdrawal email amount mapping

  Problem:
  - Approved withdrawal email used NEW.amount directly.
  - In current schema, the user-facing payout amount is typically in `amount_local`
    (with currency_code/symbol), while NEW.amount may represent a different base unit.

  Fix:
  - Build `amount` from:
      amount_local (preferred) -> amount_usd -> amount
  - Keep `currency` from currency_code/currency.
  - Keep template-compatible variables unchanged.
*/

CREATE OR REPLACE FUNCTION public.trigger_send_withdrawal_approval_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_email text;
  v_user_name text;
  v_currency text;
  v_payment_method text;
  v_account_details text;
  v_amount_local numeric;
  v_amount_usd numeric;
  v_amount numeric;
BEGIN
  -- Only send email when status changes to approved
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status <> 'approved') THEN
    SELECT email, COALESCE(display_name, email)
    INTO v_user_email, v_user_name
    FROM public.users
    WHERE id = NEW.user_id;

    v_currency := COALESCE(
      to_jsonb(NEW)->>'currency_code',
      to_jsonb(NEW)->>'currency',
      'USD'
    );
    v_payment_method := COALESCE(
      to_jsonb(NEW)->>'payment_method',
      to_jsonb(NEW)->>'method_type',
      'bank transfer'
    );
    v_account_details := COALESCE(
      to_jsonb(NEW)->>'account_holder_name',
      'Your registered account'
    );

    -- Schema-safe numeric extraction.
    v_amount_local := NULLIF(to_jsonb(NEW)->>'amount_local', '')::numeric;
    v_amount_usd := NULLIF(to_jsonb(NEW)->>'amount_usd', '')::numeric;
    v_amount := COALESCE(v_amount_local, v_amount_usd, NEW.amount);

    PERFORM public.queue_email(
      'approved_withdrawal',
      v_user_email,
      NEW.user_id,
      jsonb_build_object(
        'user_name', v_user_name,
        'amount', trim(to_char(v_amount, 'FM9999999990.00')),
        'currency', v_currency,
        'payment_method', v_payment_method,
        'account_details', v_account_details
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

