/*
  # Native Ads: per-ad audio insertion interval

  Lets each audio ad define its own interval in songs.
*/

ALTER TABLE public.native_ad_cards
  ADD COLUMN IF NOT EXISTS audio_insertion_interval_songs integer;

UPDATE public.native_ad_cards
SET audio_insertion_interval_songs = 5
WHERE audio_url IS NOT NULL
  AND audio_insertion_interval_songs IS NULL;

ALTER TABLE public.native_ad_cards
  ADD CONSTRAINT native_ad_cards_audio_interval_valid
  CHECK (
    audio_insertion_interval_songs IS NULL
    OR audio_insertion_interval_songs IN (2, 3, 5, 6, 8, 10)
  );

