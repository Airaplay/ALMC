/*
  # Add is_active column to users table

  1. Changes
    - Add `is_active` column to `users` table to track account status
    - Column is boolean with default value of true
    - This allows admins to deactivate/activate user accounts

  2. Security
    - No changes to existing RLS policies
    - New column inherits existing security model
*/

-- Add is_active column to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN is_active boolean DEFAULT true;
  END IF;
END $$;

-- Create index for better performance on is_active queries
CREATE INDEX IF NOT EXISTS idx_users_is_active 
ON users(is_active);

-- Update existing users to have is_active = true by default
UPDATE users 
SET is_active = true 
WHERE is_active IS NULL;