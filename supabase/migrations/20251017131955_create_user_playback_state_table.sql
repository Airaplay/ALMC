/*
  # Create User Playback State Table

  1. Purpose
    - Store user's current playback state for seamless resume functionality
    - Track queue, position, shuffle/repeat settings
    - Allow users to resume exactly where they left off

  2. New Tables
    - `user_playback_state`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users, unique)
      - `song_id` (uuid, references songs)
      - `playback_position` (integer) - playback position in seconds
      - `playlist` (jsonb) - array of song IDs in the queue
      - `current_index` (integer) - current position in queue
      - `playlist_context` (text) - where playlist came from (e.g., 'trending', 'favorites')
      - `is_shuffle_enabled` (boolean)
      - `repeat_mode` (text) - 'off', 'one', or 'all'
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  3. Security
    - Enable RLS on `user_playback_state` table
    - Users can read/write only their own playback state
    - Service role has full access for automated updates

  4. Important Notes
    - Upsert on user_id ensures only one state per user
    - Auto-updates every 10 seconds during playback
    - Helps resume playback after app restart
*/

CREATE TABLE IF NOT EXISTS user_playback_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  song_id uuid REFERENCES songs(id) ON DELETE SET NULL,
  playback_position integer DEFAULT 0,
  playlist jsonb DEFAULT '[]'::jsonb,
  current_index integer DEFAULT 0,
  playlist_context text DEFAULT 'unknown',
  is_shuffle_enabled boolean DEFAULT false,
  repeat_mode text DEFAULT 'off' CHECK (repeat_mode IN ('off', 'one', 'all')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_playback_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own playback state"
  ON user_playback_state
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own playback state"
  ON user_playback_state
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own playback state"
  ON user_playback_state
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role has full access to playback state"
  ON user_playback_state
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_user_playback_state_user_id ON user_playback_state(user_id);
CREATE INDEX IF NOT EXISTS idx_user_playback_state_updated_at ON user_playback_state(updated_at DESC);