/*
  # Fix song_genres RLS policies

  1. Security Updates
    - Add INSERT policy for song_genres table to allow authenticated users to link their songs to genres
    - Add UPDATE and DELETE policies for managing song genre associations
    - Ensure users can only manage genres for songs they own

  2. Changes
    - Allow authenticated users to insert song-genre associations for their own songs
    - Allow authenticated users to update/delete song-genre associations for their own songs
    - Maintain existing SELECT policy for reading song genres
*/

-- Add INSERT policy for song_genres
CREATE POLICY "Users can link genres to their own songs"
  ON song_genres
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM songs s
      JOIN artist_profiles ap ON s.artist_id = ap.artist_id
      WHERE s.id = song_genres.song_id 
      AND ap.user_id = auth.uid()
    )
  );

-- Add UPDATE policy for song_genres
CREATE POLICY "Users can update genres for their own songs"
  ON song_genres
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM songs s
      JOIN artist_profiles ap ON s.artist_id = ap.artist_id
      WHERE s.id = song_genres.song_id 
      AND ap.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM songs s
      JOIN artist_profiles ap ON s.artist_id = ap.artist_id
      WHERE s.id = song_genres.song_id 
      AND ap.user_id = auth.uid()
    )
  );

-- Add DELETE policy for song_genres
CREATE POLICY "Users can remove genres from their own songs"
  ON song_genres
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM songs s
      JOIN artist_profiles ap ON s.artist_id = ap.artist_id
      WHERE s.id = song_genres.song_id 
      AND ap.user_id = auth.uid()
    )
  );