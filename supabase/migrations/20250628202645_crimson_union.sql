/*
  # Auto-approve content uploads

  1. Changes
    - Change default value of `status` column in `content_uploads` table from 'pending' to 'approved'
    - This ensures all new content uploads are automatically approved and visible immediately
    - Existing records remain unchanged

  2. Real-time Updates
    - New uploads will be immediately available in the database with 'approved' status
    - No manual approval process required
    - Content appears instantly in user interfaces
*/

-- Change the default value of status column to 'approved'
ALTER TABLE content_uploads 
ALTER COLUMN status SET DEFAULT 'approved';

-- Update any existing pending uploads to approved (optional - uncomment if you want to approve all existing pending content)
-- UPDATE content_uploads 
-- SET status = 'approved' 
-- WHERE status = 'pending';