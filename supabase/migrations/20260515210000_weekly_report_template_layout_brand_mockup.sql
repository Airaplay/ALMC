/*
  # Weekly report email: layout aligned with brand mockup

  - Black header: logo only (title moves to body for white-on-black contrast).
  - Body: pale mint background (#f5faf5), black text, left-aligned.
  - Metrics: Total Streams (bold label), Top Song plain label, Estimated + Treat (bold labels).
  - No emoji bullets; footer kept subtle.
  - `stream_earnings` shown between Estimated and Treat (same styling as mock metrics).
*/

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
