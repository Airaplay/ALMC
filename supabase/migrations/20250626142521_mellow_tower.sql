/*
  # Add video_url to songs table

  1. Changes
    - Add `video_url` column to `songs` table to support music videos
    - This allows songs to have both audio and video content
    - Column is nullable as not all songs will have videos

  2. Security
    - No changes to existing RLS policies
    - New column inherits existing security model
*/

-- Add video_url column to songs table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'songs' AND column_name = 'video_url'
  ) THEN
    ALTER TABLE songs 
    ADD COLUMN video_url text;
  END IF;
END $$;

-- Create index for video content queries
CREATE INDEX IF NOT EXISTS idx_songs_video_url 
ON songs(video_url) WHERE video_url IS NOT NULL;