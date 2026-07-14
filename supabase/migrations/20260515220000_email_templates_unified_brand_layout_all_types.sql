/*
  # Unified Airaplay email layout (all transactional / marketing templates)

  Matches the weekly report mockup pattern:
  - Black header strip with official logo only (no title in header; white logo visible).
  - Body: #f5faf5 mint, black text, system font stack.
  - Title as <h1> inside the body.
  - Gray footer; primary buttons stay brand green (#00ad74).

  Matches the weekly report mockup pattern across **all** `email_templates` rows:
  - Black header strip with official logo only (title lives in the mint body).
  - Body: #f5faf5 mint, black text, system font stack.
  - Gray footer; accent boxes and CTAs use brand green (#00ad74).

  Re-applies `weekly_report` HTML so a single migration run leaves every template consistent
  (safe if `20260515210000_weekly_report_template_layout_brand_mockup.sql` already ran).
*/

-- welcome
UPDATE public.email_templates
SET
  subject = 'Welcome to Airaplay',
  variables = '["user_name","user_email","app_url"]'::jsonb,
  html_content = $tpl$
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome</title>
<style>
body { margin: 0; padding: 0; background: #e8ebe8; -webkit-font-smoothing: antialiased; }
.outer { max-width: 600px; margin: 0 auto; }
.header { background-color: #000000; background: #000000; padding: 32px 24px; text-align: center; }
.header img { max-width: 200px; height: auto; display: block; margin: 0 auto; border: 0; }
.body { background: #f5faf5; color: #111111; padding: 28px 28px 36px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.body h1 { font-size: 24px; font-weight: 700; margin: 0 0 18px 0; line-height: 1.25; color: #000000; }
.body p { margin: 0 0 14px 0; font-size: 15px; line-height: 1.55; color: #111111; }
.body ul { margin: 8px 0 14px 20px; padding: 0; font-size: 15px; line-height: 1.55; color: #111111; }
.footer { background: #eeeeee; padding: 18px; text-align: center; font-size: 12px; color: #555555; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.button { display: inline-block; padding: 12px 28px; background: #00ad74; color: #ffffff !important; text-decoration: none; border-radius: 6px; margin: 16px 0; font-weight: 600; font-size: 15px; }
</style>
</head>
<body>
<div class="outer">
<div class="header" style="background-color:#000000;background:#000000;padding:32px 24px;text-align:center;">
<img src="https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png" alt="Airaplay" width="200" style="max-width:200px;height:auto;display:block;margin:0 auto;border:0;">
</div>
<div class="body">
<h1>Welcome to Airaplay!</h1>
<p>Hi {{user_name}},</p>
<p>Welcome to Airaplay — your home for discovering and sharing music.</p>
<p>We are excited to have you in our community of listeners and creators.</p>
<p>Explore trending tracks, build playlists, and connect with artists.</p>
<p><a class="button" href="{{app_url}}">Start exploring</a></p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
<p style="font-size:11px;color:#777;">{{user_email}}</p>
</div>
</div>
</body>
</html>
$tpl$,
  updated_at = now()
WHERE template_type = 'welcome';

-- purchase_treat
UPDATE public.email_templates
SET
  subject = 'Purchase confirmed',
  variables = '["user_name","amount","transaction_id","payment_method","date"]'::jsonb,
  html_content = $tpl$
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Purchase confirmed</title>
<style>
body { margin: 0; padding: 0; background: #e8ebe8; -webkit-font-smoothing: antialiased; }
.outer { max-width: 600px; margin: 0 auto; }
.header { background-color: #000000; background: #000000; padding: 32px 24px; text-align: center; }
.header img { max-width: 200px; height: auto; display: block; margin: 0 auto; border: 0; }
.body { background: #f5faf5; color: #111111; padding: 28px 28px 36px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.body h1 { font-size: 24px; font-weight: 700; margin: 0 0 18px 0; line-height: 1.25; color: #000000; }
.body p { margin: 0 0 14px 0; font-size: 15px; line-height: 1.55; color: #111111; }
.info-box { background: #eef7f0; border-left: 4px solid #00ad74; padding: 16px 18px; margin: 18px 0; border-radius: 4px; font-size: 15px; line-height: 1.55; color: #111111; }
.footer { background: #eeeeee; padding: 18px; text-align: center; font-size: 12px; color: #555555; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
</style>
</head>
<body>
<div class="outer">
<div class="header" style="background-color:#000000;background:#000000;padding:32px 24px;text-align:center;">
<img src="https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png" alt="Airaplay" width="200" style="max-width:200px;height:auto;display:block;margin:0 auto;border:0;">
</div>
<div class="body">
<h1>Purchase confirmed</h1>
<p>Hi {{user_name}},</p>
<p>Thank you. Your Treats have been added to your wallet.</p>
<div class="info-box">
<strong>Purchase details</strong><br>
Amount: {{amount}} Treats<br>
Transaction ID: {{transaction_id}}<br>
Payment method: {{payment_method}}<br>
Date: {{date}}
</div>
<p>Use Treats to promote content, tip artists, and unlock premium features.</p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
</div>
</div>
</body>
</html>
$tpl$,
  updated_at = now()
WHERE template_type = 'purchase_treat';

-- approved_withdrawal
UPDATE public.email_templates
SET
  subject = 'Withdrawal approved',
  variables = '["user_name","amount","currency","payment_method","account_details"]'::jsonb,
  html_content = $tpl$
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Withdrawal approved</title>
<style>
body { margin: 0; padding: 0; background: #e8ebe8; -webkit-font-smoothing: antialiased; }
.outer { max-width: 600px; margin: 0 auto; }
.header { background-color: #000000; background: #000000; padding: 32px 24px; text-align: center; }
.header img { max-width: 200px; height: auto; display: block; margin: 0 auto; border: 0; }
.body { background: #f5faf5; color: #111111; padding: 28px 28px 36px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.body h1 { font-size: 24px; font-weight: 700; margin: 0 0 18px 0; line-height: 1.25; color: #000000; }
.body p { margin: 0 0 14px 0; font-size: 15px; line-height: 1.55; color: #111111; }
.success-box { background: #eef7f0; border-left: 4px solid #00ad74; padding: 16px 18px; margin: 18px 0; border-radius: 4px; font-size: 15px; line-height: 1.55; color: #111111; }
.footer { background: #eeeeee; padding: 18px; text-align: center; font-size: 12px; color: #555555; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
</style>
</head>
<body>
<div class="outer">
<div class="header" style="background-color:#000000;background:#000000;padding:32px 24px;text-align:center;">
<img src="https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png" alt="Airaplay" width="200" style="max-width:200px;height:auto;display:block;margin:0 auto;border:0;">
</div>
<div class="body">
<h1>Withdrawal approved</h1>
<p>Hi {{user_name}},</p>
<p>Your withdrawal request has been approved and is being processed.</p>
<div class="success-box">
<strong>Withdrawal details</strong><br>
Amount: {{amount}} {{currency}}<br>
Payment method: {{payment_method}}<br>
Account: {{account_details}}
</div>
<p>Funds are typically transferred within 1–3 business days. Contact support if you have questions.</p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
</div>
</div>
</body>
</html>
$tpl$,
  updated_at = now()
WHERE template_type = 'approved_withdrawal';

-- completed_withdrawal
UPDATE public.email_templates
SET
  subject = 'Withdrawal payment receipt',
  variables = '["user_name","transaction_id","amount","currency","currency_symbol","payment_method","account_details","payment_reference","completed_at"]'::jsonb,
  html_content = $tpl$
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Withdrawal paid</title>
<style>
body { margin: 0; padding: 0; background: #e8ebe8; -webkit-font-smoothing: antialiased; }
.outer { max-width: 600px; margin: 0 auto; }
.header { background-color: #000000; background: #000000; padding: 32px 24px; text-align: center; }
.header img { max-width: 200px; height: auto; display: block; margin: 0 auto; border: 0; }
.body { background: #f5faf5; color: #111111; padding: 28px 28px 36px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.body h1 { font-size: 24px; font-weight: 700; margin: 0 0 18px 0; line-height: 1.25; color: #000000; }
.body p { margin: 0 0 14px 0; font-size: 15px; line-height: 1.55; color: #111111; }
.receipt-box { background: #eef7f0; border: 1px solid #cdeed7; border-left: 4px solid #00ad74; border-radius: 8px; padding: 16px 18px; margin: 18px 0; font-size: 15px; line-height: 1.55; color: #111111; }
.row { margin: 8px 0; }
.footer { background: #eeeeee; padding: 18px; text-align: center; font-size: 12px; color: #555555; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
</style>
</head>
<body>
<div class="outer">
<div class="header" style="background-color:#000000;background:#000000;padding:32px 24px;text-align:center;">
<img src="https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png" alt="Airaplay" width="200" style="max-width:200px;height:auto;display:block;margin:0 auto;border:0;">
</div>
<div class="body">
<h1>Withdrawal paid</h1>
<p>Hi {{user_name}},</p>
<p>Your withdrawal has been paid. Receipt:</p>
<div class="receipt-box">
<div class="row"><strong>Transaction ID:</strong> {{transaction_id}}</div>
<div class="row"><strong>Amount:</strong> {{currency_symbol}}{{amount}} {{currency}}</div>
<div class="row"><strong>Payment method:</strong> {{payment_method}}</div>
<div class="row"><strong>Account details:</strong> {{account_details}}</div>
<div class="row"><strong>Payment reference:</strong> {{payment_reference}}</div>
<div class="row"><strong>Completed at:</strong> {{completed_at}}</div>
</div>
<p>If you did not request this withdrawal, contact support immediately.</p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
</div>
</div>
</body>
</html>
$tpl$,
  updated_at = now()
WHERE template_type = 'completed_withdrawal';

-- creator_approved
UPDATE public.email_templates
SET
  subject = 'Creator account approved',
  variables = '["user_name","user_email","app_url"]'::jsonb,
  html_content = $tpl$
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Creator approved</title>
<style>
body { margin: 0; padding: 0; background: #e8ebe8; -webkit-font-smoothing: antialiased; }
.outer { max-width: 600px; margin: 0 auto; }
.header { background-color: #000000; background: #000000; padding: 32px 24px; text-align: center; }
.header img { max-width: 200px; height: auto; display: block; margin: 0 auto; border: 0; }
.body { background: #f5faf5; color: #111111; padding: 28px 28px 36px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.body h1 { font-size: 24px; font-weight: 700; margin: 0 0 18px 0; line-height: 1.25; color: #000000; }
.body p { margin: 0 0 14px 0; font-size: 15px; line-height: 1.55; color: #111111; }
.body ul { margin: 8px 0 14px 20px; padding: 0; font-size: 15px; line-height: 1.55; color: #111111; }
.feature-list { background: #eef7f0; padding: 18px 20px; margin: 18px 0; border-radius: 6px; border-left: 4px solid #00ad74; }
.footer { background: #eeeeee; padding: 18px; text-align: center; font-size: 12px; color: #555555; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.button { display: inline-block; padding: 12px 28px; background: #00ad74; color: #ffffff !important; text-decoration: none; border-radius: 6px; margin: 16px 0; font-weight: 600; font-size: 15px; }
</style>
</head>
<body>
<div class="outer">
<div class="header" style="background-color:#000000;background:#000000;padding:32px 24px;text-align:center;">
<img src="https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png" alt="Airaplay" width="200" style="max-width:200px;height:auto;display:block;margin:0 auto;border:0;">
</div>
<div class="body">
<h1>You are now a creator</h1>
<p>Hi {{user_name}},</p>
<p>Your creator account has been approved.</p>
<div class="feature-list">
<strong>What you can do</strong>
<ul>
<li>Upload music and videos</li>
<li>Earn from ads and tips</li>
<li>Promote your content</li>
<li>View analytics</li>
<li>Collaborate with artists</li>
</ul>
</div>
<p><a class="button" href="{{app_url}}">Open creator dashboard</a></p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
<p style="font-size:11px;color:#777;">{{user_email}}</p>
</div>
</div>
</body>
</html>
$tpl$,
  updated_at = now()
WHERE template_type = 'creator_approved';

-- promotion_active
UPDATE public.email_templates
SET
  subject = 'Your promotion is live',
  variables = '["user_name","content_title","section","duration","treats_spent"]'::jsonb,
  html_content = $tpl$
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Promotion live</title>
<style>
body { margin: 0; padding: 0; background: #e8ebe8; -webkit-font-smoothing: antialiased; }
.outer { max-width: 600px; margin: 0 auto; }
.header { background-color: #000000; background: #000000; padding: 32px 24px; text-align: center; }
.header img { max-width: 200px; height: auto; display: block; margin: 0 auto; border: 0; }
.body { background: #f5faf5; color: #111111; padding: 28px 28px 36px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.body h1 { font-size: 24px; font-weight: 700; margin: 0 0 18px 0; line-height: 1.25; color: #000000; }
.body p { margin: 0 0 14px 0; font-size: 15px; line-height: 1.55; color: #111111; }
.promo-box { background: #eef7f0; border-left: 4px solid #00ad74; padding: 16px 18px; margin: 18px 0; border-radius: 4px; font-size: 15px; line-height: 1.55; color: #111111; }
.footer { background: #eeeeee; padding: 18px; text-align: center; font-size: 12px; color: #555555; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
</style>
</head>
<body>
<div class="outer">
<div class="header" style="background-color:#000000;background:#000000;padding:32px 24px;text-align:center;">
<img src="https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png" alt="Airaplay" width="200" style="max-width:200px;height:auto;display:block;margin:0 auto;border:0;">
</div>
<div class="body">
<h1>Your promotion is live</h1>
<p>Hi {{user_name}},</p>
<p>Your promotion is running and collecting views.</p>
<div class="promo-box">
<strong>Promotion details</strong><br>
Content: {{content_title}}<br>
Section: {{section}}<br>
Duration: {{duration}}<br>
Treats spent: {{treats_spent}}
</div>
<p>Track performance from your analytics dashboard.</p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
</div>
</div>
</body>
</html>
$tpl$,
  updated_at = now()
WHERE template_type = 'promotion_active';

-- newsletter (keeps newsletter_title + newsletter_content for existing sends; HTML may contain markup)
UPDATE public.email_templates
SET
  subject = 'This week on Airaplay',
  variables =
    '["user_name","newsletter_title","newsletter_content","unsubscribe_url"]'::jsonb,
  html_content = $tpl$
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Newsletter</title>
<style>
body { margin: 0; padding: 0; background: #e8ebe8; -webkit-font-smoothing: antialiased; }
.outer { max-width: 600px; margin: 0 auto; }
.header { background-color: #000000; background: #000000; padding: 32px 24px; text-align: center; }
.header img { max-width: 200px; height: auto; display: block; margin: 0 auto; border: 0; }
.body { background: #f5faf5; color: #111111; padding: 28px 28px 36px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.body h1 { font-size: 24px; font-weight: 700; margin: 0 0 18px 0; line-height: 1.25; color: #000000; }
.body p { margin: 0 0 14px 0; font-size: 15px; line-height: 1.55; color: #111111; }
.newsletter-content { margin: 12px 0 18px 0; font-size: 15px; line-height: 1.55; color: #111111; }
.footer { background: #eeeeee; padding: 18px; text-align: center; font-size: 12px; color: #555555; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
</style>
</head>
<body>
<div class="outer">
<div class="header" style="background-color:#000000;background:#000000;padding:32px 24px;text-align:center;">
<img src="https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png" alt="Airaplay" width="200" style="max-width:200px;height:auto;display:block;margin:0 auto;border:0;">
</div>
<div class="body">
<p>Hi {{user_name}},</p>
<div class="newsletter-content">{{newsletter_content}}</div>
<p style="font-size:13px;"><a href="{{unsubscribe_url}}" style="color:#555555;">Unsubscribe</a></p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
</div>
</div>
</body>
</html>
$tpl$,
  updated_at = now()
WHERE template_type = 'newsletter';

-- weekly_report (same layout as 20260515210000; idempotent refresh if that migration ran earlier)
UPDATE public.email_templates
SET
  subject = 'Your Weekly Report',
  variables =
    '["user_name","date_range","streams_count","top_song","earnings_week","stream_earnings","treat_earnings"]'::jsonb,
  html_content = $wk$
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Weekly Report</title>
<style>
body { margin: 0; padding: 0; background: #e8ebe8; -webkit-font-smoothing: antialiased; }
.outer { max-width: 600px; margin: 0 auto; }
.header { background-color: #000000; background: #000000; padding: 32px 24px; text-align: center; }
.header img { max-width: 200px; height: auto; display: block; margin: 0 auto; border: 0; }
.body { background: #f5faf5; color: #111111; padding: 28px 28px 36px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.body h1 { font-size: 24px; font-weight: 700; margin: 0 0 18px 0; line-height: 1.25; color: #000000; }
.body p { margin: 0 0 14px 0; font-size: 15px; line-height: 1.55; color: #111111; }
.metrics { margin: 20px 0 8px 0; }
.row { margin: 10px 0; font-size: 15px; line-height: 1.5; color: #111111; }
.footer { background: #eeeeee; padding: 18px; text-align: center; font-size: 12px; color: #555555; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
</style>
</head>
<body>
<div class="outer">
<div class="header" style="background-color:#000000;background:#000000;padding:32px 24px;text-align:center;">
<img src="https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png" alt="Airaplay" width="200" style="max-width:200px;height:auto;display:block;margin:0 auto;border:0;">
</div>
<div class="body">
<h1>Your Weekly Report</h1>
<p>Hi {{user_name}},</p>
<p>Here is your performance summary for {{date_range}}:</p>
<div class="metrics">
<div class="row"><strong>Total Streams:</strong> {{streams_count}}</div>
<div class="row">Top Song: {{top_song}}</div>
<div class="row"><strong>Estimated Earnings:</strong> {{earnings_week}}</div>
<div class="row"><strong>Stream earnings:</strong> {{stream_earnings}}</div>
<div class="row"><strong>Treat Earnings:</strong> {{treat_earnings}}</div>
</div>
<p>Keep up the great work!</p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
</div>
</div>
</body>
</html>
$wk$,
  updated_at = now()
WHERE template_type = 'weekly_report';
