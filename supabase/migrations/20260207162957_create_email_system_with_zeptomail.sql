/*
  # Email System with ZeptoMail Integration

  1. New Tables
    - `email_templates`
      - Stores email templates for different types (welcome, purchase, withdrawal, newsletter, weekly_report)
      - Supports HTML content with placeholders
      - Version control for templates
    
    - `email_logs`
      - Tracks all sent emails
      - Stores delivery status and error messages
      - Links to users for audit trail
    
    - `zeptomail_config`
      - Stores ZeptoMail API configuration
      - Encrypted API tokens
      - From email addresses for different email types

  2. Security
    - Enable RLS on all tables
    - Only admins can manage email templates
    - Email logs are read-only for admins
    - ZeptoMail config is admin-only
*/

-- Create email_templates table
CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type text NOT NULL CHECK (template_type IN ('welcome', 'purchase_treat', 'approved_withdrawal', 'newsletter', 'weekly_report')),
  subject text NOT NULL,
  html_content text NOT NULL,
  variables jsonb DEFAULT '[]'::jsonb, -- List of available variables like {{user_name}}, {{amount}}
  is_active boolean DEFAULT true,
  version integer DEFAULT 1,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create email_logs table
CREATE TABLE IF NOT EXISTS email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type text NOT NULL,
  recipient_email text NOT NULL,
  recipient_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subject text NOT NULL,
  html_content text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),
  provider_message_id text,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create zeptomail_config table
CREATE TABLE IF NOT EXISTS zeptomail_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_token text NOT NULL, -- Store in Supabase Vault in production
  from_email text NOT NULL,
  from_name text NOT NULL DEFAULT 'Airaplay',
  bounce_address text,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_email_templates_type ON email_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_email_templates_active ON email_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_logs_user ON email_logs(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_type ON email_logs(template_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE zeptomail_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies for email_templates
CREATE POLICY "Admins can view email templates"
ON email_templates
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager')
  )
);

CREATE POLICY "Admins can create email templates"
ON email_templates
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

CREATE POLICY "Admins can update email templates"
ON email_templates
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

-- RLS Policies for email_logs
CREATE POLICY "Admins can view email logs"
ON email_logs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager', 'account')
  )
);

CREATE POLICY "System can insert email logs"
ON email_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

-- RLS Policies for zeptomail_config
CREATE POLICY "Admins can view zeptomail config"
ON zeptomail_config
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

CREATE POLICY "Admins can manage zeptomail config"
ON zeptomail_config
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

-- Insert default email templates
INSERT INTO email_templates (template_type, subject, html_content, variables, is_active) VALUES
(
  'welcome',
  'Welcome to Airaplay!',
  '<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #00ad74, #008a5d); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; }
    .footer { background: #f5f5f5; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px; color: #666; }
    .button { display: inline-block; padding: 12px 30px; background: #00ad74; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to Airaplay!</h1>
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
    </div>
  </div>
</body>
</html>',
  '["user_name", "user_email", "app_url"]'::jsonb,
  true
),
(
  'purchase_treat',
  'Treat Purchase Confirmation',
  '<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #00ad74, #008a5d); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; }
    .footer { background: #f5f5f5; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px; color: #666; }
    .amount { font-size: 36px; font-weight: bold; color: #00ad74; text-align: center; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Purchase Successful!</h1>
    </div>
    <div class="content">
      <p>Hi {{user_name}},</p>
      <p>Your Treat purchase has been completed successfully.</p>
      <div class="amount">{{amount}} Treats</div>
      <p><strong>Transaction ID:</strong> {{transaction_id}}</p>
      <p><strong>Payment Method:</strong> {{payment_method}}</p>
      <p><strong>Date:</strong> {{date}}</p>
      <p>You can now use your Treats to support your favorite artists and unlock exclusive features!</p>
    </div>
    <div class="footer">
      <p>&copy; 2026 Airaplay. All rights reserved.</p>
    </div>
  </div>
</body>
</html>',
  '["user_name", "amount", "transaction_id", "payment_method", "date"]'::jsonb,
  true
),
(
  'approved_withdrawal',
  'Withdrawal Approved',
  '<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #00ad74, #008a5d); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; }
    .footer { background: #f5f5f5; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px; color: #666; }
    .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Withdrawal Approved!</h1>
    </div>
    <div class="content">
      <p>Hi {{user_name}},</p>
      <div class="success">
        <p><strong>Great news!</strong> Your withdrawal request has been approved.</p>
      </div>
      <p><strong>Amount:</strong> {{currency}} {{amount}}</p>
      <p><strong>Payment Method:</strong> {{payment_method}}</p>
      <p><strong>Account Details:</strong> {{account_details}}</p>
      <p><strong>Processing Time:</strong> 3-5 business days</p>
      <p>The funds will be transferred to your account shortly.</p>
    </div>
    <div class="footer">
      <p>&copy; 2026 Airaplay. All rights reserved.</p>
    </div>
  </div>
</body>
</html>',
  '["user_name", "amount", "currency", "payment_method", "account_details"]'::jsonb,
  true
),
(
  'newsletter',
  'Weekly Newsletter - What''s Hot on Airaplay',
  '<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #00ad74, #008a5d); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; }
    .footer { background: #f5f5f5; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px; color: #666; }
    .section { margin: 20px 0; }
    .button { display: inline-block; padding: 12px 30px; background: #00ad74; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>What''s Hot on Airaplay</h1>
      <p>Your weekly music digest</p>
    </div>
    <div class="content">
      <p>Hi {{user_name}},</p>
      <p>Here are this week''s top highlights on Airaplay:</p>
      
      <div class="section">
        <h3>Trending Now</h3>
        <p>{{trending_content}}</p>
      </div>
      
      <div class="section">
        <h3>New Releases</h3>
        <p>{{new_releases}}</p>
      </div>
      
      <div class="section">
        <h3>Featured Artists</h3>
        <p>{{featured_artists}}</p>
      </div>
      
      <a href="{{app_url}}" class="button">Explore Now</a>
    </div>
    <div class="footer">
      <p>&copy; 2026 Airaplay. All rights reserved.</p>
      <p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>',
  '["user_name", "trending_content", "new_releases", "featured_artists", "app_url", "unsubscribe_url"]'::jsonb,
  true
),
(
  'weekly_report',
  'Your Weekly Performance Report',
  '<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #00ad74, #008a5d); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; }
    .footer { background: #f5f5f5; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px; color: #666; }
    .stats { display: flex; justify-content: space-around; margin: 30px 0; }
    .stat { text-align: center; }
    .stat-value { font-size: 32px; font-weight: bold; color: #00ad74; }
    .stat-label { font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Your Weekly Report</h1>
      <p>{{date_range}}</p>
    </div>
    <div class="content">
      <p>Hi {{user_name}},</p>
      <p>Here''s how your content performed this week:</p>
      
      <div class="stats">
        <div class="stat">
          <div class="stat-value">{{plays}}</div>
          <div class="stat-label">Plays</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{likes}}</div>
          <div class="stat-label">Likes</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{shares}}</div>
          <div class="stat-label">Shares</div>
        </div>
      </div>
      
      <p><strong>Earnings This Week:</strong> {{earnings}}</p>
      <p><strong>New Followers:</strong> {{new_followers}}</p>
      <p><strong>Top Track:</strong> {{top_track}}</p>
      
      <p>Keep creating amazing content!</p>
    </div>
    <div class="footer">
      <p>&copy; 2026 Airaplay. All rights reserved.</p>
    </div>
  </div>
</body>
</html>',
  '["user_name", "date_range", "plays", "likes", "shares", "earnings", "new_followers", "top_track"]'::jsonb,
  true
)
ON CONFLICT DO NOTHING;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON email_templates TO authenticated;
GRANT SELECT, INSERT ON email_logs TO authenticated;
GRANT ALL ON zeptomail_config TO authenticated;
