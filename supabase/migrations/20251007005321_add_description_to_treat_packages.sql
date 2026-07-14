/*
  # Add description column to treat_packages table

  ## Changes
    - Add `description` text column to `treat_packages` table
    - Column is nullable to allow existing packages without descriptions
    - This enables admins to provide additional information about packages

  ## Purpose
    Allows admins to add descriptive text to treat packages, helping users
    understand what each package offers and make better purchasing decisions.
*/

-- Add description column to treat_packages table
ALTER TABLE treat_packages 
ADD COLUMN IF NOT EXISTS description text;