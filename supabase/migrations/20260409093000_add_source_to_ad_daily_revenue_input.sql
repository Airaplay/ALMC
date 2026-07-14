/*
  # Add source tracking to ad_daily_revenue_input

  Problem:
  - The Ad Revenue dashboard now sums `ad_daily_revenue_input` to reflect AdMob totals.
  - But the table also supports manual/admin entries, which can be incorrect and can be locked.
  - Without a source field, we can’t reliably distinguish AdMob-synced totals from manual inputs.

  Solution:
  - Add `source` + `sync_id` columns.
  - Backfill existing rows:
    - rows with notes containing "Synced from AdMob API" => source = 'admob_api'
    - everything else => source = 'manual'
*/

ALTER TABLE public.ad_daily_revenue_input
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'admob_api')),
  ADD COLUMN IF NOT EXISTS sync_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_ad_daily_revenue_input_source_date
  ON public.ad_daily_revenue_input(source, revenue_date DESC);

-- Backfill legacy rows (idempotent)
UPDATE public.ad_daily_revenue_input
SET source = CASE
  WHEN COALESCE(notes, '') ILIKE '%Synced from AdMob API%' THEN 'admob_api'
  ELSE 'manual'
END
WHERE source IS NULL OR source NOT IN ('manual', 'admob_api');

