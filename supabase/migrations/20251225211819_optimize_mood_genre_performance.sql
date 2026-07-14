/*
  # Performance optimization for mood and genre queries

  1. Indexes
    - Add index on song_mood_analysis (primary_mood, secondary_mood) for faster mood filtering
    - Add composite index on song_genres (genre_id, song_id) for faster genre lookups
    - Add index on songs (created_at DESC) for freshness sorting
    - Add index on songs (play_count DESC) for popularity sorting

  2. Changes
    - These indexes will dramatically speed up:
      - Mood discovery queries (filtering by primary/secondary mood)
      - Genre songs queries (filtering by genre_id)
      - Sorting by popularity and freshness
*/

-- Index for mood queries (primary and secondary mood filtering)
CREATE INDEX IF NOT EXISTS idx_song_mood_analysis_primary_mood
  ON song_mood_analysis(primary_mood)
  WHERE primary_mood IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_song_mood_analysis_secondary_mood
  ON song_mood_analysis(secondary_mood)
  WHERE secondary_mood IS NOT NULL;

-- Composite index for genre queries
CREATE INDEX IF NOT EXISTS idx_song_genres_genre_song
  ON song_genres(genre_id, song_id);

-- Index for sorting by popularity
CREATE INDEX IF NOT EXISTS idx_songs_play_count_desc
  ON songs(play_count DESC NULLS LAST);

-- Index for sorting by freshness
CREATE INDEX IF NOT EXISTS idx_songs_created_at_desc
  ON songs(created_at DESC);

-- Index for song_mood_analysis lookups with song join
CREATE INDEX IF NOT EXISTS idx_song_mood_analysis_song_id
  ON song_mood_analysis(song_id);

-- Composite index for filtering and sorting mood songs by popularity
CREATE INDEX IF NOT EXISTS idx_song_mood_analysis_mood_with_song
  ON song_mood_analysis(primary_mood, song_id)
  WHERE primary_mood IS NOT NULL;
