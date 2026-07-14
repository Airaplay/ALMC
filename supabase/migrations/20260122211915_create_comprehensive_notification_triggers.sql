/*
  # Comprehensive Notification Triggers System

  ## Overview
  Creates automatic notification triggers for important user actions and events:
  - Treat wallet transactions (purchase, receive, send, withdraw)
  - Song added to playlists (notify artist/creator)
  - Withdrawal requests (creation and approval)
  - Promotion activation

  ## Changes

  1. Trigger Functions
     - notify_treat_purchase: Notifies user when they purchase Treats
     - notify_treat_received: Notifies user when they receive Treats (tips, earnings)
     - notify_treat_sent: Notifies user when they send Treats (tips)
     - notify_treat_withdrawal: Notifies user when they withdraw Treats
     - notify_song_added_to_playlist: Notifies artist when their song is added to a playlist
     - notify_withdrawal_request: Notifies user when they request a withdrawal
     - notify_withdrawal_approved: Notifies user when their withdrawal is approved
     - notify_promotion_active: Notifies user when their promotion becomes active

  2. Triggers
     - Triggers on treat_transactions table for all transaction types
     - Trigger on playlist_songs table for song additions
     - Triggers on withdrawal_requests table for requests and approvals
     - Trigger on promotions table for status changes to 'active'

  ## Security
  - All functions run with SECURITY DEFINER to bypass RLS for notification creation
  - Functions only create notifications for the relevant user
  - No sensitive data exposed in notification messages

  ## Notes
  - Notifications are created automatically and don't require manual intervention
  - Users will see these notifications in their notifications screen
  - All notifications include relevant metadata for linking back to the action
*/

-- =====================================================
-- TREAT TRANSACTION NOTIFICATION FUNCTIONS
-- =====================================================

-- Function to notify user when they purchase Treats
CREATE OR REPLACE FUNCTION notify_treat_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only notify for purchase transactions
  IF NEW.transaction_type = 'purchase' AND NEW.amount > 0 THEN
    INSERT INTO notifications (user_id, type, message, metadata)
    VALUES (
      NEW.user_id,
      'system',
      'You successfully purchased ' || NEW.amount || ' Treats! Your new balance is ' || COALESCE(NEW.balance_after, 0) || ' Treats.',
      jsonb_build_object(
        'transaction_id', NEW.id,
        'transaction_type', NEW.transaction_type,
        'amount', NEW.amount,
        'balance_after', NEW.balance_after,
        'timestamp', NEW.created_at
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Function to notify user when they receive Treats
CREATE OR REPLACE FUNCTION notify_treat_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_name text;
  notification_message text;
BEGIN
  -- Only notify for tip_received, earned, reward, and other positive incoming transactions
  IF NEW.transaction_type IN ('tip_received', 'earned', 'reward', 'referral_bonus', 'daily_checkin') 
     AND NEW.amount > 0 THEN
    
    -- Try to get sender name if it's a tip
    IF NEW.transaction_type = 'tip_received' AND NEW.metadata ? 'sender_id' THEN
      SELECT display_name INTO sender_name
      FROM users
      WHERE id = (NEW.metadata->>'sender_id')::uuid;
      
      notification_message := 'You received ' || NEW.amount || ' Treats from ' || COALESCE(sender_name, 'someone') || '!';
    ELSIF NEW.transaction_type = 'daily_checkin' THEN
      notification_message := 'Daily check-in reward! You earned ' || NEW.amount || ' Treats.';
    ELSIF NEW.transaction_type = 'reward' THEN
      notification_message := 'Congratulations! You earned ' || NEW.amount || ' Treats as a reward.';
    ELSIF NEW.transaction_type = 'referral_bonus' THEN
      notification_message := 'Referral bonus! You earned ' || NEW.amount || ' Treats.';
    ELSE
      notification_message := 'You earned ' || NEW.amount || ' Treats! Your new balance is ' || COALESCE(NEW.balance_after, 0) || ' Treats.';
    END IF;
    
    INSERT INTO notifications (user_id, type, message, metadata)
    VALUES (
      NEW.user_id,
      'tip',
      notification_message,
      jsonb_build_object(
        'transaction_id', NEW.id,
        'transaction_type', NEW.transaction_type,
        'amount', NEW.amount,
        'balance_after', NEW.balance_after,
        'sender_id', NEW.metadata->>'sender_id',
        'timestamp', NEW.created_at
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Function to notify user when they send Treats
CREATE OR REPLACE FUNCTION notify_treat_sent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient_name text;
  notification_message text;
BEGIN
  -- Only notify for tip_sent transactions
  IF NEW.transaction_type = 'tip_sent' AND NEW.amount < 0 THEN
    
    -- Try to get recipient name
    IF NEW.metadata ? 'recipient_id' THEN
      SELECT display_name INTO recipient_name
      FROM users
      WHERE id = (NEW.metadata->>'recipient_id')::uuid;
      
      notification_message := 'You sent ' || ABS(NEW.amount) || ' Treats to ' || COALESCE(recipient_name, 'someone') || '.';
    ELSE
      notification_message := 'You sent ' || ABS(NEW.amount) || ' Treats. Your new balance is ' || COALESCE(NEW.balance_after, 0) || ' Treats.';
    END IF;
    
    INSERT INTO notifications (user_id, type, message, metadata)
    VALUES (
      NEW.user_id,
      'tip',
      notification_message,
      jsonb_build_object(
        'transaction_id', NEW.id,
        'transaction_type', NEW.transaction_type,
        'amount', ABS(NEW.amount),
        'balance_after', NEW.balance_after,
        'recipient_id', NEW.metadata->>'recipient_id',
        'timestamp', NEW.created_at
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Function to notify user when they withdraw Treats
CREATE OR REPLACE FUNCTION notify_treat_withdrawal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only notify for withdrawal transactions
  IF NEW.transaction_type IN ('withdrawal', 'treat_withdrawal') AND NEW.amount < 0 THEN
    INSERT INTO notifications (user_id, type, message, metadata)
    VALUES (
      NEW.user_id,
      'withdrawal',
      'You withdrew ' || ABS(NEW.amount) || ' Treats from your wallet. Your new balance is ' || COALESCE(NEW.balance_after, 0) || ' Treats.',
      jsonb_build_object(
        'transaction_id', NEW.id,
        'transaction_type', NEW.transaction_type,
        'amount', ABS(NEW.amount),
        'balance_after', NEW.balance_after,
        'timestamp', NEW.created_at
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- =====================================================
-- PLAYLIST NOTIFICATION FUNCTION
-- =====================================================

-- Function to notify artist when their song is added to a playlist
CREATE OR REPLACE FUNCTION notify_song_added_to_playlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  song_title text;
  song_artist_id uuid;
  playlist_name text;
  playlist_owner_name text;
  playlist_owner_id uuid;
BEGIN
  -- Get song information
  SELECT title, artist_id INTO song_title, song_artist_id
  FROM songs
  WHERE id = NEW.song_id;
  
  -- Get playlist information
  SELECT name, user_id INTO playlist_name, playlist_owner_id
  FROM playlists
  WHERE id = NEW.playlist_id;
  
  -- Get playlist owner name
  SELECT display_name INTO playlist_owner_name
  FROM users
  WHERE id = playlist_owner_id;
  
  -- Only notify if the song artist is not the playlist owner (don't notify when adding own songs)
  IF song_artist_id IS NOT NULL AND song_artist_id != playlist_owner_id THEN
    INSERT INTO notifications (user_id, type, message, metadata)
    VALUES (
      song_artist_id,
      'system',
      'Your song "' || COALESCE(song_title, 'Untitled') || '" was added to the playlist "' || 
      COALESCE(playlist_name, 'Untitled Playlist') || '" by ' || COALESCE(playlist_owner_name, 'someone') || '.',
      jsonb_build_object(
        'song_id', NEW.song_id,
        'playlist_id', NEW.playlist_id,
        'song_title', song_title,
        'playlist_name', playlist_name,
        'added_by', playlist_owner_id,
        'added_by_name', playlist_owner_name,
        'timestamp', NEW.added_at
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- =====================================================
-- WITHDRAWAL NOTIFICATION FUNCTIONS
-- =====================================================

-- Function to notify user when they request a withdrawal
CREATE OR REPLACE FUNCTION notify_withdrawal_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only notify on new withdrawal requests
  IF TG_OP = 'INSERT' THEN
    INSERT INTO notifications (user_id, type, message, metadata)
    VALUES (
      NEW.user_id,
      'withdrawal',
      'Your withdrawal request for $' || NEW.amount || ' has been submitted and is pending review. You will be notified once it has been processed.',
      jsonb_build_object(
        'withdrawal_id', NEW.id,
        'amount', NEW.amount,
        'status', NEW.status,
        'timestamp', NEW.request_date
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Function to notify user when their withdrawal is approved
CREATE OR REPLACE FUNCTION notify_withdrawal_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only notify when status changes to 'approved' or 'completed'
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status IN ('approved', 'completed') THEN
    INSERT INTO notifications (user_id, type, message, metadata)
    VALUES (
      NEW.user_id,
      'withdrawal',
      'Great news! Your withdrawal request for $' || NEW.amount || ' has been approved and is being processed. The funds will be sent to your account shortly.',
      jsonb_build_object(
        'withdrawal_id', NEW.id,
        'amount', NEW.amount,
        'status', NEW.status,
        'processed_date', NEW.processed_date,
        'timestamp', now()
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- =====================================================
-- PROMOTION NOTIFICATION FUNCTION
-- =====================================================

-- Function to notify user when their promotion becomes active
CREATE OR REPLACE FUNCTION notify_promotion_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  promotion_type_label text;
BEGIN
  -- Only notify when status changes to 'active'
  IF TG_OP = 'UPDATE' AND OLD.status != 'active' AND NEW.status = 'active' THEN
    
    -- Get friendly label for promotion type
    promotion_type_label := CASE NEW.promotion_type
      WHEN 'song' THEN 'song'
      WHEN 'video' THEN 'video'
      WHEN 'profile' THEN 'profile'
      WHEN 'playlist' THEN 'playlist'
      ELSE NEW.promotion_type
    END;
    
    INSERT INTO notifications (user_id, type, message, metadata)
    VALUES (
      NEW.user_id,
      'promotion',
      'Your ' || promotion_type_label || ' promotion "' || NEW.target_title || '" is now active! It will run for ' || 
      NEW.duration_days || ' day' || (CASE WHEN NEW.duration_days > 1 THEN 's' ELSE '' END) || '.',
      jsonb_build_object(
        'promotion_id', NEW.id,
        'promotion_type', NEW.promotion_type,
        'target_id', NEW.target_id,
        'target_title', NEW.target_title,
        'duration_days', NEW.duration_days,
        'start_date', NEW.start_date,
        'end_date', NEW.end_date,
        'timestamp', now()
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- =====================================================
-- CREATE TRIGGERS
-- =====================================================

-- Treat Transaction Triggers
DROP TRIGGER IF EXISTS trigger_notify_treat_purchase ON treat_transactions;
CREATE TRIGGER trigger_notify_treat_purchase
  AFTER INSERT ON treat_transactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_treat_purchase();

DROP TRIGGER IF EXISTS trigger_notify_treat_received ON treat_transactions;
CREATE TRIGGER trigger_notify_treat_received
  AFTER INSERT ON treat_transactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_treat_received();

DROP TRIGGER IF EXISTS trigger_notify_treat_sent ON treat_transactions;
CREATE TRIGGER trigger_notify_treat_sent
  AFTER INSERT ON treat_transactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_treat_sent();

DROP TRIGGER IF EXISTS trigger_notify_treat_withdrawal ON treat_transactions;
CREATE TRIGGER trigger_notify_treat_withdrawal
  AFTER INSERT ON treat_transactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_treat_withdrawal();

-- Playlist Song Addition Trigger
DROP TRIGGER IF EXISTS trigger_notify_song_added_to_playlist ON playlist_songs;
CREATE TRIGGER trigger_notify_song_added_to_playlist
  AFTER INSERT ON playlist_songs
  FOR EACH ROW
  EXECUTE FUNCTION notify_song_added_to_playlist();

-- Withdrawal Request Triggers
DROP TRIGGER IF EXISTS trigger_notify_withdrawal_request ON withdrawal_requests;
CREATE TRIGGER trigger_notify_withdrawal_request
  AFTER INSERT ON withdrawal_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_withdrawal_request();

DROP TRIGGER IF EXISTS trigger_notify_withdrawal_approved ON withdrawal_requests;
CREATE TRIGGER trigger_notify_withdrawal_approved
  AFTER UPDATE ON withdrawal_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_withdrawal_approved();

-- Promotion Activation Trigger
DROP TRIGGER IF EXISTS trigger_notify_promotion_active ON promotions;
CREATE TRIGGER trigger_notify_promotion_active
  AFTER UPDATE ON promotions
  FOR EACH ROW
  EXECUTE FUNCTION notify_promotion_active();

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

-- Grant execute permissions on functions (though they're SECURITY DEFINER, this is good practice)
GRANT EXECUTE ON FUNCTION notify_treat_purchase TO authenticated;
GRANT EXECUTE ON FUNCTION notify_treat_received TO authenticated;
GRANT EXECUTE ON FUNCTION notify_treat_sent TO authenticated;
GRANT EXECUTE ON FUNCTION notify_treat_withdrawal TO authenticated;
GRANT EXECUTE ON FUNCTION notify_song_added_to_playlist TO authenticated;
GRANT EXECUTE ON FUNCTION notify_withdrawal_request TO authenticated;
GRANT EXECUTE ON FUNCTION notify_withdrawal_approved TO authenticated;
GRANT EXECUTE ON FUNCTION notify_promotion_active TO authenticated;