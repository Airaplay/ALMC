/*
  # Add Gender Field to Users Table

  1. Changes
    - Add `gender` column to `users` table
      - Type: text
      - Nullable: true
      - Valid values: 'male', 'female', 'other', 'prefer_not_to_say'
      - Default: null
    
  2. Notes
    - Gender is optional during signup
    - Existing users will have null gender until they update their profile
    - No check constraint to allow flexibility
*/

-- Add gender column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'gender'
  ) THEN
    ALTER TABLE users ADD COLUMN gender text;
  END IF;
END $$;

-- Add a comment to document the field
COMMENT ON COLUMN users.gender IS 'User gender: male, female, other, prefer_not_to_say, or null';
