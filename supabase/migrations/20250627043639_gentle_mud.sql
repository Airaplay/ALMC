/*
  # Create playlists table

  1. New Tables
    - `playlists` - Store playlist information
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `title` (text, required)
      - `description` (text, optional)
      - `cover_image_url` (text, optional)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on playlists table
    - Add policies for CRUD operations
    - Users can only manage their own playlists

  3. Indexes
    - Add index on user_id for performance
*/

-- Create playlists table
CREATE TABLE IF NOT EXISTS playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  cover_image_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;

-- RLS Policies for playlists table
-- Allow authenticated users to create their own playlists
CREATE POLICY "Authenticated users can create their own playlists"
ON playlists
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Allow authenticated users to view their own playlists
CREATE POLICY "Authenticated users can view their own playlists"
ON playlists
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Allow authenticated users to update their own playlists
CREATE POLICY "Authenticated users can update their own playlists"
ON playlists
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Allow authenticated users to delete their own playlists
CREATE POLICY "Authenticated users can delete their own playlists"
ON playlists
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Index for user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists(user_id);

-- Index for created_at for ordering
CREATE INDEX IF NOT EXISTS idx_playlists_created_at ON playlists(created_at DESC);