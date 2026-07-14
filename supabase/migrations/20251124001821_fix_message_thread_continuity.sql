/*
  # Fix Message Thread Continuity Issue
  
  ## Problem
  When a user deletes a conversation and later messages the same person:
  - The thread's deleted_at flag only clears for the receiver
  - The sender's deleted_at flag remains set
  - get_user_threads filters it out, making it invisible to the sender
  - Result: Messages appear in separate conversations or get lost
  
  ## Solution
  Update send_message and reply_to_message functions to clear deleted_at for BOTH users
  when a new message is sent, ensuring thread continuity.
  
  ## Changes
  1. Fix send_message to clear both user1_deleted_at and user2_deleted_at
  2. Fix reply_to_message to clear both user1_deleted_at and user2_deleted_at
*/

-- Fix send_message function to restore deleted threads for both users
CREATE OR REPLACE FUNCTION public.send_message(p_receiver_id uuid, p_message_text text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_thread_id uuid;
  v_message_id uuid;
  v_sender_id uuid;
BEGIN
  -- Get current user
  v_sender_id := auth.uid();
  
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  IF v_sender_id = p_receiver_id THEN
    RAISE EXCEPTION 'Cannot send message to yourself';
  END IF;

  -- Get or create thread
  v_thread_id := get_or_create_thread(v_sender_id, p_receiver_id);

  -- Insert message
  INSERT INTO messages (thread_id, sender_id, receiver_id, message_text)
  VALUES (v_thread_id, v_sender_id, p_receiver_id, p_message_text)
  RETURNING id INTO v_message_id;

  -- Update thread and restore for BOTH users (clear both deleted_at flags)
  UPDATE message_threads
  SET 
    last_message_at = now(),
    last_message_id = v_message_id,
    last_message_preview = LEFT(p_message_text, 100),
    user1_unread_count = CASE 
      WHEN user1_id = p_receiver_id THEN user1_unread_count + 1
      ELSE user1_unread_count
    END,
    user2_unread_count = CASE 
      WHEN user2_id = p_receiver_id THEN user2_unread_count + 1
      ELSE user2_unread_count
    END,
    -- Clear deleted_at for BOTH users when any new message is sent
    user1_deleted_at = NULL,
    user2_deleted_at = NULL,
    updated_at = now()
  WHERE id = v_thread_id;

  -- Create notification
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    message_id,
    thread_id,
    sender_id,
    is_read
  )
  VALUES (
    p_receiver_id,
    'message',
    'New Message',
    LEFT(p_message_text, 100),
    v_message_id,
    v_thread_id,
    v_sender_id,
    false
  );

  RETURN v_message_id;
END;
$function$;

-- Fix reply_to_message function to restore deleted threads for both users
CREATE OR REPLACE FUNCTION public.reply_to_message(p_thread_id uuid, p_message_text text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_message_id uuid;
  v_sender_id uuid;
  v_receiver_id uuid;
  v_thread_record message_threads%ROWTYPE;
BEGIN
  -- Get current user
  v_sender_id := auth.uid();
  
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Get thread info
  SELECT * INTO v_thread_record
  FROM message_threads
  WHERE id = p_thread_id
    AND (user1_id = v_sender_id OR user2_id = v_sender_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thread not found or access denied';
  END IF;

  -- Determine receiver
  IF v_thread_record.user1_id = v_sender_id THEN
    v_receiver_id := v_thread_record.user2_id;
  ELSE
    v_receiver_id := v_thread_record.user1_id;
  END IF;

  -- Insert reply message
  INSERT INTO messages (thread_id, sender_id, receiver_id, message_text)
  VALUES (p_thread_id, v_sender_id, v_receiver_id, p_message_text)
  RETURNING id INTO v_message_id;

  -- Update thread and restore for BOTH users (clear both deleted_at flags)
  UPDATE message_threads
  SET 
    last_message_at = now(),
    last_message_id = v_message_id,
    last_message_preview = LEFT(p_message_text, 100),
    user1_unread_count = CASE 
      WHEN user1_id = v_receiver_id THEN user1_unread_count + 1
      ELSE user1_unread_count
    END,
    user2_unread_count = CASE 
      WHEN user2_id = v_receiver_id THEN user2_unread_count + 1
      ELSE user2_unread_count
    END,
    -- Clear deleted_at for BOTH users when any new message is sent
    user1_deleted_at = NULL,
    user2_deleted_at = NULL,
    updated_at = now()
  WHERE id = p_thread_id;

  -- Create notification
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    message_id,
    thread_id,
    sender_id,
    is_read
  )
  VALUES (
    v_receiver_id,
    'reply',
    'New Reply',
    LEFT(p_message_text, 100),
    v_message_id,
    p_thread_id,
    v_sender_id,
    false
  );

  RETURN v_message_id;
END;
$function$;
