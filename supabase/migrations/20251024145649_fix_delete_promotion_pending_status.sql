/*
  # Fix Delete Promotion Function for Pending Status
  
  1. Changes
    - Drop old single-parameter delete_promotion function
    - Ensure only the two-parameter version exists (which allows pending deletion)
    
  2. Issue
    - Two versions of delete_promotion exist:
      - Old: delete_promotion(promotion_id uuid) - blocks deletion
      - New: delete_promotion(p_promotion_id uuid, p_user_id uuid) - allows deletion
    - The old version was causing conflicts
    
  3. Security
    - The two-parameter version has proper ownership checks
    - Maintains refund logic based on status
*/

-- Drop the old single-parameter version
DROP FUNCTION IF EXISTS delete_promotion(uuid);

-- Verify the correct two-parameter version exists
-- (It should already exist from previous migration 20251024121804)
