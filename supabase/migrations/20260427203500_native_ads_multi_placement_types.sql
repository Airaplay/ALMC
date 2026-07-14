/*
  # Native Ads: multi-placement support

  Adds `placement_types` array so a single ad can target multiple placements.
*/

ALTER TABLE public.native_ad_cards
  ADD COLUMN IF NOT EXISTS placement_types text[];

-- Backfill existing rows from legacy single placement field.
UPDATE public.native_ad_cards
SET placement_types = ARRAY[placement_type]
WHERE placement_type IS NOT NULL
  AND (placement_types IS NULL OR array_length(placement_types, 1) IS NULL);

-- Index for efficient contains queries (placement_types.cs.{value}).
CREATE INDEX IF NOT EXISTS idx_native_ad_cards_placement_types_gin
  ON public.native_ad_cards USING GIN (placement_types);

