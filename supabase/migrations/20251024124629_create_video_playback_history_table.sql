/*
  # Create Video Playback History Table

  1. New Tables
    - `video_playback_history`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to users)
      - `content_id` (uuid, foreign key to content_uploads)
      - `watched_at` (timestamptz, default now())
      - `duration_watched` (integer, seconds watched)
      - `ip_address` (text, nullable)
      - `user_agent` (text, nullable)
      - `is_validated` (boolean, default true)
      - `validation_score` (numeric, default 100.0)

  2. Purpose
    - Separate video/clip playback history from song listening history
    - Track which videos users have already watched
    - Enable proper "Watch Next" recommendations by excluding watched videos
    - Support fraud detection and analytics

  3. Security
    - Enable RLS on `video_playback_history` table
    - Users can view their own playback history
    - Users can insert their own playback records
    - Admins can view all records

  4. Indexes
    - Index on user_id for fast user history lookups
    - Index on content_id for content analytics
    - Index on watched_at for time-based queries
*/

-- Create the video_playback_history table
CREATE TABLE IF NOT EXISTS video_playback_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES content_uploads(id) ON DELETE CASCADE,
  watched_at timestamptz DEFAULT now(),
  duration_watched integer NOT NULL DEFAULT 0,
  ip_address text,
  user_agent text,
  is_validated boolean DEFAULT true,
  validation_score numeric DEFAULT 100.0,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_video_playback_history_user_id ON video_playback_history(user_id);
CREATE INDEX IF NOT EXISTS idx_video_playback_history_content_id ON video_playback_history(content_id);
CREATE INDEX IF NOT EXISTS idx_video_playback_history_watched_at ON video_playback_history(watched_at);
CREATE INDEX IF NOT EXISTS idx_video_playback_history_user_content ON video_playback_history(user_id, content_id);

-- Enable Row Level Security
ALTER TABLE video_playback_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own playback history
CREATE POLICY "Users can view own playback history"
  ON video_playback_history
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own playback records
CREATE POLICY "Users can insert own playback records"
  ON video_playback_history
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Admins can view all playback history
CREATE POLICY "Admins can view all playback history"
  ON video_playback_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Policy: Allow anonymous users to insert playback records (for tracking)
CREATE POLICY "Anonymous users can insert playback records"
  ON video_playback_history
  FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);

-- Policy: Service role can do everything
CREATE POLICY "Service role has full access"
  ON video_playback_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);