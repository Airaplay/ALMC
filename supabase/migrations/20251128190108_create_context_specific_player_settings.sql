/*
  # Create Context-Specific Player Settings

  1. Purpose
    - Store shuffle and repeat settings per playback context (album, playlist, song)
    - Each context (album, playlist, single song) maintains independent settings
    - Users' shuffle/repeat preferences are remembered per content type
    - Switching between different contexts doesn't affect other contexts' settings

  2. New Tables
    - `user_player_context_settings`
      - `user_id` (uuid, references auth.users)
      - `context_key` (text) - unique identifier for context (e.g., 'album-{id}', 'playlist-{id}')
      - `context_type` (text) - type of context: 'album', 'playlist', 'song', 'discovery'
      - `shuffle_enabled` (boolean) - whether shuffle is enabled for this context
      - `repeat_mode` (text) - repeat mode: 'off', 'one', or 'all'
      - `last_used_at` (timestamptz) - last time this context was accessed
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - Composite primary key: (user_id, context_key)

  3. Security
    - Enable RLS on `user_player_context_settings` table
    - Users can read/write only their own context settings
    - Service role has full access for cleanup operations

  4. Important Notes
    - Settings are per-user and per-context
    - Each album has its own independent shuffle/repeat state
    - Each playlist has its own independent shuffle/repeat state
    - Cleanup policy removes contexts not used in 90+ days
    - Default settings: shuffle = false, repeat = 'off'

  5. Examples
    - User enables shuffle on Album A → saved as context_key='album-{albumId}'
    - User enables repeat on Playlist B → saved as context_key='playlist-{playlistId}'
    - User switches to Album C → loads Album C's saved settings (or defaults)
    - User returns to Album A → shuffle is still enabled (remembered)
*/

CREATE TABLE IF NOT EXISTS user_player_context_settings (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  context_key text NOT NULL,
  context_type text NOT NULL CHECK (context_type IN ('album', 'playlist', 'song', 'discovery', 'profile')),
  shuffle_enabled boolean DEFAULT false NOT NULL,
  repeat_mode text DEFAULT 'off' NOT NULL CHECK (repeat_mode IN ('off', 'one', 'all')),
  last_used_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, context_key)
);

ALTER TABLE user_player_context_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own context settings"
  ON user_player_context_settings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own context settings"
  ON user_player_context_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own context settings"
  ON user_player_context_settings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own context settings"
  ON user_player_context_settings
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to context settings"
  ON user_player_context_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_context_settings_user_id ON user_player_context_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_context_settings_context_key ON user_player_context_settings(context_key);
CREATE INDEX IF NOT EXISTS idx_context_settings_last_used ON user_player_context_settings(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_settings_context_type ON user_player_context_settings(context_type);

-- Function to clean up old unused context settings (older than 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_context_settings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM user_player_context_settings
  WHERE last_used_at < now() - interval '90 days';
END;
$$;

-- Create function to upsert context settings
CREATE OR REPLACE FUNCTION upsert_context_settings(
  p_user_id uuid,
  p_context_key text,
  p_context_type text,
  p_shuffle_enabled boolean,
  p_repeat_mode text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_player_context_settings (
    user_id,
    context_key,
    context_type,
    shuffle_enabled,
    repeat_mode,
    last_used_at,
    updated_at
  )
  VALUES (
    p_user_id,
    p_context_key,
    p_context_type,
    p_shuffle_enabled,
    p_repeat_mode,
    now(),
    now()
  )
  ON CONFLICT (user_id, context_key)
  DO UPDATE SET
    shuffle_enabled = EXCLUDED.shuffle_enabled,
    repeat_mode = EXCLUDED.repeat_mode,
    last_used_at = now(),
    updated_at = now();
END;
$$;