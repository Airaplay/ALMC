/*
  # Fix Delete Triggers Error Handling

  1. Problem
    - Delete triggers for content_uploads fail when storage files don't exist or permissions are missing
    - This blocks legitimate delete operations from users and admins
    - BEFORE DELETE triggers must complete successfully for DELETE to proceed

  2. Solution
    - Wrap storage.delete_object() calls in exception handling
    - Log errors but don't fail the delete operation
    - Continue with deletion even if storage cleanup fails
    - This ensures users can always delete their content

  3. Changes
    - Update delete_song_storage_files() with error handling
    - Update delete_album_storage_files() with error handling
    - Update delete_content_upload_storage_files() with error handling
*/

-- ============================================
-- FUNCTION: Delete Song Storage Files (with error handling)
-- ============================================

CREATE OR REPLACE FUNCTION delete_song_storage_files()
RETURNS TRIGGER
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  storage_path text;
BEGIN
  -- Delete audio file from storage if exists
  IF OLD.audio_url IS NOT NULL THEN
    BEGIN
      storage_path := substring(OLD.audio_url from 'content-media/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('content-media', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete audio file: %', SQLERRM;
    END;
  END IF;

  -- Delete video file from storage if exists
  IF OLD.video_url IS NOT NULL THEN
    BEGIN
      storage_path := substring(OLD.video_url from 'content-media/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('content-media', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete video file: %', SQLERRM;
    END;
  END IF;

  -- Delete cover image from storage if exists
  IF OLD.cover_image_url IS NOT NULL THEN
    BEGIN
      -- Try content-covers bucket first
      storage_path := substring(OLD.cover_image_url from 'content-covers/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('content-covers', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete cover from content-covers: %', SQLERRM;
    END;
    
    BEGIN
      -- Also try thumbnails bucket
      storage_path := substring(OLD.cover_image_url from 'thumbnails/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('thumbnails', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete cover from thumbnails: %', SQLERRM;
    END;
  END IF;

  RETURN OLD;
END;
$$;

-- ============================================
-- FUNCTION: Delete Album Storage Files (with error handling)
-- ============================================

CREATE OR REPLACE FUNCTION delete_album_storage_files()
RETURNS TRIGGER
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  storage_path text;
BEGIN
  -- Delete cover image from storage if exists
  IF OLD.cover_image_url IS NOT NULL THEN
    BEGIN
      -- Try content-covers bucket
      storage_path := substring(OLD.cover_image_url from 'content-covers/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('content-covers', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete album cover from content-covers: %', SQLERRM;
    END;
    
    BEGIN
      -- Also try thumbnails bucket
      storage_path := substring(OLD.cover_image_url from 'thumbnails/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('thumbnails', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete album cover from thumbnails: %', SQLERRM;
    END;
  END IF;

  RETURN OLD;
END;
$$;

-- ============================================
-- FUNCTION: Delete Content Upload Storage Files (with error handling)
-- ============================================

CREATE OR REPLACE FUNCTION delete_content_upload_storage_files()
RETURNS TRIGGER
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  storage_path text;
  cover_url text;
  audio_url text;
  video_url text;
  thumbnail_url text;
  file_url text;
BEGIN
  -- Extract URLs from metadata JSONB
  cover_url := OLD.metadata->>'cover_url';
  audio_url := OLD.metadata->>'audio_url';
  video_url := OLD.metadata->>'video_url';
  thumbnail_url := OLD.metadata->>'thumbnail_url';
  file_url := OLD.metadata->>'file_url';

  -- Delete cover/thumbnail file
  IF cover_url IS NOT NULL THEN
    BEGIN
      -- Try content-covers bucket
      storage_path := substring(cover_url from 'content-covers/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('content-covers', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete cover from content-covers: %', SQLERRM;
    END;
    
    BEGIN
      -- Try thumbnails bucket
      storage_path := substring(cover_url from 'thumbnails/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('thumbnails', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete cover from thumbnails: %', SQLERRM;
    END;
  END IF;

  -- Delete thumbnail_url if different from cover_url
  IF thumbnail_url IS NOT NULL AND thumbnail_url != cover_url THEN
    BEGIN
      storage_path := substring(thumbnail_url from 'thumbnails/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('thumbnails', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete thumbnail: %', SQLERRM;
    END;
  END IF;

  -- Delete audio file
  IF audio_url IS NOT NULL THEN
    BEGIN
      storage_path := substring(audio_url from 'content-media/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('content-media', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete audio file: %', SQLERRM;
    END;
  END IF;

  -- Delete video file
  IF video_url IS NOT NULL THEN
    BEGIN
      -- Try content-media bucket
      storage_path := substring(video_url from 'content-media/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('content-media', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete video from content-media: %', SQLERRM;
    END;
    
    BEGIN
      -- Try short-clips bucket
      storage_path := substring(video_url from 'short-clips/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('short-clips', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete video from short-clips: %', SQLERRM;
    END;
  END IF;

  -- Delete file_url (generic file field for short clips)
  IF file_url IS NOT NULL AND file_url != video_url THEN
    BEGIN
      -- Try short-clips bucket
      storage_path := substring(file_url from 'short-clips/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('short-clips', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete file from short-clips: %', SQLERRM;
    END;
    
    BEGIN
      -- Try content-media bucket
      storage_path := substring(file_url from 'content-media/(.*)$');
      IF storage_path IS NOT NULL THEN
        PERFORM storage.delete_object('content-media', storage_path);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete file from content-media: %', SQLERRM;
    END;
  END IF;

  RETURN OLD;
END;
$$;