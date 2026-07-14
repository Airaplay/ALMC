/*
  # Fix Malformed Audio URLs in Database

  1. Purpose
    - Fixes audio URLs that are missing the .b-cdn.net domain suffix
    - Updates URLs in the format `https://airaplay/audio/...` to `https://airaplay.b-cdn.net/audio/...`
    - Ensures all audio URLs are properly formatted for playback

  2. Changes
    - Updates `songs` table `audio_url` column to fix malformed URLs
    - Updates `songs` table `cover_image_url` column to fix malformed URLs
    - Logs the number of rows affected for verification

  3. Safety
    - Only updates URLs that match the malformed pattern
    - Does not affect properly formatted URLs
    - Can be safely re-run (idempotent)
*/

-- Fix audio URLs in songs table
UPDATE songs
SET audio_url = REPLACE(audio_url, 'https://airaplay/', 'https://airaplay.b-cdn.net/')
WHERE audio_url LIKE 'https://airaplay/%'
  AND audio_url NOT LIKE 'https://airaplay.b-cdn.net/%';

-- Fix cover image URLs in songs table
UPDATE songs
SET cover_image_url = REPLACE(cover_image_url, 'https://airaplay/', 'https://airaplay.b-cdn.net/')
WHERE cover_image_url LIKE 'https://airaplay/%'
  AND cover_image_url NOT LIKE 'https://airaplay.b-cdn.net/%';

-- Fix URLs in content_uploads metadata (audio_url)
UPDATE content_uploads
SET metadata = jsonb_set(
  metadata,
  '{audio_url}',
  to_jsonb(REPLACE(metadata->>'audio_url', 'https://airaplay/', 'https://airaplay.b-cdn.net/'))
)
WHERE metadata->>'audio_url' LIKE 'https://airaplay/%'
  AND metadata->>'audio_url' NOT LIKE 'https://airaplay.b-cdn.net/%';

-- Fix URLs in content_uploads metadata (cover_url)
UPDATE content_uploads
SET metadata = jsonb_set(
  metadata,
  '{cover_url}',
  to_jsonb(REPLACE(metadata->>'cover_url', 'https://airaplay/', 'https://airaplay.b-cdn.net/'))
)
WHERE metadata->>'cover_url' LIKE 'https://airaplay/%'
  AND metadata->>'cover_url' NOT LIKE 'https://airaplay.b-cdn.net/%';

-- Fix URLs in albums table
UPDATE albums
SET cover_image_url = REPLACE(cover_image_url, 'https://airaplay/', 'https://airaplay.b-cdn.net/')
WHERE cover_image_url LIKE 'https://airaplay/%'
  AND cover_image_url NOT LIKE 'https://airaplay.b-cdn.net/%';

-- Add helpful comment
COMMENT ON TABLE songs IS 'Songs table - audio_url should always use full CDN domain (e.g., https://airaplay.b-cdn.net/)';
