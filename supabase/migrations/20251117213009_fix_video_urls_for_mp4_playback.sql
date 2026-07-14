/*
  # Fix Video URLs for MP4 Playback

  1. Changes
    - Update existing video URLs from HLS playlist format to MP4 format
    - This improves browser compatibility and ensures videos play correctly
    - Converts playlist.m3u8 URLs to play_720p.mp4 URLs for better mobile support

  2. Security
    - No changes to RLS policies
    - Updates only affect URL format in metadata JSONB field

  3. Background
    - HLS (HTTP Live Streaming) playlist.m3u8 files require special player support
    - Most mobile browsers don't natively support HLS without additional libraries
    - MP4 files have universal browser support and play immediately
    - This migration fixes existing uploads to use the MP4 format
*/

-- Update video_url in metadata from playlist.m3u8 to play_720p.mp4
UPDATE content_uploads
SET metadata = jsonb_set(
  metadata,
  '{video_url}',
  to_jsonb(replace(metadata->>'video_url', '/playlist.m3u8', '/play_720p.mp4'))
)
WHERE content_type IN ('video', 'short_clip')
  AND metadata->>'video_url' LIKE '%/playlist.m3u8';

-- Log the number of updated records
DO $$
DECLARE
  updated_count integer;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM content_uploads
  WHERE content_type IN ('video', 'short_clip')
    AND metadata->>'video_url' LIKE '%/play_720p.mp4';
  
  RAISE NOTICE 'Updated % video records to use MP4 format', updated_count;
END $$;
