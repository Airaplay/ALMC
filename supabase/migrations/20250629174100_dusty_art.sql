/*
  # Add mix content type to content_uploads table

  1. Changes
    - Update content_uploads_content_type_check constraint to include 'mix' content type
    - This allows admins to create and manage mixes for the "Mix for you" section

  2. Security
    - No changes to existing RLS policies
    - Admins can manage mix content through existing policies
*/

-- Update the content_type check constraint to include 'mix'
ALTER TABLE content_uploads 
DROP CONSTRAINT IF EXISTS content_uploads_content_type_check;

ALTER TABLE content_uploads 
ADD CONSTRAINT content_uploads_content_type_check 
CHECK (content_type IN ('short_clip', 'single', 'album', 'mix', 'video'));