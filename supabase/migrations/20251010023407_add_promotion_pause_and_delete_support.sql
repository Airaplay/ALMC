/*
  # Add Pause and Delete Support for Promotions

  1. Changes
    - Add 'paused' status to promotions status constraint
    - Add 'deleted' status for soft deletion
    - Update status check constraint
    - Add helper function for calculating refunds based on promotion status

  2. Status Flow
    - pending_approval: Waiting for admin approval (can delete with full refund)
    - pending: Admin approved, waiting for start date (can delete with full refund)
    - active: Currently running (can pause or delete with no refund)
    - paused: Temporarily paused (can resume or delete with no refund)
    - completed: Finished successfully (cannot delete or modify)
    - cancelled: Cancelled by user or admin
    - deleted: Soft deleted (hidden from user view)
    - rejected: Rejected by admin

  3. Refund Logic
    - pending_approval or pending: Full refund (100%)
    - active or paused: No refund (0%)
    - completed, cancelled, rejected, deleted: No refund (0%)
*/

-- Update promotion status check constraint
DO $$
BEGIN
  -- Drop old constraint if exists
  ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_status_check;
  
  -- Add new constraint with paused and deleted statuses
  ALTER TABLE promotions ADD CONSTRAINT promotions_status_check 
    CHECK (status IN ('pending_approval', 'pending', 'active', 'paused', 'completed', 'cancelled', 'rejected', 'deleted'));
END $$;

-- Function to calculate refund amount for promotion deletion
CREATE OR REPLACE FUNCTION calculate_promotion_refund(
  p_promotion_id uuid
)
RETURNS numeric AS $$
DECLARE
  v_promotion_status text;
  v_treats_cost numeric;
  v_refund_amount numeric;
BEGIN
  -- Get promotion details
  SELECT status, treats_cost
  INTO v_promotion_status, v_treats_cost
  FROM promotions
  WHERE id = p_promotion_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promotion not found';
  END IF;
  
  -- Calculate refund based on status
  CASE v_promotion_status
    -- Full refund for pending promotions
    WHEN 'pending_approval', 'pending' THEN
      v_refund_amount := v_treats_cost;
    -- No refund for active, paused, or completed promotions
    WHEN 'active', 'paused', 'completed', 'cancelled', 'rejected', 'deleted' THEN
      v_refund_amount := 0;
    ELSE
      v_refund_amount := 0;
  END CASE;
  
  RETURN v_refund_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to pause a promotion
CREATE OR REPLACE FUNCTION pause_promotion(
  p_promotion_id uuid,
  p_user_id uuid
)
RETURNS json AS $$
DECLARE
  v_promotion_status text;
  v_promotion_user_id uuid;
BEGIN
  -- Get promotion details
  SELECT status, user_id
  INTO v_promotion_status, v_promotion_user_id
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
  
  -- Check if promotion can be paused (only active promotions)
  IF v_promotion_status != 'active' THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Only active promotions can be paused'
    );
  END IF;
  
  -- Update promotion status to paused
  UPDATE promotions
  SET status = 'paused',
      updated_at = now()
  WHERE id = p_promotion_id;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Promotion paused successfully'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to resume a paused promotion
CREATE OR REPLACE FUNCTION resume_promotion(
  p_promotion_id uuid,
  p_user_id uuid
)
RETURNS json AS $$
DECLARE
  v_promotion_status text;
  v_promotion_user_id uuid;
  v_end_date timestamptz;
BEGIN
  -- Get promotion details
  SELECT status, user_id, end_date
  INTO v_promotion_status, v_promotion_user_id, v_end_date
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
  
  -- Check if promotion can be resumed (only paused promotions)
  IF v_promotion_status != 'paused' THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Only paused promotions can be resumed'
    );
  END IF;
  
  -- Check if promotion has not expired
  IF v_end_date < now() THEN
    -- Mark as completed instead
    UPDATE promotions
    SET status = 'completed',
        updated_at = now()
    WHERE id = p_promotion_id;
    
    RETURN json_build_object(
      'success', false,
      'message', 'Promotion has expired and has been marked as completed'
    );
  END IF;
  
  -- Update promotion status to active
  UPDATE promotions
  SET status = 'active',
      updated_at = now()
  WHERE id = p_promotion_id;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Promotion resumed successfully'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to delete a promotion with refund logic
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
  
  -- Check if promotion can be deleted
  IF v_promotion_status IN ('completed', 'deleted') THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Promotion cannot be deleted'
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
      ELSE 'Promotion deleted (no refund)'
    END,
    'refund_amount', v_refund_amount
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update RLS policy to hide deleted promotions from users
DROP POLICY IF EXISTS "Users can view own promotions" ON promotions;
CREATE POLICY "Users can view own promotions"
  ON promotions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id AND status != 'deleted');