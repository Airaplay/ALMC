/*
  # Add country change tracking to users table

  1. Changes
    - Add `country_last_changed_at` timestamp column to users table
    - Initialize existing records to use created_at as the baseline
    - Create trigger to automatically update timestamp when country changes
  
  2. Purpose
    - Enable 14-day restriction on country changes
    - Track when users last changed their country
    - Provide audit trail for country modifications
*/

-- Add country_last_changed_at column
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS country_last_changed_at timestamptz;

-- Initialize existing records with created_at value
UPDATE users 
SET country_last_changed_at = created_at 
WHERE country_last_changed_at IS NULL AND country IS NOT NULL;

-- Create function to update country_last_changed_at when country changes
CREATE OR REPLACE FUNCTION update_country_last_changed_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update timestamp if country actually changed
  IF OLD.country IS DISTINCT FROM NEW.country THEN
    NEW.country_last_changed_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for country changes
DROP TRIGGER IF EXISTS trigger_update_country_last_changed_at ON users;
CREATE TRIGGER trigger_update_country_last_changed_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_country_last_changed_at();