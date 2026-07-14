/*
  # Restore HLS Playlist URLs for Video Playback

  1. Changes
    - Revert video URLs from MP4 format back to HLS playlist format
    - This enables immediate video playback after upload
    - HLS playlists are available immediately while MP4 renditions take time to process
    - Converts play_720p.mp4 URLs back to playlist.m3u8 URLs
    - Converts play_480p.mp4, play_360p.mp4, play_1080p.mp4 URLs back to playlist.m3u8

  2. Security
    - No changes to RLS policies
    - Updates only affect URL format in metadata JSONB field

  3. Background
    - Bunny Stream generates HLS playlists immediately upon upload
    - MP4 renditions take several minutes to encode after upload
    - HLS provides adaptive bitrate streaming for better user experience
    - This migration fixes existing uploads to use HLS for immediate playback
    - The app now uses hls.js library for universal HLS support in all browsers
*/

-- Restore video_url in metadata from various MP4 formats to playlist.m3u8
UPDATE content_uploads
SET metadata = jsonb_set(
  metadata,
  '{video_url}',
  to_jsonb(
    regexp_replace(
      metadata->>'video_url',
      '/play_(360p|480p|720p|1080p)\.mp4',
      '/playlist.m3u8'
    )
  )
)
WHERE content_type IN ('video', 'short_clip')
  AND metadata->>'video_url' ~ '/play_(360p|480p|720p|1080p)\.mp4$';

-- Log the number of updated records
DO $$
DECLARE
  updated_count integer;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM content_uploads
  WHERE content_type IN ('video', 'short_clip')
    AND metadata->>'video_url' LIKE '%/playlist.m3u8';

  RAISE NOTICE 'Restored % video records to use HLS playlist format', updated_count;
END $$;
