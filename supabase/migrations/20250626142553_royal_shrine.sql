/*
  # Add content type constraints and indexes

  1. Constraints
    - Add check constraint for valid content types in content_uploads
    - Ensure data integrity for content classification

  2. Indexes
    - Add indexes for better query performance on content types
    - Optimize filtering and searching by content type

  3. Functions
    - Add helper function to get user's artist ID
    - Simplify queries that need to link user to their artist record
*/

-- Add check constraint for valid content types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'content_uploads_content_type_check'
  ) THEN
    ALTER TABLE content_uploads 
    ADD CONSTRAINT content_uploads_content_type_check 
    CHECK (content_type IN ('short_clip', 'single', 'album', 'mix', 'video'));
  END IF;
END $$;

-- Add index for content type filtering
CREATE INDEX IF NOT EXISTS idx_content_uploads_content_type 
ON content_uploads(content_type);

-- Add index for user content queries
CREATE INDEX IF NOT EXISTS idx_content_uploads_user_content_type 
ON content_uploads(user_id, content_type);

-- Create helper function to get user's artist ID
CREATE OR REPLACE FUNCTION get_user_artist_id(user_uuid uuid DEFAULT auth.uid())
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  artist_uuid uuid;
BEGIN
  SELECT artist_id INTO artist_uuid
  FROM artist_profiles
  WHERE user_id = user_uuid;
  
  RETURN artist_uuid;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_user_artist_id TO authenticated;