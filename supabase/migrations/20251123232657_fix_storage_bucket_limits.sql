/*
  # Fix Critical Storage Bucket File Size Limits

  ## Issue
  Two storage buckets have incorrect file size limits:
  - content-covers: 10 bytes (should be 10 MB)
  - short-clips: 50 bytes (should be 50 MB)

  This prevents users from uploading any content to these buckets.

  ## Changes
  1. Fix content-covers bucket: 10 bytes → 10,485,760 bytes (10 MB)
  2. Fix short-clips bucket: 50 bytes → 52,428,800 bytes (50 MB)
  3. Add limits to covers bucket for security
*/

-- Fix content-covers bucket (10 MB)
UPDATE storage.buckets
SET file_size_limit = 10485760
WHERE name = 'content-covers';

-- Fix short-clips bucket (50 MB)
UPDATE storage.buckets
SET file_size_limit = 52428800
WHERE name = 'short-clips';

-- Add limits to covers bucket for security (10 MB + MIME types)
UPDATE storage.buckets
SET
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
WHERE name = 'covers' AND file_size_limit IS NULL;
