/*
  # Add display_order column to treat_packages table

  1. Changes
    - Add `display_order` column to `treat_packages` table
    - Set default value of 0 for existing records
    - Update existing records with incremental display order
  
  2. Notes
    - This allows admin to control the order packages appear in the UI
    - The column is used in the TreatPackageTab fetch query
*/

-- Add display_order column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treat_packages' AND column_name = 'display_order'
  ) THEN
    ALTER TABLE treat_packages ADD COLUMN display_order integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_treat_packages_display_order ON treat_packages(display_order);

-- Update existing records with incremental display order based on treats amount
UPDATE treat_packages 
SET display_order = row_number
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY treats ASC) as row_number
  FROM treat_packages
) AS numbered
WHERE treat_packages.id = numbered.id;