/*
  # Allow Deletion of Completed and Pending Promotions

  1. Changes
    - Update delete_promotion function to allow deletion of completed promotions
    - Only prevent deletion of promotions that are already marked as 'deleted'
    - Completed promotions can be deleted (no refund) for record cleanup

  2. Status Deletion Rules
    - pending_approval: Can delete (full refund)
    - pending: Can delete (full refund)
    - active: Can delete (no refund)
    - paused: Can delete (no refund)
    - completed: Can delete (no refund)
    - cancelled: Can delete (no refund)
    - rejected: Can delete (no refund)
    - deleted: Cannot delete (already deleted)

  3. Security
    - Users can only delete their own promotions
    - Maintains refund logic based on status
*/

-- Update delete_promotion function to allow deletion of completed promotions
CREATE OR REPLACE FUNCTION delete_promotion(
  p_promotion_id uuid,
  p_user_id uuid
)
RETURNS json AS $$
DECLARE
  v_promotion_status text;
  v_promotion_user_id uuid;
  v_treats_cost numeric;
  v_refund_amount numeric;
  v_user_display_name text;
BEGIN
  -- Get promotion details
  SELECT status, user_id, treats_cost
  INTO v_promotion_status, v_promotion_user_id, v_treats_cost
  FROM promotions
  WHERE id = p_promotion_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Promotion not found'
    );
  END IF;
  
  -- Check if user owns the promotion
  IF v_promotion_user_id != p_user_id THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Unauthorized'
    );
  END IF;
  
  -- Check if promotion is already deleted
  IF v_promotion_status = 'deleted' THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Promotion is already deleted'
    );
  END IF;
  
  -- Calculate refund amount
  v_refund_amount := calculate_promotion_refund(p_promotion_id);
  
  -- Get user display name
  SELECT display_name INTO v_user_display_name
  FROM users
  WHERE id = p_user_id;
  
  -- If refund is due, process it
  IF v_refund_amount > 0 THEN
    -- Add treats back to user's wallet
    PERFORM add_treat_balance(
      p_user_id,
      v_refund_amount,
      'promotion_refund',
      format('Refund for deleted promotion: %s treats', v_refund_amount)
    );
  END IF;
  
  -- Update promotion status to deleted
  UPDATE promotions
  SET status = 'deleted',
      updated_at = now()
  WHERE id = p_promotion_id;
  
  RETURN json_build_object(
    'success', true,
    'message', CASE 
      WHEN v_refund_amount > 0 THEN format('%s treats refunded', v_refund_amount)
      ELSE 'Promotion deleted successfully'
    END,
    'refund_amount', v_refund_amount
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;