-- Fix: column "name" does not exist on playlists
-- Some triggers or RPCs (e.g. record_listener_contribution) may expect playlists.name.
-- This migration adds a "name" column that mirrors "title" so existing DB logic keeps working.

-- 1. Add "name" column if it doesn't exist (nullable first so we can backfill)
ALTER TABLE playlists
ADD COLUMN IF NOT EXISTS name TEXT;

-- 2. Backfill: set name = title where name is null
UPDATE playlists
SET name = title
WHERE name IS NULL AND title IS NOT NULL;

-- 3. Trigger: keep name in sync with title on INSERT and UPDATE
CREATE OR REPLACE FUNCTION playlists_sync_name_from_title()
RETURNS TRIGGER AS $$
BEGIN
  NEW.name := COALESCE(NEW.title, NEW.name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS playlists_sync_name_trigger ON playlists;
CREATE TRIGGER playlists_sync_name_trigger
  BEFORE INSERT OR UPDATE OF title ON playlists
  FOR EACH ROW
  EXECUTE PROCEDURE playlists_sync_name_from_title();

-- 4. Optional: make name NOT NULL after backfill (uncomment if you want)
-- ALTER TABLE playlists ALTER COLUMN name SET NOT NULL;
