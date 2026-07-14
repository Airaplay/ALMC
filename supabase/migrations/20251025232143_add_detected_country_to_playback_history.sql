/*
  # Add Detected Country Fields to Playback History Tables

  1. Changes to `listening_history`
    - Add `detected_country` (text, nullable) - Country name detected from IP address
    - Add `detected_country_code` (text, nullable) - ISO country code (e.g., NG, US, GB)

  2. Changes to `video_playback_history`
    - Add `detected_country` (text, nullable) - Country name detected from IP address
    - Add `detected_country_code` (text, nullable) - ISO country code (e.g., NG, US, GB)

  3. Purpose
    - Enable location-based analytics using IP geolocation
    - Track audience demographics even for users without country in profile
    - Provide comprehensive location insights for creator analytics

  4. Notes
    - These fields will be populated by the application when recording playback
    - IP address is already stored, these fields cache the geolocation result
    - Analytics queries can combine user profile country + detected country for complete data
*/

-- Add detected_country columns to listening_history
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listening_history' AND column_name = 'detected_country'
  ) THEN
    ALTER TABLE public.listening_history 
    ADD COLUMN detected_country text,
    ADD COLUMN detected_country_code text;
  END IF;
END $$;

-- Add detected_country columns to video_playback_history
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'video_playback_history' AND column_name = 'detected_country'
  ) THEN
    ALTER TABLE public.video_playback_history 
    ADD COLUMN detected_country text,
    ADD COLUMN detected_country_code text;
  END IF;
END $$;

-- Add helpful comments
COMMENT ON COLUMN public.listening_history.detected_country IS 'Country name detected from IP address geolocation';
COMMENT ON COLUMN public.listening_history.detected_country_code IS 'ISO country code detected from IP (e.g., NG, US, GB)';
COMMENT ON COLUMN public.video_playback_history.detected_country IS 'Country name detected from IP address geolocation';
COMMENT ON COLUMN public.video_playback_history.detected_country_code IS 'ISO country code detected from IP (e.g., NG, US, GB)';