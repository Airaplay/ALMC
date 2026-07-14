/*
  # Update content uploads metadata structure

  1. Changes
    - Add better metadata structure for tracking uploaded files
    - Ensure all audio content has both audio_url and cover_url in metadata
    - Add file tracking for better organization

  2. Notes
    - This migration updates the metadata structure to better track uploaded files
    - Ensures consistency between audio files and their cover images
    - Maintains backward compatibility with existing data
*/

-- Add a function to update existing content uploads metadata structure
CREATE OR REPLACE FUNCTION update_content_metadata()
RETURNS void AS $$
BEGIN
  -- Update existing single uploads to ensure they have proper metadata structure
  UPDATE content_uploads 
  SET metadata = jsonb_build_object(
    'audio_url', COALESCE(metadata->>'audio_url', metadata->>'file_url'),
    'cover_url', COALESCE(metadata->>'cover_url', metadata->>'cover_image_url'),
    'duration_seconds', COALESCE((metadata->>'duration_seconds')::integer, 0),
    'file_name', COALESCE(metadata->>'file_name', 'unknown'),
    'file_size', COALESCE((metadata->>'file_size')::bigint, 0),
    'file_type', COALESCE(metadata->>'file_type', 'audio/mpeg'),
    'release_date', metadata->>'release_date',
    'song_id', metadata->>'song_id'
  )
  WHERE content_type = 'single' 
    AND (metadata IS NULL OR NOT (metadata ? 'audio_url' AND metadata ? 'cover_url'));

  -- Update existing album uploads to ensure they have proper metadata structure
  UPDATE content_uploads 
  SET metadata = jsonb_build_object(
    'album_id', metadata->>'album_id',
    'cover_url', COALESCE(metadata->>'cover_url', metadata->>'cover_image_url'),
    'song_ids', COALESCE(metadata->'song_ids', '[]'::jsonb),
    'tracks_count', COALESCE((metadata->>'tracks_count')::integer, 0),
    'release_date', metadata->>'release_date',
    'total_duration', COALESCE((metadata->>'total_duration')::integer, 0)
  )
  WHERE content_type = 'album' 
    AND (metadata IS NULL OR NOT (metadata ? 'album_id' AND metadata ? 'cover_url'));

  -- Update existing video uploads to ensure they have proper metadata structure
  UPDATE content_uploads 
  SET metadata = jsonb_build_object(
    'video_url', COALESCE(metadata->>'video_url', metadata->>'file_url'),
    'thumbnail_url', COALESCE(metadata->>'thumbnail_url', metadata->>'cover_url'),
    'duration_seconds', COALESCE((metadata->>'duration_seconds')::integer, 0),
    'file_name', COALESCE(metadata->>'file_name', 'unknown'),
    'file_size', COALESCE((metadata->>'file_size')::bigint, 0),
    'file_type', COALESCE(metadata->>'file_type', 'video/mp4'),
    'release_date', metadata->>'release_date'
  )
  WHERE content_type = 'video' 
    AND (metadata IS NULL OR NOT (metadata ? 'video_url'));

  -- Update existing short clip uploads to ensure they have proper metadata structure
  UPDATE content_uploads 
  SET metadata = jsonb_build_object(
    'video_url', COALESCE(metadata->>'video_url', metadata->>'file_url'),
    'thumbnail_url', COALESCE(metadata->>'thumbnail_url', metadata->>'cover_url'),
    'duration_seconds', COALESCE((metadata->>'duration_seconds')::integer, 0),
    'file_name', COALESCE(metadata->>'file_name', 'unknown'),
    'file_size', COALESCE((metadata->>'file_size')::bigint, 0),
    'file_type', COALESCE(metadata->>'file_type', 'video/mp4')
  )
  WHERE content_type = 'short_clip' 
    AND (metadata IS NULL OR NOT (metadata ? 'video_url'));

END;
$$ LANGUAGE plpgsql;

-- Execute the metadata update function
SELECT update_content_metadata();

-- Drop the function after use
DROP FUNCTION update_content_metadata();

-- Add a constraint to ensure audio content has both audio_url and cover_url
ALTER TABLE content_uploads 
ADD CONSTRAINT check_audio_content_metadata 
CHECK (
  content_type != 'single' OR 
  (metadata ? 'audio_url' AND metadata ? 'cover_url')
);

-- Add a constraint to ensure album content has cover_url and album_id
ALTER TABLE content_uploads 
ADD CONSTRAINT check_album_content_metadata 
CHECK (
  content_type != 'album' OR 
  (metadata ? 'cover_url' AND metadata ? 'album_id')
);

-- Add a constraint to ensure video content has video_url
ALTER TABLE content_uploads 
ADD CONSTRAINT check_video_content_metadata 
CHECK (
  content_type != 'video' OR 
  (metadata ? 'video_url')
);

-- Add a constraint to ensure short_clip content has video_url
ALTER TABLE content_uploads 
ADD CONSTRAINT check_short_clip_content_metadata 
CHECK (
  content_type != 'short_clip' OR 
  (metadata ? 'video_url')
);

-- Create an index on metadata for better query performance
CREATE INDEX IF NOT EXISTS idx_content_uploads_metadata_audio_url 
ON content_uploads USING GIN ((metadata->'audio_url')) 
WHERE content_type = 'single';

CREATE INDEX IF NOT EXISTS idx_content_uploads_metadata_cover_url 
ON content_uploads USING GIN ((metadata->'cover_url')) 
WHERE content_type IN ('single', 'album');

CREATE INDEX IF NOT EXISTS idx_content_uploads_metadata_video_url 
ON content_uploads USING GIN ((metadata->'video_url')) 
WHERE content_type IN ('video', 'short_clip');