/*
  # Create Delete Message Function
  
  Creates a function to soft-delete messages (mark as deleted).
  
  ## Changes
  1. Create delete_message function
     - Takes message_id as parameter
     - Marks message as deleted (is_deleted = true)
     - Changes message_text to 'Message deleted'
     - Only allows deleting your own messages
     - Returns void on success
  
  ## Security
  - SECURITY DEFINER for proper auth context
  - Only message sender can delete their message
  - Uses RLS policies for additional security
*/

-- Create function to delete a message (soft delete)
CREATE OR REPLACE FUNCTION public.delete_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sender_id uuid;
  v_message_sender_id uuid;
BEGIN
  -- Get current user
  v_sender_id := auth.uid();
  
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Get message sender to verify ownership
  SELECT sender_id INTO v_message_sender_id
  FROM messages
  WHERE id = p_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  -- Only allow deleting your own messages
  IF v_message_sender_id != v_sender_id THEN
    RAISE EXCEPTION 'You can only delete your own messages';
  END IF;

  -- Soft delete: mark as deleted and change text
  UPDATE messages
  SET 
    is_deleted = true,
    message_text = 'Message deleted',
    updated_at = now()
  WHERE id = p_message_id;

END;
$function$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.delete_message(uuid) TO authenticated;
