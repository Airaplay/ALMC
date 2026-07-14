/*
  # Add completed withdrawal receipt email template

  ## Why
  The paid-withdrawal trigger queues template_type = 'completed_withdrawal',
  but this template type is not registered in email_templates constraints/data yet.
  Result: queue item fails in send-email with "Email template not found".

  ## What
  - Extend email_templates template_type CHECK to include completed_withdrawal
  - Insert/update completed_withdrawal template content
*/

-- Ensure template type is allowed
ALTER TABLE public.email_templates
  DROP CONSTRAINT IF EXISTS email_templates_template_type_check;

ALTER TABLE public.email_templates
  ADD CONSTRAINT email_templates_template_type_check
  CHECK (template_type IN (
    'welcome',
    'purchase_treat',
    'approved_withdrawal',
    'completed_withdrawal',
    'newsletter',
    'weekly_report',
    'creator_approved',
    'promotion_active'
  ));

-- Create/update paid-withdrawal receipt template used by ZeptoMail send-email function
INSERT INTO public.email_templates (
  template_type,
  subject,
  html_content,
  variables,
  is_active
) VALUES (
  'completed_withdrawal',
  'Withdrawal Payment Receipt',
  '<!DOCTYPE html>
<html>
<head>
<style>
body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; background: #ffffff; }
.header { background: #000000; color: white; padding: 30px; text-align: center; }
.header img { max-width: 200px; height: auto; margin-bottom: 10px; }
.content { background: #ffffff; padding: 30px; }
.footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; }
.receipt-box { background: #f8fff9; border: 1px solid #cdeed7; border-left: 4px solid #00ad74; border-radius: 8px; padding: 16px; margin: 16px 0; }
.row { margin: 8px 0; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <img src="https://airaplay.com/official_airaplay_logo.png" alt="Airaplay Logo">
    <h1 style="margin: 10px 0 0 0;">Withdrawal Paid</h1>
  </div>
  <div class="content">
    <p>Hi {{user_name}},</p>
    <p>Your withdrawal has been paid successfully. Here is your receipt:</p>
    <div class="receipt-box">
      <div class="row"><strong>Transaction ID:</strong> {{transaction_id}}</div>
      <div class="row"><strong>Amount:</strong> {{currency_symbol}}{{amount}} {{currency}}</div>
      <div class="row"><strong>Payment Method:</strong> {{payment_method}}</div>
      <div class="row"><strong>Account Details:</strong> {{account_details}}</div>
      <div class="row"><strong>Payment Reference:</strong> {{payment_reference}}</div>
      <div class="row"><strong>Completed At:</strong> {{completed_at}}</div>
    </div>
    <p>If you did not request this withdrawal, contact support immediately.</p>
  </div>
  <div class="footer">
    <p>&copy; 2026 Airaplay. All rights reserved.</p>
  </div>
</div>
</body>
</html>',
  '["user_name","transaction_id","amount","currency","currency_symbol","payment_method","account_details","payment_reference","completed_at"]'::jsonb,
  true
)
ON CONFLICT (template_type) DO UPDATE SET
  subject = EXCLUDED.subject,
  html_content = EXCLUDED.html_content,
  variables = EXCLUDED.variables,
  is_active = EXCLUDED.is_active,
  updated_at = now();

