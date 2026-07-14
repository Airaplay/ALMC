/*
  # Fix ad_units table - Add missing columns
  
  1. Changes
    - Add `ecpm_floor` column to ad_units (numeric, default 0)
    - Add `auto_cpm_bidding` column to ad_units (boolean, default false)
  
  2. Notes
    - These columns are referenced by the adPlacementService.ts but were missing from the schema
    - This was causing the app to fail loading with "column ad_units_1.ecpm_floor does not exist" error
*/

-- Add missing columns to ad_units table
DO $$
BEGIN
  -- Add ecpm_floor column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_units' AND column_name = 'ecpm_floor'
  ) THEN
    ALTER TABLE ad_units ADD COLUMN ecpm_floor numeric DEFAULT 0 CHECK (ecpm_floor >= 0);
  END IF;

  -- Add auto_cpm_bidding column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_units' AND column_name = 'auto_cpm_bidding'
  ) THEN
    ALTER TABLE ad_units ADD COLUMN auto_cpm_bidding boolean DEFAULT false;
  END IF;
END $$;