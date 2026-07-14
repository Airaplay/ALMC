/*
  # Fix withdrawal triggers referencing removed columns

  ## Problem
  Some trigger functions still reference legacy fields (e.g. NEW.currency, NEW.payment_method).
  On current schema versions, these columns may not exist on withdrawal_requests, causing:
    record "new" has no field "currency" (42703)
  during admin approval updates.

  ## Fix
  - Make trigger payload extraction schema-safe via to_jsonb(NEW)->>...
  - Keep behavior compatible with both old and new column names.
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
BEGIN
  -- Only send email when status changes to approved
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status <> 'approved') THEN
    SELECT email, COALESCE(display_name, email)
    INTO v_user_email, v_user_name
    FROM public.users
    WHERE id = NEW.user_id;

    -- Read fields from NEW in a schema-tolerant way (works across migrations).
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

    PERFORM public.queue_email(
      'approved_withdrawal',
      v_user_email,
      NEW.user_id,
      jsonb_build_object(
        'user_name', v_user_name,
        'amount', NEW.amount::text,
        'currency', v_currency,
        'payment_method', v_payment_method,
        'account_details', v_account_details
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_withdrawal_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency text;
  v_symbol text;
BEGIN
  v_currency := COALESCE(
    to_jsonb(NEW)->>'currency_code',
    to_jsonb(NEW)->>'currency',
    'USD'
  );
  v_symbol := COALESCE(to_jsonb(NEW)->>'currency_symbol', '$');

  INSERT INTO public.admin_action_notifications (
    notification_type,
    title,
    message,
    reference_id,
    reference_type
  ) VALUES (
    'withdrawal_request',
    'New Withdrawal Request',
    'User ' || NEW.user_id || ' requested withdrawal of ' || v_symbol || NEW.amount || ' ' || v_currency,
    NEW.id,
    'withdrawal_request'
  );

  RETURN NEW;
END;
$$;

/*
  Send receipt email when withdrawal is marked as paid/completed.
*/
CREATE OR REPLACE FUNCTION public.trigger_send_withdrawal_paid_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_email text;
  v_user_name text;
  v_currency text;
  v_symbol text;
  v_payment_method text;
  v_account_details text;
  v_net_amount numeric;
BEGIN
  -- Fire only when status transitions to completed (paid)
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    SELECT email, COALESCE(display_name, email)
    INTO v_user_email, v_user_name
    FROM public.users
    WHERE id = NEW.user_id;

    v_currency := COALESCE(
      to_jsonb(NEW)->>'currency_code',
      to_jsonb(NEW)->>'currency',
      'USD'
    );
    v_symbol := COALESCE(to_jsonb(NEW)->>'currency_symbol', '$');
    v_payment_method := COALESCE(
      to_jsonb(NEW)->>'payment_method',
      to_jsonb(NEW)->>'method_type',
      'bank transfer'
    );
    v_account_details := COALESCE(
      to_jsonb(NEW)->>'account_holder_name',
      'Your registered account'
    );

    v_net_amount := COALESCE(
      NEW.net_amount,
      NEW.amount
    );

    PERFORM public.queue_email(
      'completed_withdrawal',
      v_user_email,
      NEW.user_id,
      jsonb_build_object(
        'user_name', v_user_name,
        'transaction_id', COALESCE(NEW.transaction_id, NEW.id::text),
        'amount', v_net_amount::text,
        'currency', v_currency,
        'currency_symbol', v_symbol,
        'payment_method', v_payment_method,
        'account_details', v_account_details,
        'payment_reference', COALESCE(NEW.payment_reference, ''),
        'completed_at', COALESCE(NEW.payment_completed_date, now())
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Attach paid-email trigger to withdrawal_requests
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'withdrawal_requests'
      AND n.nspname = 'public'
  ) THEN
    DROP TRIGGER IF EXISTS on_withdrawal_paid_send_email ON public.withdrawal_requests;
    CREATE TRIGGER on_withdrawal_paid_send_email
      AFTER UPDATE ON public.withdrawal_requests
      FOR EACH ROW
      EXECUTE FUNCTION public.trigger_send_withdrawal_paid_email();
  END IF;
END;
$$;


