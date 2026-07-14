/*
  # Native Ads: Audio companion + targeting

  Adds audio-ad companion display fields and extra audience targeting.
*/

ALTER TABLE public.native_ad_cards
  ADD COLUMN IF NOT EXISTS companion_image_url text,
  ADD COLUMN IF NOT EXISTS companion_cta_text text,
  ADD COLUMN IF NOT EXISTS target_genders text[],
  ADD COLUMN IF NOT EXISTS target_age_min integer,
  ADD COLUMN IF NOT EXISTS target_age_max integer;

-- Basic sanity checks (optional fields)
ALTER TABLE public.native_ad_cards
  ADD CONSTRAINT native_ad_cards_target_age_min_valid
    CHECK (target_age_min IS NULL OR target_age_min >= 0);

ALTER TABLE public.native_ad_cards
  ADD CONSTRAINT native_ad_cards_target_age_max_valid
    CHECK (target_age_max IS NULL OR target_age_max >= 0);

ALTER TABLE public.native_ad_cards
  ADD CONSTRAINT native_ad_cards_target_age_range_valid
    CHECK (
      target_age_min IS NULL
      OR target_age_max IS NULL
      OR target_age_min <= target_age_max
    );

