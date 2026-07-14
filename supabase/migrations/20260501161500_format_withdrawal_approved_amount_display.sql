/*
  # Format approved withdrawal amount for display

  Goal:
  - Show user-friendly amount in email, e.g. "₦6,097.49" instead of "6097.49 NGN".
*/

-- 1) Update template to consume `amount_display`
UPDATE public.email_templates
SET
  variables = '["user_name","amount_display","payment_method","account_details"]'::jsonb,
  html_content = '<!DOCTYPE html>
<html>
<head>
<style>
body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; background: #ffffff; }
.header { background: #000000; color: white; padding: 30px; text-align: center; }
.header img { max-width: 200px; height: auto; margin-bottom: 10px; }
.content { background: #ffffff; padding: 30px; }
.footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; }
.success-box { background: #e6f7f1; padding: 15px; border-left: 4px solid #00ad74; margin: 20px 0; }
</style>
</head>
<body>
<div class="container">
<div class="header">
<img src="https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png" alt="Airaplay Logo">
<h1 style="margin: 10px 0 0 0;">Withdrawal Approved!</h1>
</div>
<div class="content">
<p>Hi {{user_name}},</p>
<p>Great news! Your withdrawal request has been approved and is being processed.</p>
<div class="success-box">
<strong>Withdrawal Details:</strong><br>
Amount: {{amount_display}}<br>
Payment Method: {{payment_method}}<br>
Account: {{account_details}}
</div>
<p>Your funds will be transferred to your account within 1-3 business days.</p>
<p>If you have any questions, please contact our support team.</p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
</div>
</div>
</body>
</html>',
  updated_at = now()
WHERE template_type = 'approved_withdrawal';

-- 2) Emit amount_display from trigger
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
  v_currency_symbol text;
  v_payment_method text;
  v_account_details text;
  v_amount_local numeric;
  v_amount_usd numeric;
  v_amount numeric;
  v_amount_display text;
BEGIN
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
    v_currency_symbol := COALESCE(
      to_jsonb(NEW)->>'currency_symbol',
      CASE WHEN v_currency = 'NGN' THEN '₦' WHEN v_currency = 'USD' THEN '$' ELSE '' END
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

    v_amount_local := NULLIF(to_jsonb(NEW)->>'amount_local', '')::numeric;
    v_amount_usd := NULLIF(to_jsonb(NEW)->>'amount_usd', '')::numeric;
    v_amount := COALESCE(v_amount_local, v_amount_usd, NEW.amount);
    v_amount_display := trim(v_currency_symbol) || to_char(v_amount, 'FM999,999,999,990.00');

    PERFORM public.queue_email(
      'approved_withdrawal',
      v_user_email,
      NEW.user_id,
      jsonb_build_object(
        'user_name', v_user_name,
        'amount_display', v_amount_display,
        'payment_method', v_payment_method,
        'account_details', v_account_details,
        -- backward compatibility
        'amount', trim(to_char(v_amount, 'FM9999999990.00')),
        'currency', v_currency
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

