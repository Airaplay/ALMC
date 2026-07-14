/*
  # Fix notify_withdrawal_request Function

  1. Changes
    - Update function to use currency_code instead of non-existent currency field
    - Add better formatting for the notification message

  2. Security
    - Maintains existing security model
*/

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
    'User ' || NEW.user_id || ' requested withdrawal of ' || 
    NEW.currency_symbol || NEW.amount || ' ' || NEW.currency_code,
    NEW.id,
    'withdrawal_request'
  );

  RETURN NEW;
END;
$$;
