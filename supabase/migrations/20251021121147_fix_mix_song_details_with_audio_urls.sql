/*
  # Fix Mix Metadata to Include Audio URLs
  
  1. Purpose
    - Ensure all mixes have proper song details with audio URLs in their metadata
    - Add a function to enrich mix metadata with complete song information
    
  2. Changes
    - Create function to fetch and update mix metadata with audio URLs
    - Update existing mixes to include audio URLs in song_details
    
  3. Song Details Structure
    Each song in metadata.song_details should include:
    - id: song UUID
    - title: song title
    - artist: artist name
    - audio_url: URL to audio file (CRITICAL - missing from current data)
    - cover_url: URL to cover image
    - duration: duration in seconds
*/

-- Function to enrich mix metadata with complete song details including audio URLs
CREATE OR REPLACE FUNCTION enrich_mix_song_details(mix_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  mix_metadata jsonb;
  song_ids uuid[];
  enriched_song_details jsonb := '[]'::jsonb;
  song_record record;
BEGIN
  -- Get the current metadata
  SELECT metadata INTO mix_metadata
  FROM content_uploads
  WHERE id = mix_id AND content_type = 'mix';
  
  IF mix_metadata IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Extract song IDs from metadata
  SELECT ARRAY(
    SELECT jsonb_array_elements_text(mix_metadata->'songs')::uuid
  ) INTO song_ids;
  
  -- If no songs, return original metadata
  IF song_ids IS NULL OR array_length(song_ids, 1) = 0 THEN
    RETURN mix_metadata;
  END IF;
  
  -- Fetch complete song details including audio URLs
  FOR song_record IN
    SELECT 
      s.id,
      s.title,
      COALESCE(ap.stage_name, 'Unknown Artist') as artist,
      s.audio_url,
      s.cover_image_url,
      s.duration_seconds
    FROM songs s
    LEFT JOIN artist_profiles ap ON s.artist_id = ap.artist_id
    WHERE s.id = ANY(song_ids)
    ORDER BY array_position(song_ids, s.id)
  LOOP
    enriched_song_details := enriched_song_details || jsonb_build_object(
      'id', song_record.id,
      'title', song_record.title,
      'artist', song_record.artist,
      'audio_url', song_record.audio_url,
      'cover_url', song_record.cover_image_url,
      'duration', song_record.duration_seconds
    );
  END LOOP;
  
  -- Update metadata with enriched song details
  mix_metadata := jsonb_set(
    mix_metadata,
    '{song_details}',
    enriched_song_details
  );
  
  -- Update the content_uploads record
  UPDATE content_uploads
  SET metadata = mix_metadata,
      updated_at = now()
  WHERE id = mix_id;
  
  RETURN mix_metadata;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION enrich_mix_song_details TO authenticated;
GRANT EXECUTE ON FUNCTION enrich_mix_song_details TO anon;

-- Update all existing mixes to include audio URLs in their song_details
DO $$
DECLARE
  mix_record record;
BEGIN
  FOR mix_record IN
    SELECT id FROM content_uploads WHERE content_type = 'mix'
  LOOP
    PERFORM enrich_mix_song_details(mix_record.id);
  END LOOP;
END $$;

-- Create a trigger to automatically enrich song details when a mix is created or updated
CREATE OR REPLACE FUNCTION trigger_enrich_mix_song_details()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.content_type = 'mix' AND NEW.metadata IS NOT NULL THEN
    -- Enrich the metadata before insert/update
    NEW.metadata := enrich_mix_song_details(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- Drop trigger if exists and create new one
DROP TRIGGER IF EXISTS enrich_mix_metadata_trigger ON content_uploads;
CREATE TRIGGER enrich_mix_metadata_trigger
  AFTER INSERT OR UPDATE ON content_uploads
  FOR EACH ROW
  WHEN (NEW.content_type = 'mix')
  EXECUTE FUNCTION trigger_enrich_mix_song_details();
