/*
  # Fix Bunny Stream Hostname for Video URLs

  1. Changes
    - Update all video_url entries in content_uploads metadata
    - Replace incorrect hostname 'Airaplay.b-cdn.net' with correct hostname 'vz-ed368036-4dd.b-cdn.net'
    - This fixes video playback issues where videos couldn't load

  2. Notes
    - Only affects content_uploads with video_url in metadata
    - Uses JSONB set operation to update nested metadata field
*/

-- Update video URLs in content_uploads metadata
UPDATE content_uploads
SET metadata = jsonb_set(
  metadata,
  '{video_url}',
  to_jsonb(replace(metadata->>'video_url', 'Airaplay.b-cdn.net', 'vz-ed368036-4dd.b-cdn.net'))
)
WHERE metadata->>'video_url' LIKE '%Airaplay.b-cdn.net%';
