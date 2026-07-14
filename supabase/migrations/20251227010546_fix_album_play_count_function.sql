/*
  # Fix Album Play Count Retrieval

  1. New Function
    - `get_album_play_count` - Returns total play count for all songs in an album
    - Properly handles UUID to string comparison
    - Returns 0 if no songs found

  2. Purpose
    - Fix issue where album play counts show as 0 in Library screen
    - Ensure proper type casting between UUID and string
*/

-- Create function to get album play count
CREATE OR REPLACE FUNCTION get_album_play_count(album_uuid uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(play_count), 0)::bigint
  FROM songs
  WHERE album_id = album_uuid;
$$;

-- Grant execute permission to authenticated and anonymous users
GRANT EXECUTE ON FUNCTION get_album_play_count(uuid) TO authenticated, anon;
