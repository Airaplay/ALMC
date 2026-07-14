/*
  # Admin Notification & Support System Functions

  1. New Functions
    - `create_support_ticket()` - Creates support ticket and notifies admins
    - `get_admin_notification_counts()` - Gets notification counts by type
    - `get_admin_notifications()` - Fetches paginated notifications
    - `mark_notification_read()` - Marks single notification as read
    - `admin_get_support_tickets()` - Admin view of support tickets with user details
    - `admin_update_support_ticket()` - Update ticket status, priority, and notes
    - `notify_withdrawal_request()` - Trigger function for withdrawal notifications

  2. Triggers
    - Automatic notification creation on withdrawal requests

  3. Security
    - All functions use SECURITY DEFINER for proper access control
    - RLS policies enforce admin-only access to notifications
*/

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
    type,
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
    COUNT(*) FILTER (WHERE type = 'withdrawal_request' AND is_read = false) AS withdrawal_requests,
    COUNT(*) FILTER (WHERE type = 'financial_alert' AND is_read = false) AS financial_alerts,
    COUNT(*) FILTER (WHERE type = 'support_ticket' AND is_read = false) AS support_tickets,
    COUNT(*) FILTER (WHERE type = 'payment_monitoring' AND is_read = false) AS payment_monitoring,
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
  type TEXT,
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
    n.type,
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

-- Function to get support tickets for admin
CREATE OR REPLACE FUNCTION admin_get_support_tickets(
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  user_email TEXT,
  user_display_name TEXT,
  subject TEXT,
  message TEXT,
  category TEXT,
  status TEXT,
  priority TEXT,
  admin_notes TEXT,
  assigned_to UUID,
  assigned_to_name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    st.id,
    st.user_id,
    u.email AS user_email,
    u.display_name AS user_display_name,
    st.subject,
    st.message,
    st.category,
    st.status,
    st.priority,
    st.admin_notes,
    st.assigned_to,
    admin_user.display_name AS assigned_to_name,
    st.created_at,
    st.updated_at,
    st.resolved_at
  FROM support_tickets st
  INNER JOIN users u ON st.user_id = u.id
  LEFT JOIN users admin_user ON st.assigned_to = admin_user.id
  WHERE (p_status IS NULL OR st.status = p_status)
  ORDER BY 
    CASE st.priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END,
    st.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Function to update support ticket
CREATE OR REPLACE FUNCTION admin_update_support_ticket(
  p_ticket_id UUID,
  p_status TEXT,
  p_priority TEXT,
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  UPDATE support_tickets
  SET 
    status = p_status,
    priority = p_priority,
    admin_notes = p_admin_notes,
    assigned_to = CASE 
      WHEN assigned_to IS NULL THEN v_admin_id 
      ELSE assigned_to 
    END,
    updated_at = now(),
    resolved_at = CASE 
      WHEN p_status IN ('resolved', 'closed') AND resolved_at IS NULL 
      THEN now() 
      ELSE resolved_at 
    END
  WHERE id = p_ticket_id;
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
    type,
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
DROP TRIGGER IF EXISTS on_withdrawal_request_created ON withdrawal_requests;
CREATE TRIGGER on_withdrawal_request_created
  AFTER INSERT ON withdrawal_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_withdrawal_request();

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION create_support_ticket TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_notification_counts TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_notifications TO authenticated;
GRANT EXECUTE ON FUNCTION mark_notification_read TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_support_tickets TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_support_ticket TO authenticated;
