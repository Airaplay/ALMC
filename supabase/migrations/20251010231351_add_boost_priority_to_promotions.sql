/*
  # Add Boost Priority Column to Promotions
  
  ## Overview
  Adds a boost_priority column to the promotions table to support manual
  reordering and boosting of promotions by admins.
  
  ## 1. Changes
    - Add boost_priority column (numeric, default 0)
    - Create index for boost_priority for performance
  
  ## 2. Usage
    - Higher priority values = higher visibility
    - Default priority is 0
    - Admins can increment/decrement priority to reorder
    - Boost function adds +10 to current priority
*/

-- Add boost_priority column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'promotions' AND column_name = 'boost_priority'
  ) THEN
    ALTER TABLE promotions ADD COLUMN boost_priority numeric DEFAULT 0;
  END IF;
END $$;

-- Create index for boost_priority for better performance
CREATE INDEX IF NOT EXISTS idx_promotions_boost_priority 
  ON promotions(boost_priority DESC);

-- Create composite index for status and boost_priority
CREATE INDEX IF NOT EXISTS idx_promotions_status_boost_priority 
  ON promotions(status, boost_priority DESC);