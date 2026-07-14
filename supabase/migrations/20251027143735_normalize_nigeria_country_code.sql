/*
  # Normalize Nigeria Country Code

  1. Changes
    - Update all 'Nigeria' country values to 'NG' in users table
    - Update all 'Nigeria' country values to 'NG' in songs table
    - Update all 'Nigeria' detected_country values to 'NG' in video_playback_history table
    - Create a function to normalize country codes on insert/update
    - Add triggers to automatically normalize country codes

  2. Purpose
    - Ensure Nigeria and NG are treated as the same country
    - Maintain data consistency across all tables
    - Automatically normalize future data entries
*/

-- Normalize existing data in users table
UPDATE users 
SET country = 'NG' 
WHERE country = 'Nigeria' OR country = 'nigeria';

-- Normalize existing data in songs table
UPDATE songs 
SET country = 'NG' 
WHERE country = 'Nigeria' OR country = 'nigeria';

-- Normalize existing data in video_playback_history table
UPDATE video_playback_history 
SET detected_country = 'NG' 
WHERE detected_country = 'Nigeria' OR detected_country = 'nigeria';

-- Create function to normalize country codes
CREATE OR REPLACE FUNCTION normalize_country_code()
RETURNS TRIGGER AS $$
BEGIN
  -- Normalize Nigeria to NG
  IF NEW.country IS NOT NULL THEN
    IF LOWER(NEW.country) = 'nigeria' THEN
      NEW.country := 'NG';
    END IF;
  END IF;
  
  -- Also handle detected_country column if it exists
  IF TG_TABLE_NAME = 'video_playback_history' THEN
    IF NEW.detected_country IS NOT NULL THEN
      IF LOWER(NEW.detected_country) = 'nigeria' THEN
        NEW.detected_country := 'NG';
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers to normalize country codes on insert/update
DROP TRIGGER IF EXISTS normalize_country_code_users ON users;
CREATE TRIGGER normalize_country_code_users
  BEFORE INSERT OR UPDATE OF country ON users
  FOR EACH ROW
  EXECUTE FUNCTION normalize_country_code();

DROP TRIGGER IF EXISTS normalize_country_code_songs ON songs;
CREATE TRIGGER normalize_country_code_songs
  BEFORE INSERT OR UPDATE OF country ON songs
  FOR EACH ROW
  EXECUTE FUNCTION normalize_country_code();

DROP TRIGGER IF EXISTS normalize_country_code_video_playback_history ON video_playback_history;
CREATE TRIGGER normalize_country_code_video_playback_history
  BEFORE INSERT OR UPDATE OF detected_country ON video_playback_history
  FOR EACH ROW
  EXECUTE FUNCTION normalize_country_code();
