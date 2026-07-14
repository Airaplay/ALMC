/*
  # Refine support ticket email behavior

  Support emails are sent from `support@airaplay.com` in the Edge Function.
  This migration updates the templates so users understand they can reply to
  the email while keeping the ticket number in the subject.
*/

UPDATE public.email_templates
SET
  subject = 'Support Ticket {{ticket_number}} - Received',
  html_content = '<!DOCTYPE html>
<html>
<head>
<style>
body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; background: #ffffff; }
.header { background: #000000; color: #ffffff; padding: 30px; text-align: center; }
.content { background: #ffffff; padding: 30px; }
.ticket-box { background: #f8fff9; border: 1px solid #cdeed7; border-left: 4px solid #00ad74; border-radius: 8px; padding: 16px; margin: 16px 0; }
.reply-note { background: #f7f7f7; border-radius: 8px; padding: 14px; margin: 16px 0; }
.footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1 style="margin: 0;">Support Ticket Received</h1>
  </div>
  <div class="content">
    <p>Hi {{user_name}},</p>
    <p>We received your support request. Please keep this ticket number for reference:</p>
    <div class="ticket-box">
      <p><strong>Ticket Number:</strong> {{ticket_number}}</p>
      <p><strong>Subject:</strong> {{ticket_subject}}</p>
      <p><strong>Category:</strong> {{ticket_category}}</p>
      <p><strong>Status:</strong> {{ticket_status}}</p>
    </div>
    <div class="reply-note">
      <p><strong>Need to add more details?</strong></p>
      <p>You can reply directly to this email. Please keep <strong>{{ticket_number}}</strong> in the subject so our support team can match your message to the right ticket.</p>
    </div>
    <p>Our support team will review your request and reply from <strong>support@airaplay.com</strong>.</p>
  </div>
  <div class="footer">
    <p>&copy; 2026 Airaplay. All rights reserved.</p>
  </div>
</div>
</body>
</html>',
  variables = '["user_name","user_email","ticket_number","ticket_subject","ticket_category","ticket_status"]'::jsonb,
  updated_at = now()
WHERE template_type = 'support_ticket_received';

UPDATE public.email_templates
SET
  subject = 'Re: Support Ticket {{ticket_number}} - {{ticket_subject}}',
  html_content = '<!DOCTYPE html>
<html>
<head>
<style>
body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; background: #ffffff; }
.header { background: #000000; color: #ffffff; padding: 30px; text-align: center; }
.content { background: #ffffff; padding: 30px; }
.reply-box { background: #f8fff9; border: 1px solid #cdeed7; border-left: 4px solid #00ad74; border-radius: 8px; padding: 16px; margin: 16px 0; white-space: pre-wrap; }
.meta { background: #f7f7f7; border-radius: 8px; padding: 12px; margin: 16px 0; }
.footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1 style="margin: 0;">Support Reply</h1>
  </div>
  <div class="content">
    <p>Hi {{user_name}},</p>
    <p>Our support team replied to your ticket.</p>
    <div class="meta">
      <p><strong>Ticket Number:</strong> {{ticket_number}}</p>
      <p><strong>Subject:</strong> {{ticket_subject}}</p>
    </div>
    <div class="reply-box">{{reply_message}}</div>
    <p>You can reply directly to this email if you still need help. Please keep <strong>{{ticket_number}}</strong> in the subject.</p>
  </div>
  <div class="footer">
    <p>&copy; 2026 Airaplay. All rights reserved.</p>
  </div>
</div>
</body>
</html>',
  variables = '["user_name","user_email","ticket_number","ticket_subject","reply_message"]'::jsonb,
  updated_at = now()
WHERE template_type = 'support_ticket_reply';
