/*
  # Create playlist_songs table

  1. New Tables
    - `playlist_songs` - Link songs to playlists
      - `playlist_id` (uuid, references playlists)
      - `song_id` (uuid, references songs)
      - `added_at` (timestamptz)
      - Composite primary key (playlist_id, song_id)

  2. Security
    - Enable RLS on playlist_songs table
    - Add policies for managing playlist songs
    - Users can only manage songs in their own playlists

  3. Indexes
    - Add indexes for performance on playlist_id and song_id
*/

-- Create playlist_songs table
CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  added_at timestamptz DEFAULT now(),
  PRIMARY KEY (playlist_id, song_id) -- Composite primary key
);

-- Enable Row Level Security (RLS)
ALTER TABLE playlist_songs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for playlist_songs table
-- Allow authenticated users to add songs to their own playlists
CREATE POLICY "Authenticated users can add songs to their own playlists"
ON playlist_songs
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM playlists WHERE id = playlist_songs.playlist_id AND user_id = auth.uid())
);

-- Allow authenticated users to view songs in their own playlists
CREATE POLICY "Authenticated users can view songs in their own playlists"
ON playlist_songs
FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM playlists WHERE id = playlist_songs.playlist_id AND user_id = auth.uid())
);

-- Allow authenticated users to remove songs from their own playlists
CREATE POLICY "Authenticated users can remove songs from their own playlists"
ON playlist_songs
FOR DELETE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM playlists WHERE id = playlist_songs.playlist_id AND user_id = auth.uid())
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist_id ON playlist_songs(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_songs_song_id ON playlist_songs(song_id);
CREATE INDEX IF NOT EXISTS idx_playlist_songs_added_at ON playlist_songs(added_at DESC);