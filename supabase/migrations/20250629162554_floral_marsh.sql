-- First, let's identify and clean up corrupted data in various tables that might contain numeric fields

-- Clean up content_uploads table - play_count should be numeric
UPDATE content_uploads 
SET play_count = 0 
WHERE play_count IS NULL OR play_count < 0;

-- Clean up songs table - duration_seconds and play_count should be numeric
UPDATE songs 
SET duration_seconds = 0 
WHERE duration_seconds IS NULL OR duration_seconds < 0;

UPDATE songs 
SET play_count = 0 
WHERE play_count IS NULL OR play_count < 0;

-- Clean up listening_history table - duration_listened should be numeric
UPDATE listening_history 
SET duration_listened = 0 
WHERE duration_listened IS NULL OR duration_listened < 0;

-- Clean up users table - total_earnings should be numeric
UPDATE users 
SET total_earnings = 0.0 
WHERE total_earnings IS NULL OR total_earnings < 0;

-- Clean up upload_files table - file_size should be numeric
UPDATE upload_files 
SET file_size = 0 
WHERE file_size IS NULL OR file_size < 0;

-- Drop existing functions before recreating them to avoid return type conflicts
DROP FUNCTION IF EXISTS get_top_videos_by_country(text);
DROP FUNCTION IF EXISTS get_trending_songs_by_country(text);
DROP FUNCTION IF EXISTS get_new_releases_by_country(text);
DROP FUNCTION IF EXISTS get_admin_mixes();

-- Now let's create or update the get_top_videos_by_country function to handle edge cases
CREATE FUNCTION get_top_videos_by_country(user_country TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  title TEXT,
  content_type TEXT,
  user_id UUID,
  creator_name TEXT,
  creator_avatar TEXT,
  thumbnail_url TEXT,
  video_url TEXT,
  duration_seconds INTEGER,
  play_count INTEGER,
  created_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cu.id,
    cu.title,
    cu.content_type,
    cu.user_id,
    COALESCE(u.display_name, u.username, 'Unknown Creator') as creator_name,
    u.avatar_url as creator_avatar,
    CASE 
      WHEN cu.metadata->>'thumbnail_url' IS NOT NULL THEN cu.metadata->>'thumbnail_url'
      WHEN cu.metadata->>'cover_url' IS NOT NULL THEN cu.metadata->>'cover_url'
      ELSE NULL
    END as thumbnail_url,
    CASE 
      WHEN cu.content_type = 'video' AND cu.metadata->>'video_url' IS NOT NULL THEN cu.metadata->>'video_url'
      WHEN cu.content_type = 'short_clip' AND cu.metadata->>'file_url' IS NOT NULL THEN cu.metadata->>'file_url'
      ELSE NULL
    END as video_url,
    COALESCE(
      CASE 
        WHEN cu.metadata->>'duration_seconds' ~ '^[0-9]+$' 
        THEN (cu.metadata->>'duration_seconds')::INTEGER
        ELSE 0
      END, 
      0
    ) as duration_seconds,
    COALESCE(cu.play_count, 0) as play_count,
    cu.created_at
  FROM content_uploads cu
  JOIN users u ON cu.user_id = u.id
  WHERE cu.content_type IN ('video', 'short_clip')
    AND cu.status = 'approved'
    AND (
      user_country IS NULL 
      OR u.country = user_country 
      OR u.country IS NULL
    )
  ORDER BY 
    COALESCE(cu.play_count, 0) DESC,
    cu.created_at DESC
  LIMIT 20;
END;
$$;

-- Create or update trending songs function
CREATE FUNCTION get_trending_songs_by_country(user_country TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  title TEXT,
  artist_name TEXT,
  duration_seconds INTEGER,
  audio_url TEXT,
  cover_image_url TEXT,
  album_cover TEXT,
  play_count INTEGER,
  is_trending BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.title,
    a.name as artist_name,
    COALESCE(s.duration_seconds, 0) as duration_seconds,
    s.audio_url,
    s.cover_image_url,
    al.cover_image_url as album_cover,
    COALESCE(s.play_count, 0) as play_count,
    s.is_trending
  FROM songs s
  LEFT JOIN artists a ON s.artist_id = a.id
  LEFT JOIN albums al ON s.album_id = al.id
  LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
  LEFT JOIN users u ON ap.user_id = u.id
  WHERE s.is_trending = true
    AND (
      user_country IS NULL 
      OR u.country = user_country 
      OR u.country IS NULL
    )
  ORDER BY 
    COALESCE(s.play_count, 0) DESC,
    s.created_at DESC
  LIMIT 20;
END;
$$;

-- Create or update get_new_releases_by_country function
CREATE FUNCTION get_new_releases_by_country(user_country TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  title TEXT,
  artist_name TEXT,
  duration_seconds INTEGER,
  audio_url TEXT,
  cover_image_url TEXT,
  album_cover TEXT,
  release_date DATE
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.title,
    a.name as artist_name,
    COALESCE(s.duration_seconds, 0) as duration_seconds,
    s.audio_url,
    s.cover_image_url,
    al.cover_image_url as album_cover,
    s.release_date
  FROM songs s
  LEFT JOIN artists a ON s.artist_id = a.id
  LEFT JOIN albums al ON s.album_id = al.id
  LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
  LEFT JOIN users u ON ap.user_id = u.id
  WHERE s.release_date IS NOT NULL
    AND s.release_date >= CURRENT_DATE - INTERVAL '30 days'
    AND (
      user_country IS NULL 
      OR u.country = user_country 
      OR u.country IS NULL
    )
  ORDER BY s.release_date DESC, s.created_at DESC
  LIMIT 20;
END;
$$;

-- Create or update get_admin_mixes function
CREATE FUNCTION get_admin_mixes()
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  cover_image_url TEXT,
  creator_name TEXT,
  creator_id UUID,
  play_count INTEGER,
  created_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cu.id,
    cu.title,
    cu.description,
    CASE 
      WHEN cu.metadata->>'cover_url' IS NOT NULL THEN cu.metadata->>'cover_url'
      WHEN cu.metadata->>'thumbnail_url' IS NOT NULL THEN cu.metadata->>'thumbnail_url'
      ELSE NULL
    END as cover_image_url,
    COALESCE(u.display_name, u.username, 'Unknown Creator') as creator_name,
    cu.user_id as creator_id,
    COALESCE(cu.play_count, 0) as play_count,
    cu.created_at
  FROM content_uploads cu
  JOIN users u ON cu.user_id = u.id
  WHERE cu.content_type = 'mix'
    AND cu.status = 'approved'
    AND u.role = 'admin'
  ORDER BY 
    COALESCE(cu.play_count, 0) DESC,
    cu.created_at DESC
  LIMIT 10;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_top_videos_by_country(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_videos_by_country(text) TO anon;
GRANT EXECUTE ON FUNCTION get_trending_songs_by_country(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_trending_songs_by_country(text) TO anon;
GRANT EXECUTE ON FUNCTION get_new_releases_by_country(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_new_releases_by_country(text) TO anon;
GRANT EXECUTE ON FUNCTION get_admin_mixes() TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_mixes() TO anon;

-- Add constraints to prevent future data corruption
-- Note: We'll use CHECK constraints that allow NULL but validate non-NULL values

-- Add check constraint for content_uploads.play_count
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'content_uploads_play_count_check' 
    AND table_name = 'content_uploads'
  ) THEN
    ALTER TABLE content_uploads 
    ADD CONSTRAINT content_uploads_play_count_check 
    CHECK (play_count IS NULL OR play_count >= 0);
  END IF;
END $$;

-- Add check constraint for songs.duration_seconds
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'songs_duration_seconds_check' 
    AND table_name = 'songs'
  ) THEN
    ALTER TABLE songs 
    ADD CONSTRAINT songs_duration_seconds_check 
    CHECK (duration_seconds IS NULL OR duration_seconds >= 0);
  END IF;
END $$;

-- Add check constraint for songs.play_count
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'songs_play_count_check' 
    AND table_name = 'songs'
  ) THEN
    ALTER TABLE songs 
    ADD CONSTRAINT songs_play_count_check 
    CHECK (play_count IS NULL OR play_count >= 0);
  END IF;
END $$;

-- Add check constraint for listening_history.duration_listened
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'listening_history_duration_listened_check' 
    AND table_name = 'listening_history'
  ) THEN
    ALTER TABLE listening_history 
    ADD CONSTRAINT listening_history_duration_listened_check 
    CHECK (duration_listened IS NULL OR duration_listened >= 0);
  END IF;
END $$;

-- Add check constraint for users.total_earnings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'users_total_earnings_check' 
    AND table_name = 'users'
  ) THEN
    ALTER TABLE users 
    ADD CONSTRAINT users_total_earnings_check 
    CHECK (total_earnings IS NULL OR total_earnings >= 0);
  END IF;
END $$;

-- Add check constraint for upload_files.file_size
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'upload_files_file_size_check' 
    AND table_name = 'upload_files'
  ) THEN
    ALTER TABLE upload_files 
    ADD CONSTRAINT upload_files_file_size_check 
    CHECK (file_size IS NULL OR file_size >= 0);
  END IF;
END $$;