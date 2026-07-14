/*
  # Add is_popular and is_best_value columns to treat_packages table

  1. Changes
    - Add `is_popular` boolean column to mark popular packages
    - Add `is_best_value` boolean column to mark best value packages
    - Set default value of false for both columns
  
  2. Notes
    - These columns are used in the PurchaseTreatsModal to display badges
    - Only one package should be marked as popular and one as best value
*/

-- Add is_popular column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treat_packages' AND column_name = 'is_popular'
  ) THEN
    ALTER TABLE treat_packages ADD COLUMN is_popular boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Add is_best_value column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treat_packages' AND column_name = 'is_best_value'
  ) THEN
    ALTER TABLE treat_packages ADD COLUMN is_best_value boolean NOT NULL DEFAULT false;
  END IF;
END $$;