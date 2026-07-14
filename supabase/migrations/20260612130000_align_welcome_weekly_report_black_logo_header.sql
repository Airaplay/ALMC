/*
  # Align Welcome + Creator Weekly Report with Withdrawal Approved header

  Ensures both templates use the same black logo header strip as approved_withdrawal:
  - Solid #000000 header (CSS + inline for email clients that strip <style>)
  - Official white logo only in the header (title lives in the mint body)
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
.header { background-color: #000000; background: #000000; color: #ffffff; padding: 32px 24px; text-align: center; }
.header img { max-width: 200px; height: auto; display: block; margin: 0 auto; border: 0; }
.body { background: #f5faf5; color: #111111; padding: 28px 28px 36px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.body h1 { font-size: 24px; font-weight: 700; margin: 0 0 18px 0; line-height: 1.25; color: #000000; }
.body p { margin: 0 0 14px 0; font-size: 15px; line-height: 1.55; color: #111111; }
.footer { background: #eeeeee; padding: 18px; text-align: center; font-size: 12px; color: #555555; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
.button { display: inline-block; padding: 12px 28px; background: #00ad74; color: #ffffff !important; text-decoration: none; border-radius: 6px; margin: 16px 0; font-weight: 600; font-size: 15px; }
</style>
</head>
<body>
<div class="outer">
<div class="header" style="background-color:#000000;background:#000000;color:#ffffff;padding:32px 24px;text-align:center;">
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

-- weekly_report (Creator Weekly Report)
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
.header { background-color: #000000; background: #000000; color: #ffffff; padding: 32px 24px; text-align: center; }
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
<div class="header" style="background-color:#000000;background:#000000;color:#ffffff;padding:32px 24px;text-align:center;">
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
