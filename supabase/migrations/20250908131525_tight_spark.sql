/*
  # Add background_image_url column to users table

  1. Schema Changes
    - Add `background_image_url` column to `users` table
    - Column is optional (nullable) and stores the URL of user's background image

  2. Security
    - No additional RLS policies needed as existing user policies cover this column
*/

-- Add background_image_url column to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'background_image_url'
  ) THEN
    ALTER TABLE users ADD COLUMN background_image_url text;
  END IF;
END $$;

-- Add index for background_image_url for better query performance
CREATE INDEX IF NOT EXISTS idx_users_background_image_url 
ON users (background_image_url) 
WHERE background_image_url IS NOT NULL;