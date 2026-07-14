/*
  # Add country columns, auto-tag triggers, and banner country targeting

  1. New Columns
    - `albums.country` (text) - Country code of the uploading artist
    - `content_uploads.country` (text) - Country code of the uploading user
    - `banners.target_countries` (text[]) - Array of country codes for targeting (NULL = global)

  2. Auto-Tag Triggers
    - `auto_tag_song_country`: Sets songs.country from the uploading artist's user profile
    - `auto_tag_album_country`: Sets albums.country from the uploading artist's user profile
    - `auto_tag_content_upload_country`: Sets content_uploads.country from the uploading user's profile

  3. Backfill
    - Backfill albums.country from their associated artist's user profile
    - Backfill content_uploads.country from the uploading user's profile

  4. Security
    - No RLS changes needed (existing policies cover new columns)
*/

-- Add country column to albums
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'albums' AND column_name = 'country'
  ) THEN
    ALTER TABLE public.albums ADD COLUMN country text;
  END IF;
END $$;

-- Add country column to content_uploads
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'content_uploads' AND column_name = 'country'
  ) THEN
    ALTER TABLE public.content_uploads ADD COLUMN country text;
  END IF;
END $$;

-- Add target_countries to banners
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'banners' AND column_name = 'target_countries'
  ) THEN
    ALTER TABLE public.banners ADD COLUMN target_countries text[];
  END IF;
END $$;

-- Create indexes for country columns
CREATE INDEX IF NOT EXISTS idx_albums_country ON public.albums (country);
CREATE INDEX IF NOT EXISTS idx_content_uploads_country ON public.content_uploads (country);
CREATE INDEX IF NOT EXISTS idx_banners_target_countries ON public.banners USING GIN (target_countries);

-- Auto-tag song country trigger
CREATE OR REPLACE FUNCTION public.auto_tag_song_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.country IS NULL AND NEW.artist_id IS NOT NULL THEN
    SELECT u.country INTO NEW.country
    FROM artists a
    JOIN artist_profiles ap ON a.id = ap.artist_id
    JOIN users u ON ap.user_id = u.id
    WHERE a.id = NEW.artist_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_tag_song_country ON public.songs;
CREATE TRIGGER trg_auto_tag_song_country
  BEFORE INSERT ON public.songs
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_tag_song_country();

-- Auto-tag album country trigger
CREATE OR REPLACE FUNCTION public.auto_tag_album_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.country IS NULL AND NEW.artist_id IS NOT NULL THEN
    SELECT u.country INTO NEW.country
    FROM artists a
    JOIN artist_profiles ap ON a.id = ap.artist_id
    JOIN users u ON ap.user_id = u.id
    WHERE a.id = NEW.artist_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_tag_album_country ON public.albums;
CREATE TRIGGER trg_auto_tag_album_country
  BEFORE INSERT ON public.albums
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_tag_album_country();

-- Auto-tag content_uploads country trigger
CREATE OR REPLACE FUNCTION public.auto_tag_content_upload_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.country IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT u.country INTO NEW.country
    FROM users u
    WHERE u.id = NEW.user_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_tag_content_upload_country ON public.content_uploads;
CREATE TRIGGER trg_auto_tag_content_upload_country
  BEFORE INSERT ON public.content_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_tag_content_upload_country();

-- Backfill albums.country from artist profiles
UPDATE public.albums al
SET country = u.country
FROM artists a
JOIN artist_profiles ap ON a.id = ap.artist_id
JOIN users u ON ap.user_id = u.id
WHERE al.artist_id = a.id
  AND al.country IS NULL
  AND u.country IS NOT NULL;

-- Backfill content_uploads.country from uploading user
UPDATE public.content_uploads cu
SET country = u.country
FROM users u
WHERE cu.user_id = u.id
  AND cu.country IS NULL
  AND u.country IS NOT NULL;

-- Update get_top_videos_by_country to use local-first pattern
DROP FUNCTION IF EXISTS public.get_top_videos_by_country(text);

CREATE OR REPLACE FUNCTION public.get_top_videos_by_country(user_country text DEFAULT NULL::text)
RETURNS TABLE(
  id uuid,
  title text,
  content_type text,
  user_id uuid,
  creator_name text,
  creator_avatar text,
  thumbnail_url text,
  video_url text,
  duration_seconds integer,
  play_count integer,
  is_local boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH local_videos AS (
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
      true as is_local
    FROM content_uploads cu
    JOIN users u ON cu.user_id = u.id
    WHERE
      cu.status = 'approved'
      AND cu.content_type = 'video'
      AND cu.metadata->>'video_url' IS NOT NULL
      AND user_country IS NOT NULL
      AND COALESCE(cu.country, u.country) = user_country
    ORDER BY COALESCE(cu.play_count, 0) DESC, cu.created_at DESC
    LIMIT 20
  ),
  global_videos AS (
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
      false as is_local
    FROM content_uploads cu
    JOIN users u ON cu.user_id = u.id
    WHERE
      cu.status = 'approved'
      AND cu.content_type = 'video'
      AND cu.metadata->>'video_url' IS NOT NULL
      AND cu.id NOT IN (SELECT lv.id FROM local_videos lv)
    ORDER BY COALESCE(cu.play_count, 0) DESC, cu.created_at DESC
    LIMIT 20
  ),
  combined AS (
    SELECT * FROM local_videos
    UNION ALL
    SELECT * FROM global_videos
  )
  SELECT
    c.id,
    c.title,
    c.content_type,
    c.user_id,
    c.creator_name,
    c.creator_avatar,
    c.thumbnail_url,
    c.video_url,
    c.duration_seconds,
    c.play_count,
    c.is_local
  FROM combined c
  ORDER BY c.is_local DESC, c.play_count DESC
  LIMIT 30;
END;
$function$;
