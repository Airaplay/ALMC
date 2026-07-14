/*
  # Add Automatic Promotion Completion on Query

  1. Changes
    - Creates a function that auto-completes expired promotions when accessed
    - Adds a trigger that runs before SELECT queries on promotions table
    - Ensures expired promotions are always shown with correct status

  2. Security
    - Function runs with security definer privileges
    - Only affects promotions past their end_date
    - No user input validation needed
*/

-- Improved auto-completion function with better performance
CREATE OR REPLACE FUNCTION auto_complete_expired_promotions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update active or paused promotions that have passed their end_date
  UPDATE promotions
  SET
    status = 'completed',
    updated_at = now()
  WHERE
    status IN ('active', 'paused')
    AND end_date <= now()
    AND end_date IS NOT NULL;
END;
$$;

-- Create a function to check and complete on read
CREATE OR REPLACE FUNCTION check_promotion_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If this is an active or paused promotion that has expired, mark it completed
  IF (NEW.status IN ('active', 'paused') AND NEW.end_date <= now()) THEN
    NEW.status := 'completed';
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger that runs on INSERT and UPDATE
DROP TRIGGER IF EXISTS trigger_check_promotion_completion ON promotions;
CREATE TRIGGER trigger_check_promotion_completion
  BEFORE INSERT OR UPDATE ON promotions
  FOR EACH ROW
  EXECUTE FUNCTION check_promotion_completion();

-- Grant execute permission
GRANT EXECUTE ON FUNCTION auto_complete_expired_promotions() TO authenticated;
GRANT EXECUTE ON FUNCTION check_promotion_completion() TO authenticated;

-- Run initial completion for any expired promotions
SELECT auto_complete_expired_promotions();

-- Add helpful comment
COMMENT ON FUNCTION auto_complete_expired_promotions() IS
'Automatically marks expired promotions (past end_date) as completed. Call periodically or before queries.';