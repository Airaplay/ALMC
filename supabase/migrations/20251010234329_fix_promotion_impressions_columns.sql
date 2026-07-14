/*
  # Fix promotion_impressions Table Columns
  
  ## Overview
  This migration ensures all required columns exist in the promotion_impressions table.
  Some columns may have been missing due to migration order issues.
  
  ## Changes
    1. Add impression_time column if missing
    2. Add device_fingerprint column if missing
    3. Create necessary indexes
  
  ## Security
    - No RLS changes needed
*/

-- Add impression_time column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'promotion_impressions' AND column_name = 'impression_time'
  ) THEN
    ALTER TABLE promotion_impressions ADD COLUMN impression_time timestamptz DEFAULT now();
  END IF;
END $$;

-- Add device_fingerprint column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'promotion_impressions' AND column_name = 'device_fingerprint'
  ) THEN
    ALTER TABLE promotion_impressions ADD COLUMN device_fingerprint text;
  END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_promotion_impressions_time ON promotion_impressions(impression_time);
CREATE INDEX IF NOT EXISTS idx_promotion_impressions_device ON promotion_impressions(device_fingerprint);