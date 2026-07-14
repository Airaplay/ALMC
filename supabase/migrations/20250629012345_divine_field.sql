/*
  # Add increment_play_count function for tracking song plays

  1. New Function
    - `increment_play_count` - Increments the play count for a song
    - Handles both authenticated and anonymous users
    - Provides a secure way to update play counts

  2. Security
    - Function runs with security definer to ensure proper permissions
    - Available to both authenticated and anonymous users
    - Maintains data integrity for play count statistics
*/

-- Create function to increment play count for a song
CREATE OR REPLACE FUNCTION increment_play_count(song_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update the play count for the song
  UPDATE songs
  SET 
    play_count = COALESCE(play_count, 0) + 1,
    updated_at = now()
  WHERE id = song_uuid;
END;
$$;

-- Grant execute permissions to authenticated and anonymous users
GRANT EXECUTE ON FUNCTION increment_play_count TO authenticated;
GRANT EXECUTE ON FUNCTION increment_play_count TO anon;

-- Create index for better performance on play count queries
CREATE INDEX IF NOT EXISTS idx_songs_trending 
ON songs(is_trending, play_count DESC);