/*
  # Update Email Templates with Official Logo and Black Header
  
  Updates all 7 email templates to include:
  - Black header background (#000000)
  - Official Airaplay logo in header
  - Professional email design
  
  ## Templates Updated
  
  1. welcome
  2. purchase_treat
  3. approved_withdrawal
  4. creator_approved
  5. promotion_active
  6. newsletter
  7. weekly_report
*/

-- Update Welcome Email Template
UPDATE email_templates
SET 
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
.button { display: inline-block; padding: 12px 30px; background: #00ad74; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
</style>
</head>
<body>
<div class="container">
<div class="header">
<img src="https://airaplay.com/official_airaplay_logo.png" alt="Airaplay Logo">
<h1 style="margin: 10px 0 0 0;">Welcome to Airaplay!</h1>
</div>
<div class="content">
<p>Hi {{user_name}},</p>
<p>Welcome to Airaplay - your new home for discovering and sharing amazing music!</p>
<p>We are excited to have you join our community of music lovers and creators.</p>
<p>Get started by exploring trending tracks, creating playlists, and connecting with artists.</p>
<a href="{{app_url}}" class="button">Start Exploring</a>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
<p>{{user_email}}</p>
</div>
</div>
</body>
</html>',
  updated_at = NOW()
WHERE template_type = 'welcome';

-- Update Purchase Treat Email Template
UPDATE email_templates
SET 
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
.info-box { background: #f9f9f9; padding: 15px; border-left: 4px solid #00ad74; margin: 20px 0; }
</style>
</head>
<body>
<div class="container">
<div class="header">
<img src="https://airaplay.com/official_airaplay_logo.png" alt="Airaplay Logo">
<h1 style="margin: 10px 0 0 0;">Purchase Confirmed!</h1>
</div>
<div class="content">
<p>Hi {{user_name}},</p>
<p>Thank you for your purchase! Your Treats have been added to your wallet.</p>
<div class="info-box">
<strong>Purchase Details:</strong><br>
Amount: {{amount}} Treats<br>
Transaction ID: {{transaction_id}}<br>
Payment Method: {{payment_method}}<br>
Date: {{date}}
</div>
<p>You can now use your Treats to promote your content, tip artists, and unlock premium features.</p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
</div>
</div>
</body>
</html>',
  updated_at = NOW()
WHERE template_type = 'purchase_treat';

-- Update Approved Withdrawal Email Template
UPDATE email_templates
SET 
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
<img src="https://airaplay.com/official_airaplay_logo.png" alt="Airaplay Logo">
<h1 style="margin: 10px 0 0 0;">Withdrawal Approved!</h1>
</div>
<div class="content">
<p>Hi {{user_name}},</p>
<p>Great news! Your withdrawal request has been approved and is being processed.</p>
<div class="success-box">
<strong>Withdrawal Details:</strong><br>
Amount: {{amount}} {{currency}}<br>
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
  updated_at = NOW()
WHERE template_type = 'approved_withdrawal';

-- Update Creator Approved Email Template
UPDATE email_templates
SET 
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
.button { display: inline-block; padding: 12px 30px; background: #00ad74; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
.feature-list { background: #f9f9f9; padding: 20px; margin: 20px 0; border-radius: 5px; }
</style>
</head>
<body>
<div class="container">
<div class="header">
<img src="https://airaplay.com/official_airaplay_logo.png" alt="Airaplay Logo">
<h1 style="margin: 10px 0 0 0;">You are now a Creator!</h1>
</div>
<div class="content">
<p>Hi {{user_name}},</p>
<p>Congratulations! Your creator account has been approved.</p>
<div class="feature-list">
<strong>What you can do now:</strong>
<ul>
<li>Upload unlimited music and videos</li>
<li>Earn from ad revenue and tips</li>
<li>Promote your content</li>
<li>Access creator analytics</li>
<li>Collaborate with other artists</li>
</ul>
</div>
<p>Start uploading your content and building your fanbase today!</p>
<a href="{{app_url}}" class="button">Go to Creator Dashboard</a>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
<p>{{user_email}}</p>
</div>
</div>
</body>
</html>',
  updated_at = NOW()
WHERE template_type = 'creator_approved';

-- Update Promotion Active Email Template
UPDATE email_templates
SET 
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
.promo-box { background: #e6f7f1; padding: 15px; border-left: 4px solid #00ad74; margin: 20px 0; }
</style>
</head>
<body>
<div class="container">
<div class="header">
<img src="https://airaplay.com/official_airaplay_logo.png" alt="Airaplay Logo">
<h1 style="margin: 10px 0 0 0;">Your Promotion is Live!</h1>
</div>
<div class="content">
<p>Hi {{user_name}},</p>
<p>Great news! Your promotion is now live and getting views.</p>
<div class="promo-box">
<strong>Promotion Details:</strong><br>
Content: {{content_title}}<br>
Section: {{section}}<br>
Duration: {{duration}}<br>
Treats Spent: {{treats_spent}}
</div>
<p>Track your promotion performance in real-time from your analytics dashboard.</p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
</div>
</div>
</body>
</html>',
  updated_at = NOW()
WHERE template_type = 'promotion_active';

-- Update Newsletter Email Template
UPDATE email_templates
SET 
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
.newsletter-content { margin: 20px 0; }
</style>
</head>
<body>
<div class="container">
<div class="header">
<img src="https://airaplay.com/official_airaplay_logo.png" alt="Airaplay Logo">
<h1 style="margin: 10px 0 0 0;">{{newsletter_title}}</h1>
</div>
<div class="content">
<p>Hi {{user_name}},</p>
<div class="newsletter-content">
{{newsletter_content}}
</div>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
<p><a href="{{unsubscribe_url}}" style="color: #666;">Unsubscribe</a></p>
</div>
</div>
</body>
</html>',
  updated_at = NOW()
WHERE template_type = 'newsletter';

-- Update Weekly Report Email Template
UPDATE email_templates
SET 
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
.button { display: inline-block; padding: 12px 30px; background: #00ad74; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
.stats-box { background: #f9f9f9; padding: 20px; margin: 20px 0; border-radius: 5px; }
.stat-item { margin: 10px 0; font-size: 16px; }
</style>
</head>
<body>
<div class="container">
<div class="header">
<img src="https://airaplay.com/official_airaplay_logo.png" alt="Airaplay Logo">
<h1 style="margin: 10px 0 0 0;">Your Weekly Report</h1>
</div>
<div class="content">
<p>Hi {{user_name}},</p>
<p>Here is your performance summary for the past week:</p>
<div class="stats-box">
<div class="stat-item">📊 <strong>Total Streams:</strong> {{streams_count}}</div>
<div class="stat-item">💰 <strong>Earnings:</strong> {{earnings}}</div>
<div class="stat-item">🎵 <strong>Top Song:</strong> {{top_song}}</div>
</div>
<p>Keep up the great work! Check out your full analytics dashboard for more insights.</p>
<a href="{{report_url}}" class="button">View Full Report</a>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
</div>
</div>
</body>
</html>',
  updated_at = NOW()
WHERE template_type = 'weekly_report';

-- Verify all templates were updated
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM email_templates
  WHERE html_content LIKE '%<img src="https://airaplay.com/official_airaplay_logo.png"%'
    AND html_content LIKE '%background: #000000%';
  
  IF v_count = 7 THEN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Email Templates Updated Successfully!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'All 7 templates now have:';
    RAISE NOTICE '✓ Black header background (#000000)';
    RAISE NOTICE '✓ Official Airaplay logo';
    RAISE NOTICE '✓ Professional email design';
    RAISE NOTICE '';
    RAISE NOTICE 'Templates updated: welcome, purchase_treat, approved_withdrawal,';
    RAISE NOTICE '                   creator_approved, promotion_active, newsletter, weekly_report';
  ELSE
    RAISE WARNING 'Only % of 7 templates were updated. Please review.', v_count;
  END IF;
END $$;
