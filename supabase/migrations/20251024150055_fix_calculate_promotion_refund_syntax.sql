/*
  # Fix calculate_promotion_refund Function Syntax Error
  
  1. Changes
    - Fix CASE statement syntax in calculate_promotion_refund function
    - Use proper IN clause instead of comma-separated WHEN values
    
  2. Issue
    - The function had invalid syntax: WHEN 'pending_approval', 'pending'
    - This causes runtime errors when trying to delete promotions
    - Correct syntax uses IN operator: WHEN v_promotion_status IN (...)
    
  3. Refund Logic (unchanged)
    - pending_approval, pending, rejected: Full refund (100%)
    - active, paused, completed, cancelled, deleted: No refund (0%)
*/

-- Fix the calculate_promotion_refund function with correct syntax
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
  
  -- Calculate refund based on status using proper IN clause
  IF v_promotion_status IN ('pending_approval', 'pending', 'rejected') THEN
    -- Full refund for pending and rejected promotions
    v_refund_amount := v_treats_cost;
  ELSIF v_promotion_status IN ('active', 'paused', 'completed', 'cancelled', 'deleted') THEN
    -- No refund for active, paused, completed, cancelled, or deleted promotions
    v_refund_amount := 0;
  ELSE
    v_refund_amount := 0;
  END IF;
  
  RETURN v_refund_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
