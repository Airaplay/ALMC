/*
  # Fix Admin Notification Functions - Correct Column Names

  1. Changes
    - Update all functions to use `notification_type` instead of `type`
    - Add missing columns: `reference_type`, `read_at`, `read_by`
    - Drop triggers before functions

  2. Security
    - Maintains SECURITY DEFINER for proper access control
*/

-- Drop triggers first
DROP TRIGGER IF EXISTS on_withdrawal_request_created ON withdrawal_requests;
DROP TRIGGER IF EXISTS trigger_notify_withdrawal_request ON withdrawal_requests;

-- Drop existing functions
DROP FUNCTION IF EXISTS create_support_ticket(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS get_admin_notification_counts();
DROP FUNCTION IF EXISTS get_admin_notifications(INTEGER, INTEGER);
DROP FUNCTION IF EXISTS mark_notification_read(UUID);
DROP FUNCTION IF EXISTS notify_withdrawal_request() CASCADE;

-- Add missing columns to admin_action_notifications if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_action_notifications' 
    AND column_name = 'reference_type'
  ) THEN
    ALTER TABLE admin_action_notifications ADD COLUMN reference_type TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_action_notifications' 
    AND column_name = 'read_at'
  ) THEN
    ALTER TABLE admin_action_notifications ADD COLUMN read_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'admin_action_notifications' 
    AND column_name = 'read_by'
  ) THEN
    ALTER TABLE admin_action_notifications ADD COLUMN read_by UUID REFERENCES users(id);
  END IF;
END $$;

-- Function to create support ticket
CREATE OR REPLACE FUNCTION create_support_ticket(
  p_subject TEXT,
  p_message TEXT,
  p_category TEXT DEFAULT 'general'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_id UUID;
  v_user_id UUID;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Create support ticket
  INSERT INTO support_tickets (
    user_id,
    subject,
    message,
    category,
    status,
    priority
  ) VALUES (
    v_user_id,
    p_subject,
    p_message,
    p_category,
    'pending',
    'medium'
  )
  RETURNING id INTO v_ticket_id;

  -- Create admin notification
  INSERT INTO admin_action_notifications (
    notification_type,
    title,
    message,
    reference_id,
    reference_type
  ) VALUES (
    'support_ticket',
    'New Support Ticket',
    'New ticket: ' || p_subject,
    v_ticket_id,
    'support_ticket'
  );

  RETURN v_ticket_id;
END;
$$;

-- Function to get admin notification counts by type
CREATE OR REPLACE FUNCTION get_admin_notification_counts()
RETURNS TABLE (
  withdrawal_requests BIGINT,
  financial_alerts BIGINT,
  support_tickets BIGINT,
  payment_monitoring BIGINT,
  total BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE notification_type = 'withdrawal_request' AND is_read = false) AS withdrawal_requests,
    COUNT(*) FILTER (WHERE notification_type = 'financial_alert' AND is_read = false) AS financial_alerts,
    COUNT(*) FILTER (WHERE notification_type = 'support_ticket' AND is_read = false) AS support_tickets,
    COUNT(*) FILTER (WHERE notification_type = 'payment_monitoring' AND is_read = false) AS payment_monitoring,
    COUNT(*) FILTER (WHERE is_read = false) AS total
  FROM admin_action_notifications;
END;
$$;

-- Function to get admin notifications with pagination
CREATE OR REPLACE FUNCTION get_admin_notifications(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  notification_type TEXT,
  title TEXT,
  message TEXT,
  reference_id UUID,
  reference_type TEXT,
  is_read BOOLEAN,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    n.id,
    n.notification_type,
    n.title,
    n.message,
    n.reference_id,
    n.reference_type,
    n.is_read,
    n.read_at,
    n.created_at
  FROM admin_action_notifications n
  ORDER BY n.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Function to mark notification as read
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE admin_action_notifications
  SET 
    is_read = true,
    read_at = now(),
    read_by = auth.uid()
  WHERE id = p_notification_id
    AND is_read = false;
END;
$$;

-- Trigger function for withdrawal request notifications
CREATE OR REPLACE FUNCTION notify_withdrawal_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create notification for new withdrawal requests
  INSERT INTO admin_action_notifications (
    notification_type,
    title,
    message,
    reference_id,
    reference_type
  ) VALUES (
    'withdrawal_request',
    'New Withdrawal Request',
    'User ' || NEW.user_id || ' requested withdrawal of ' || NEW.amount || ' ' || NEW.currency,
    NEW.id,
    'withdrawal_request'
  );
  
  RETURN NEW;
END;
$$;

-- Create trigger on withdrawal_requests table
CREATE TRIGGER on_withdrawal_request_created
  AFTER INSERT ON withdrawal_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_withdrawal_request();

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION create_support_ticket TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_notification_counts TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_notifications TO authenticated;
GRANT EXECUTE ON FUNCTION mark_notification_read TO authenticated;
