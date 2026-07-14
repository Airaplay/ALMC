/*
  # Add social features and playlist management

  1. New Functions
    - `toggle_song_in_playlist` - Add or remove a song from a playlist
    - `get_user_playlists_for_song` - Get user's playlists with song status

  2. Indexes
    - Add indexes for better performance on user_favorites and playlist_songs

  3. Security
    - Ensure proper RLS policies for social features
*/

-- Create function to toggle a song in a playlist
CREATE OR REPLACE FUNCTION toggle_song_in_playlist(
  playlist_uuid uuid,
  song_uuid uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  playlist_record record;
  existing_song record;
  next_position integer;
  result jsonb;
BEGIN
  -- Check if user is authenticated
  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Authentication required');
  END IF;

  -- Check if playlist exists and belongs to the user
  SELECT * INTO playlist_record
  FROM playlists
  WHERE id = playlist_uuid AND user_id = current_user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Playlist not found or you do not have permission');
  END IF;

  -- Check if song is already in the playlist
  SELECT * INTO existing_song
  FROM playlist_songs
  WHERE playlist_id = playlist_uuid AND song_id = song_uuid;
  
  IF FOUND THEN
    -- Remove song from playlist
    DELETE FROM playlist_songs
    WHERE id = existing_song.id;
    
    RETURN jsonb_build_object(
      'success', true,
      'added', false,
      'removed', true,
      'message', 'Song removed from playlist'
    );
  ELSE
    -- Get the next position
    SELECT COALESCE(MAX(position), -1) + 1 INTO next_position
    FROM playlist_songs
    WHERE playlist_id = playlist_uuid;
    
    -- Add song to playlist
    INSERT INTO playlist_songs (
      playlist_id,
      song_id,
      position
    ) VALUES (
      playlist_uuid,
      song_uuid,
      next_position
    );
    
    RETURN jsonb_build_object(
      'success', true,
      'added', true,
      'removed', false,
      'message', 'Song added to playlist'
    );
  END IF;
END;
$$;

-- Function to get user's playlists with song status
CREATE OR REPLACE FUNCTION get_user_playlists_for_song(
  song_uuid uuid
)
RETURNS TABLE (
  id uuid,
  title text,
  cover_image_url text,
  has_song boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  -- Check if user is authenticated
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT 
    p.id,
    p.title,
    p.cover_image_url,
    EXISTS (
      SELECT 1 
      FROM playlist_songs ps 
      WHERE ps.playlist_id = p.id AND ps.song_id = song_uuid
    ) as has_song
  FROM playlists p
  WHERE p.user_id = current_user_id
  ORDER BY p.created_at DESC;
END;
$$;

-- Create additional RLS policies for user_favorites if they don't exist
DO $$
BEGIN
  -- Check if the policy exists before creating it
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'user_favorites' AND policyname = 'Users can manage own favorites'
  ) THEN
    CREATE POLICY "Users can manage own favorites"
      ON user_favorites
      FOR ALL
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
  
  -- Check if the policy exists before creating it
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'user_favorites' AND policyname = 'Users can read own favorites'
  ) THEN
    CREATE POLICY "Users can read own favorites"
      ON user_favorites
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- Create additional indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id 
ON user_favorites(user_id);

CREATE INDEX IF NOT EXISTS idx_playlist_songs_song_id 
ON playlist_songs(song_id);

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION toggle_song_in_playlist(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_playlists_for_song(uuid) TO authenticated;