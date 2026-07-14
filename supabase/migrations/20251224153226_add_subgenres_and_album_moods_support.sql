/*
  # Add Subgenres and Album Moods Support

  ## Summary
  This migration adds comprehensive support for subgenres and moods across songs and albums,
  allowing creators to better categorize their content with multiple genre/subgenre tags and mood selections.

  ## Changes

  ### 1. New Tables
  
  #### `subgenres` Table
  - `id` (uuid, primary key) - Unique identifier for subgenre
  - `name` (text, unique, not null) - Name of the subgenre (e.g., "Trap", "Deep House")
  - `parent_genre_id` (uuid, references genres) - Parent genre this subgenre belongs to
  - `description` (text) - Description of the subgenre
  - `is_active` (boolean) - Whether the subgenre is active/visible
  - `display_order` (integer) - Order for displaying subgenres
  - `created_at` (timestamptz) - When the subgenre was created
  - `updated_at` (timestamptz) - Last update timestamp

  #### `song_subgenres` Table
  - `id` (uuid, primary key) - Unique identifier
  - `song_id` (uuid, references songs) - The song
  - `subgenre_id` (uuid, references subgenres) - The subgenre
  - `created_at` (timestamptz) - When the association was created
  - Composite unique constraint on (song_id, subgenre_id) to prevent duplicates

  #### `album_genres` Table (if not exists)
  - `id` (uuid, primary key) - Unique identifier
  - `album_id` (uuid, references albums) - The album
  - `genre_id` (uuid, references genres) - The genre
  - `created_at` (timestamptz) - When the association was created
  - Composite unique constraint on (album_id, genre_id) to prevent duplicates

  #### `album_subgenres` Table
  - `id` (uuid, primary key) - Unique identifier
  - `album_id` (uuid, references albums) - The album
  - `subgenre_id` (uuid, references subgenres) - The subgenre
  - `created_at` (timestamptz) - When the association was created
  - Composite unique constraint on (album_id, subgenre_id) to prevent duplicates

  #### `album_moods` Table
  - `id` (uuid, primary key) - Unique identifier
  - `album_id` (uuid, references albums) - The album
  - `mood_id` (uuid, references mood_categories) - The mood
  - `created_at` (timestamptz) - When the association was created
  - Composite unique constraint on (album_id, mood_id) to prevent duplicates

  ### 2. Indexes
  - Index on `subgenres.parent_genre_id` for efficient genre-based lookups
  - Index on `subgenres.is_active` for filtering active subgenres
  - Indexes on all foreign keys in junction tables for performance

  ### 3. Security
  - Enable RLS on all new tables
  - Public read access for subgenres (to browse available options)
  - Authenticated users can read their associations
  - Only content owners can create/update/delete their associations
  - Admins have full access to manage subgenres

  ### 4. Initial Data
  - Populate common subgenres for existing genres:
    - Afrobeat: Afro-Fusion, Afro-Pop, Afro-House
    - Hip Hop: Trap, Boom Bap, Conscious Hip Hop, Cloud Rap
    - Electronic: House, Techno, Dubstep, Trance
    - Pop: Electropop, Indie Pop, Synth Pop
    - R&B: Contemporary R&B, Neo-Soul, Alternative R&B
    - Rock: Indie Rock, Alternative Rock, Hard Rock
*/

-- =====================================================
-- 1. Create subgenres table
-- =====================================================
CREATE TABLE IF NOT EXISTS subgenres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  parent_genre_id uuid REFERENCES genres(id) ON DELETE CASCADE,
  description text,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =====================================================
-- 2. Create junction tables
-- =====================================================

-- Song to Subgenres (many-to-many)
CREATE TABLE IF NOT EXISTS song_subgenres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  subgenre_id uuid NOT NULL REFERENCES subgenres(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(song_id, subgenre_id)
);

-- Album to Genres (many-to-many) - create if not exists
CREATE TABLE IF NOT EXISTS album_genres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  genre_id uuid NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(album_id, genre_id)
);

-- Album to Subgenres (many-to-many)
CREATE TABLE IF NOT EXISTS album_subgenres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  subgenre_id uuid NOT NULL REFERENCES subgenres(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(album_id, subgenre_id)
);

-- Album to Moods (many-to-many)
CREATE TABLE IF NOT EXISTS album_moods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  mood_id uuid NOT NULL REFERENCES mood_categories(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(album_id, mood_id)
);

-- =====================================================
-- 3. Create indexes for performance
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_subgenres_parent_genre ON subgenres(parent_genre_id);
CREATE INDEX IF NOT EXISTS idx_subgenres_is_active ON subgenres(is_active);
CREATE INDEX IF NOT EXISTS idx_subgenres_display_order ON subgenres(display_order);

CREATE INDEX IF NOT EXISTS idx_song_subgenres_song_id ON song_subgenres(song_id);
CREATE INDEX IF NOT EXISTS idx_song_subgenres_subgenre_id ON song_subgenres(subgenre_id);

CREATE INDEX IF NOT EXISTS idx_album_genres_album_id ON album_genres(album_id);
CREATE INDEX IF NOT EXISTS idx_album_genres_genre_id ON album_genres(genre_id);

CREATE INDEX IF NOT EXISTS idx_album_subgenres_album_id ON album_subgenres(album_id);
CREATE INDEX IF NOT EXISTS idx_album_subgenres_subgenre_id ON album_subgenres(subgenre_id);

CREATE INDEX IF NOT EXISTS idx_album_moods_album_id ON album_moods(album_id);
CREATE INDEX IF NOT EXISTS idx_album_moods_mood_id ON album_moods(mood_id);

-- =====================================================
-- 4. Enable Row Level Security
-- =====================================================
ALTER TABLE subgenres ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_subgenres ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_subgenres ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_moods ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 5. RLS Policies - Subgenres
-- =====================================================

-- Everyone can view active subgenres
CREATE POLICY "Public can view active subgenres"
  ON subgenres FOR SELECT
  TO public
  USING (is_active = true);

-- Admins can view all subgenres
CREATE POLICY "Admins can view all subgenres"
  ON subgenres FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can insert subgenres
CREATE POLICY "Admins can insert subgenres"
  ON subgenres FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can update subgenres
CREATE POLICY "Admins can update subgenres"
  ON subgenres FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can delete subgenres
CREATE POLICY "Admins can delete subgenres"
  ON subgenres FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- =====================================================
-- 6. RLS Policies - Song Subgenres
-- =====================================================

-- Everyone can view song subgenres
CREATE POLICY "Public can view song subgenres"
  ON song_subgenres FOR SELECT
  TO public
  USING (true);

-- Song owners can insert subgenres for their songs
CREATE POLICY "Song owners can insert subgenres"
  ON song_subgenres FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM songs
      WHERE songs.id = song_subgenres.song_id
      AND songs.artist_id = auth.uid()
    )
  );

-- Song owners can delete subgenres from their songs
CREATE POLICY "Song owners can delete subgenres"
  ON song_subgenres FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM songs
      WHERE songs.id = song_subgenres.song_id
      AND songs.artist_id = auth.uid()
    )
  );

-- =====================================================
-- 7. RLS Policies - Album Genres
-- =====================================================

-- Everyone can view album genres
CREATE POLICY "Public can view album genres"
  ON album_genres FOR SELECT
  TO public
  USING (true);

-- Album owners can insert genres for their albums
CREATE POLICY "Album owners can insert genres"
  ON album_genres FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM albums
      WHERE albums.id = album_genres.album_id
      AND albums.artist_id = auth.uid()
    )
  );

-- Album owners can delete genres from their albums
CREATE POLICY "Album owners can delete genres"
  ON album_genres FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM albums
      WHERE albums.id = album_genres.album_id
      AND albums.artist_id = auth.uid()
    )
  );

-- =====================================================
-- 8. RLS Policies - Album Subgenres
-- =====================================================

-- Everyone can view album subgenres
CREATE POLICY "Public can view album subgenres"
  ON album_subgenres FOR SELECT
  TO public
  USING (true);

-- Album owners can insert subgenres for their albums
CREATE POLICY "Album owners can insert subgenres"
  ON album_subgenres FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM albums
      WHERE albums.id = album_subgenres.album_id
      AND albums.artist_id = auth.uid()
    )
  );

-- Album owners can delete subgenres from their albums
CREATE POLICY "Album owners can delete subgenres"
  ON album_subgenres FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM albums
      WHERE albums.id = album_subgenres.album_id
      AND albums.artist_id = auth.uid()
    )
  );

-- =====================================================
-- 9. RLS Policies - Album Moods
-- =====================================================

-- Everyone can view album moods
CREATE POLICY "Public can view album moods"
  ON album_moods FOR SELECT
  TO public
  USING (true);

-- Album owners can insert moods for their albums
CREATE POLICY "Album owners can insert moods"
  ON album_moods FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM albums
      WHERE albums.id = album_moods.album_id
      AND albums.artist_id = auth.uid()
    )
  );

-- Album owners can delete moods from their albums
CREATE POLICY "Album owners can delete moods"
  ON album_moods FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM albums
      WHERE albums.id = album_moods.album_id
      AND albums.artist_id = auth.uid()
    )
  );

-- =====================================================
-- 10. Populate initial subgenres
-- =====================================================

-- Get genre IDs
DO $$
DECLARE
  afrobeat_id uuid;
  hiphop_id uuid;
  electronic_id uuid;
  pop_id uuid;
  rnb_id uuid;
  rock_id uuid;
  amapiano_id uuid;
  house_id uuid;
  gospel_id uuid;
  jazz_id uuid;
BEGIN
  -- Get genre IDs
  SELECT id INTO afrobeat_id FROM genres WHERE name = 'Afrobeat';
  SELECT id INTO hiphop_id FROM genres WHERE name IN ('Hip Hop', 'Hip-Hop') LIMIT 1;
  SELECT id INTO electronic_id FROM genres WHERE name = 'Electronic';
  SELECT id INTO pop_id FROM genres WHERE name = 'Pop';
  SELECT id INTO rnb_id FROM genres WHERE name = 'R&B';
  SELECT id INTO rock_id FROM genres WHERE name = 'Rock';
  SELECT id INTO amapiano_id FROM genres WHERE name = 'Amapiano';
  SELECT id INTO house_id FROM genres WHERE name = 'House';
  SELECT id INTO gospel_id FROM genres WHERE name = 'Gospel';
  SELECT id INTO jazz_id FROM genres WHERE name = 'Jazz';

  -- Afrobeat subgenres
  IF afrobeat_id IS NOT NULL THEN
    INSERT INTO subgenres (name, parent_genre_id, description, display_order) VALUES
      ('Afro-Fusion', afrobeat_id, 'Blend of Afrobeat with other genres', 1),
      ('Afro-Pop', afrobeat_id, 'Pop-influenced Afrobeat', 2),
      ('Afro-House', afrobeat_id, 'House music with African rhythms', 3),
      ('Afro-Soul', afrobeat_id, 'Soulful Afrobeat melodies', 4)
    ON CONFLICT (name) DO NOTHING;
  END IF;

  -- Hip Hop subgenres
  IF hiphop_id IS NOT NULL THEN
    INSERT INTO subgenres (name, parent_genre_id, description, display_order) VALUES
      ('Trap', hiphop_id, 'Hard-hitting beats with 808s', 1),
      ('Boom Bap', hiphop_id, 'Classic hip hop sound', 2),
      ('Conscious Hip Hop', hiphop_id, 'Socially aware rap', 3),
      ('Cloud Rap', hiphop_id, 'Dreamy, atmospheric hip hop', 4),
      ('Drill', hiphop_id, 'Aggressive trap-influenced rap', 5),
      ('Lo-Fi Hip Hop', hiphop_id, 'Relaxed, mellow beats', 6)
    ON CONFLICT (name) DO NOTHING;
  END IF;

  -- Electronic subgenres
  IF electronic_id IS NOT NULL THEN
    INSERT INTO subgenres (name, parent_genre_id, description, display_order) VALUES
      ('Deep House', electronic_id, 'Soulful house music', 1),
      ('Techno', electronic_id, 'Repetitive electronic beats', 2),
      ('Dubstep', electronic_id, 'Wobble bass and syncopation', 3),
      ('Trance', electronic_id, 'Melodic, euphoric electronic music', 4),
      ('Drum and Bass', electronic_id, 'Fast breakbeats', 5)
    ON CONFLICT (name) DO NOTHING;
  END IF;

  -- Pop subgenres
  IF pop_id IS NOT NULL THEN
    INSERT INTO subgenres (name, parent_genre_id, description, display_order) VALUES
      ('Electropop', pop_id, 'Electronic-influenced pop', 1),
      ('Indie Pop', pop_id, 'Alternative pop sound', 2),
      ('Synth Pop', pop_id, 'Synthesizer-driven pop', 3),
      ('Dance Pop', pop_id, 'Upbeat, danceable pop', 4)
    ON CONFLICT (name) DO NOTHING;
  END IF;

  -- R&B subgenres
  IF rnb_id IS NOT NULL THEN
    INSERT INTO subgenres (name, parent_genre_id, description, display_order) VALUES
      ('Contemporary R&B', rnb_id, 'Modern R&B sound', 1),
      ('Neo-Soul', rnb_id, 'Soulful R&B revival', 2),
      ('Alternative R&B', rnb_id, 'Experimental R&B', 3),
      ('Quiet Storm', rnb_id, 'Smooth, romantic R&B', 4)
    ON CONFLICT (name) DO NOTHING;
  END IF;

  -- Rock subgenres
  IF rock_id IS NOT NULL THEN
    INSERT INTO subgenres (name, parent_genre_id, description, display_order) VALUES
      ('Indie Rock', rock_id, 'Independent rock music', 1),
      ('Alternative Rock', rock_id, 'Non-mainstream rock', 2),
      ('Hard Rock', rock_id, 'Heavy, aggressive rock', 3),
      ('Soft Rock', rock_id, 'Mellow rock music', 4)
    ON CONFLICT (name) DO NOTHING;
  END IF;

  -- Amapiano subgenres
  IF amapiano_id IS NOT NULL THEN
    INSERT INTO subgenres (name, parent_genre_id, description, display_order) VALUES
      ('Private School Piano', amapiano_id, 'Soulful amapiano', 1),
      ('Bacardi', amapiano_id, 'Upbeat amapiano', 2)
    ON CONFLICT (name) DO NOTHING;
  END IF;

  -- House subgenres
  IF house_id IS NOT NULL THEN
    INSERT INTO subgenres (name, parent_genre_id, description, display_order) VALUES
      ('Tech House', house_id, 'Techno-influenced house', 1),
      ('Progressive House', house_id, 'Evolving house music', 2),
      ('Electro House', house_id, 'Electro-infused house', 3)
    ON CONFLICT (name) DO NOTHING;
  END IF;

  -- Gospel subgenres
  IF gospel_id IS NOT NULL THEN
    INSERT INTO subgenres (name, parent_genre_id, description, display_order) VALUES
      ('Contemporary Gospel', gospel_id, 'Modern gospel music', 1),
      ('Traditional Gospel', gospel_id, 'Classic gospel sound', 2),
      ('Gospel Rap', gospel_id, 'Hip hop with gospel message', 3)
    ON CONFLICT (name) DO NOTHING;
  END IF;

  -- Jazz subgenres
  IF jazz_id IS NOT NULL THEN
    INSERT INTO subgenres (name, parent_genre_id, description, display_order) VALUES
      ('Smooth Jazz', jazz_id, 'Mellow, relaxing jazz', 1),
      ('Jazz Fusion', jazz_id, 'Jazz mixed with other genres', 2),
      ('Bebop', jazz_id, 'Fast, complex jazz', 3)
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;
