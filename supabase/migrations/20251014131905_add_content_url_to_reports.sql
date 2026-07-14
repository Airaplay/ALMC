/*
  # Add content_url Field to Reports Table

  1. Changes
    - Add `content_url` column to `reports` table to store the URL of reported content
    - This enables admins to directly access reported content from the report details
    
  2. Security
    - No changes to RLS policies
    - Maintains existing access controls
    
  3. Notes
    - The content_url field will store the direct link to view the reported content
    - Nullable field as not all report types may have URLs
    - Can be populated when a report is created or updated by the system
*/

-- Add content_url column to reports table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'reports' 
    AND column_name = 'content_url'
  ) THEN
    ALTER TABLE reports
      ADD COLUMN content_url TEXT;
  END IF;
END $$;
