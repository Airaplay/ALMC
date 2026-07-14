/*
  # Add content_upload_id to listening_history and play_count to content_uploads

  1. Changes
    - Make song_id nullable in listening_history
    - Add content_upload_id to listening_history for tracking video/clip plays
    - Add check constraint to ensure either song_id or content_upload_id is provided
    - Add play_count to content_uploads table for tracking video/clip popularity

  2. Security
    - No changes to existing RLS policies
    - New columns inherit existing security model

  3. Functions
    - Add increment_clip_play_count function for tracking video/clip plays
*/

-- Make song_id nullable in listening_history
ALTER TABLE listening_history 
  ALTER COLUMN song_id DROP NOT NULL;

-- Add content_upload_id to listening_history
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listening_history' AND column_name = 'content_upload_id'
  ) THEN
    ALTER TABLE listening_history 
    ADD COLUMN content_upload_id uuid REFERENCES content_uploads(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add check constraint to ensure either song_id or content_upload_id is provided
ALTER TABLE listening_history 
  ADD CONSTRAINT listening_history_content_check 
  CHECK (
    (song_id IS NOT NULL AND content_upload_id IS NULL) OR 
    (song_id IS NULL AND content_upload_id IS NOT NULL)
  );

-- Add play_count to content_uploads
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content_uploads' AND column_name = 'play_count'
  ) THEN
    ALTER TABLE content_uploads 
    ADD COLUMN play_count integer DEFAULT 0;
  END IF;
END $$;

-- Create index for better performance on content_upload_id
CREATE INDEX IF NOT EXISTS idx_listening_history_content_upload_id 
ON listening_history(content_upload_id);

-- Create index for better performance on play_count
CREATE INDEX IF NOT EXISTS idx_content_uploads_play_count 
ON content_uploads(play_count DESC);

-- Function to increment play count for a content upload (video/clip)
CREATE OR REPLACE FUNCTION increment_clip_play_count(content_upload_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update the play count for the content upload
  UPDATE content_uploads
  SET 
    play_count = COALESCE(play_count, 0) + 1,
    updated_at = now()
  WHERE id = content_upload_uuid;
END;
$$;

-- Grant execute permissions to authenticated and anonymous users
GRANT EXECUTE ON FUNCTION increment_clip_play_count TO authenticated;
GRANT EXECUTE ON FUNCTION increment_clip_play_count TO anon;