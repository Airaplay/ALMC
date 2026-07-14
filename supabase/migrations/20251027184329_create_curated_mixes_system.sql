/*
  # Create Curated Mixes System for "Mix for You"
  
  1. Purpose
    - Enable admin to create and manage curated music playlists
    - Display these playlists in "Mix for You" section on Home Screen
    - Support targeting by country, genre, and global visibility
    
  2. New Tables
    - `curated_mixes`
      - `id` (uuid, primary key)
      - `title` (text) - Mix title
      - `description` (text) - Mix description (optional)
      - `cover_image_url` (text) - Cover image URL
      - `song_ids` (jsonb array) - Array of song UUIDs
      - `target_country` (text) - Target country code (NULL = global)
      - `target_genres` (jsonb array) - Array of genre strings (NULL = all genres)
      - `is_visible` (boolean) - Current visibility status
      - `scheduled_visibility_date` (timestamptz) - Future visibility date
      - `total_duration` (integer) - Total duration in seconds
      - `play_count` (integer) - Number of plays
      - `created_by` (uuid) - Admin user who created
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  3. Security
    - Enable RLS on `curated_mixes` table
    - Admin can create/update/delete mixes
    - Public users can read visible mixes
    
  4. Functions
    - `get_curated_mixes_for_user()` - Returns mixes based on user's country and preferences
    - `calculate_mix_duration()` - Calculates total duration from song_ids
*/

-- Create curated_mixes table
CREATE TABLE IF NOT EXISTS curated_mixes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  cover_image_url text,
  song_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_country text,
  target_genres jsonb DEFAULT '[]'::jsonb,
  is_visible boolean DEFAULT false,
  scheduled_visibility_date timestamptz,
  total_duration integer DEFAULT 0,
  play_count integer DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE curated_mixes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for curated_mixes

-- Public users can read visible mixes
CREATE POLICY "Public can view visible curated mixes"
  ON curated_mixes
  FOR SELECT
  TO public
  USING (
    is_visible = true 
    AND (scheduled_visibility_date IS NULL OR scheduled_visibility_date <= now())
  );

-- Admin can view all mixes
CREATE POLICY "Admin can view all curated mixes"
  ON curated_mixes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Admin can create mixes
CREATE POLICY "Admin can create curated mixes"
  ON curated_mixes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Admin can update mixes
CREATE POLICY "Admin can update curated mixes"
  ON curated_mixes
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Admin can delete mixes
CREATE POLICY "Admin can delete curated mixes"
  ON curated_mixes
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'manager')
    )
  );

-- Function to calculate mix duration from song_ids
CREATE OR REPLACE FUNCTION calculate_mix_duration(mix_song_ids jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_duration integer := 0;
BEGIN
  SELECT COALESCE(SUM(duration_seconds), 0)
  INTO total_duration
  FROM songs
  WHERE id IN (
    SELECT jsonb_array_elements_text(mix_song_ids)::uuid
  );
  
  RETURN total_duration;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION calculate_mix_duration TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_mix_duration TO anon;

-- Trigger to auto-calculate duration on insert/update
CREATE OR REPLACE FUNCTION trigger_calculate_mix_duration()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.total_duration := calculate_mix_duration(NEW.song_ids);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER calculate_mix_duration_trigger
  BEFORE INSERT OR UPDATE ON curated_mixes
  FOR EACH ROW
  EXECUTE FUNCTION trigger_calculate_mix_duration();

-- Function to get curated mixes for a user based on their country and preferences
CREATE OR REPLACE FUNCTION get_curated_mixes_for_user(
  user_country text DEFAULT NULL,
  user_id uuid DEFAULT NULL,
  limit_count integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  cover_image_url text,
  song_ids jsonb,
  target_country text,
  target_genres jsonb,
  total_duration integer,
  play_count integer,
  song_count integer,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cm.id,
    cm.title,
    cm.description,
    cm.cover_image_url,
    cm.song_ids,
    cm.target_country,
    cm.target_genres,
    cm.total_duration,
    cm.play_count,
    jsonb_array_length(cm.song_ids) as song_count,
    cm.created_at
  FROM curated_mixes cm
  WHERE cm.is_visible = true
    AND (cm.scheduled_visibility_date IS NULL OR cm.scheduled_visibility_date <= now())
    AND (
      cm.target_country IS NULL 
      OR cm.target_country = user_country
      OR user_country IS NULL
    )
  ORDER BY 
    cm.play_count DESC,
    cm.created_at DESC
  LIMIT limit_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_curated_mixes_for_user TO authenticated;
GRANT EXECUTE ON FUNCTION get_curated_mixes_for_user TO anon;

-- Function to get detailed mix information with song details
CREATE OR REPLACE FUNCTION get_mix_with_song_details(mix_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  mix_data jsonb;
  songs_data jsonb := '[]'::jsonb;
  song_ids_array uuid[];
  song_record record;
BEGIN
  -- Get mix data
  SELECT jsonb_build_object(
    'id', cm.id,
    'title', cm.title,
    'description', cm.description,
    'cover_image_url', cm.cover_image_url,
    'target_country', cm.target_country,
    'target_genres', cm.target_genres,
    'total_duration', cm.total_duration,
    'play_count', cm.play_count,
    'created_at', cm.created_at
  )
  INTO mix_data
  FROM curated_mixes cm
  WHERE cm.id = mix_id;
  
  IF mix_data IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Get song IDs array
  SELECT ARRAY(
    SELECT jsonb_array_elements_text((
      SELECT song_ids FROM curated_mixes WHERE id = mix_id
    ))::uuid
  ) INTO song_ids_array;
  
  -- Fetch song details in order
  FOR song_record IN
    SELECT 
      s.id,
      s.title,
      COALESCE(ap.stage_name, a.name, 'Unknown Artist') as artist,
      s.audio_url,
      s.cover_image_url,
      s.duration_seconds,
      s.play_count
    FROM songs s
    LEFT JOIN artists a ON s.artist_id = a.id
    LEFT JOIN artist_profiles ap ON a.id = ap.artist_id
    WHERE s.id = ANY(song_ids_array)
    ORDER BY array_position(song_ids_array, s.id)
  LOOP
    songs_data := songs_data || jsonb_build_object(
      'id', song_record.id,
      'title', song_record.title,
      'artist', song_record.artist,
      'audio_url', song_record.audio_url,
      'cover_url', song_record.cover_image_url,
      'duration', song_record.duration_seconds,
      'play_count', song_record.play_count
    );
  END LOOP;
  
  -- Add songs array to mix data
  mix_data := jsonb_set(mix_data, '{songs}', songs_data);
  
  RETURN mix_data;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_mix_with_song_details TO authenticated;
GRANT EXECUTE ON FUNCTION get_mix_with_song_details TO anon;

-- Function to increment mix play count
CREATE OR REPLACE FUNCTION increment_mix_play_count(mix_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE curated_mixes
  SET play_count = play_count + 1
  WHERE id = mix_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION increment_mix_play_count TO authenticated;
GRANT EXECUTE ON FUNCTION increment_mix_play_count TO anon;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_curated_mixes_visibility 
  ON curated_mixes(is_visible, scheduled_visibility_date);

CREATE INDEX IF NOT EXISTS idx_curated_mixes_target_country 
  ON curated_mixes(target_country);

CREATE INDEX IF NOT EXISTS idx_curated_mixes_play_count 
  ON curated_mixes(play_count DESC);
