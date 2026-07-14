/*
  # External Revenue Sharing — Core Tables

  Purpose
  -------
  Adds a SEPARATE financial rail for revenue that is NOT AdMob:
    subscriptions, sponsorships, brand deals, partnerships, premium tiers,
    treat commissions, grants, anything else the platform earns externally.

  Design rules (must not be violated by later migrations / app code):
    1. NEVER write to ad_daily_revenue_input. AdMob remains 60/0/40.
    2. NEVER change ad_safety_caps. The platform residual stays compliant.
    3. ALL crediting goes through the same wallets/ledgers AdMob already uses
       (users.total_earnings for creators, treat_wallets for listeners).
    4. Platform share is DERIVED, never stored as a percentage:
         platform_retained_usd = net_amount_usd - distributable_amount_usd
       distributable pool is split 100% between creators and listeners only.
    5. Entries must be LOCKED before distribution. Distributions are idempotent.

  Tables created:
    - external_revenue_sources
    - external_revenue_entries
    - external_revenue_split_settings
    - external_revenue_distributions
    - external_revenue_creator_payouts
    - external_revenue_listener_payouts
*/

-- ============================================================================
-- 1) external_revenue_sources : catalog of source TYPES (subscription, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.external_revenue_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_revenue_sources_active
  ON public.external_revenue_sources(is_active);

ALTER TABLE public.external_revenue_sources ENABLE ROW LEVEL SECURITY;

-- Seed defaults (idempotent)
INSERT INTO public.external_revenue_sources (code, name, description) VALUES
  ('subscription',     'Subscriptions',     'Recurring subscription revenue (premium tiers, paid plans).'),
  ('sponsorship',      'Sponsorships',      'Brand sponsorships and named partnerships.'),
  ('brand_deal',       'Brand Deals',       'One-off brand integrations and product placements.'),
  ('partnership',      'Partnerships',      'Strategic partnership payouts to the platform.'),
  ('merch',            'Merchandise',       'Platform merchandise sales revenue.'),
  ('premium_feature',  'Premium Features',  'In-app premium feature purchases.'),
  ('treat_commission', 'Treat Commission',  'Platform commission on listener treat purchases.'),
  ('grant',            'Grants',            'Grants and funding awards received by the platform.'),
  ('other',            'Other',             'Other miscellaneous external revenue.')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 2) external_revenue_entries : admin-logged revenue events
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.external_revenue_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  source_id uuid NOT NULL REFERENCES public.external_revenue_sources(id) ON DELETE RESTRICT,

  -- Money fields. All ultimately reconciled in USD.
  gross_amount_usd numeric(14, 4) NOT NULL DEFAULT 0
    CHECK (gross_amount_usd >= 0),
  fees_usd numeric(14, 4) NOT NULL DEFAULT 0
    CHECK (fees_usd >= 0),
  net_amount_usd numeric(14, 4) NOT NULL DEFAULT 0
    CHECK (net_amount_usd >= 0),

  -- Admin chooses how much of net to share. Platform keeps the rest.
  distributable_amount_usd numeric(14, 4) NOT NULL DEFAULT 0
    CHECK (distributable_amount_usd >= 0),

  -- Optional original-currency fields for record keeping.
  original_currency text DEFAULT 'USD',
  fx_rate_to_usd numeric(14, 6) DEFAULT 1.0
    CHECK (fx_rate_to_usd > 0),

  -- Free-form metadata
  reference text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Lock-before-distribute pattern (same as ad_daily_revenue_input)
  is_locked boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  locked_by uuid REFERENCES public.users(id),

  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Critical invariants
  CONSTRAINT external_revenue_entries_net_le_gross
    CHECK (net_amount_usd <= gross_amount_usd OR gross_amount_usd = 0),
  CONSTRAINT external_revenue_entries_distributable_le_net
    CHECK (distributable_amount_usd <= net_amount_usd)
);

CREATE INDEX IF NOT EXISTS idx_external_revenue_entries_date
  ON public.external_revenue_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_external_revenue_entries_source
  ON public.external_revenue_entries(source_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_external_revenue_entries_locked
  ON public.external_revenue_entries(is_locked);

ALTER TABLE public.external_revenue_entries ENABLE ROW LEVEL SECURITY;

-- Updated_at trigger (reuses existing helper if present, otherwise inline)
CREATE OR REPLACE FUNCTION public.external_revenue_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_external_revenue_entries_updated_at ON public.external_revenue_entries;
CREATE TRIGGER trg_external_revenue_entries_updated_at
  BEFORE UPDATE ON public.external_revenue_entries
  FOR EACH ROW EXECUTE FUNCTION public.external_revenue_set_updated_at();

-- ============================================================================
-- 3) external_revenue_split_settings : how the distributable pool is divided
-- ============================================================================
-- One row with source_id = NULL is the default. Per-source overrides allowed.
--
-- Split is between CREATORS and LISTENERS only. There is no platform percent
-- here — the platform retention is derived from (net - distributable).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.external_revenue_split_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.external_revenue_sources(id) ON DELETE CASCADE,

  creator_pool_percentage numeric(5, 2) NOT NULL DEFAULT 50.00
    CHECK (creator_pool_percentage >= 0 AND creator_pool_percentage <= 100),
  listener_pool_percentage numeric(5, 2) NOT NULL DEFAULT 50.00
    CHECK (listener_pool_percentage >= 0 AND listener_pool_percentage <= 100),

  -- Attribution methods (how each pool is split among recipients)
  creator_attribution text NOT NULL DEFAULT 'plays_in_period'
    CHECK (creator_attribution IN (
      'equal_active',
      'plays_in_period',
      'manual'
    )),
  listener_attribution text NOT NULL DEFAULT 'feed_contribution_pool'
    CHECK (listener_attribution IN (
      'feed_contribution_pool',
      'proportional_points',
      'equal_active_listeners'
    )),

  -- Window (in days, back from entry_date) used to attribute plays/points
  attribution_window_days integer NOT NULL DEFAULT 30
    CHECK (attribution_window_days BETWEEN 1 AND 365),

  -- Floors / caps
  min_plays_for_creator_eligibility integer NOT NULL DEFAULT 1
    CHECK (min_plays_for_creator_eligibility >= 0),
  min_points_for_listener_eligibility integer NOT NULL DEFAULT 10
    CHECK (min_points_for_listener_eligibility >= 0),

  is_active boolean NOT NULL DEFAULT true,

  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT external_revenue_split_totals_100
    CHECK (creator_pool_percentage + listener_pool_percentage = 100)
);

-- Exactly one default row (source_id NULL) when active.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_revenue_split_default_active
  ON public.external_revenue_split_settings (is_active)
  WHERE source_id IS NULL AND is_active = true;

-- One active override per source.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_revenue_split_source_active
  ON public.external_revenue_split_settings (source_id)
  WHERE is_active = true AND source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_revenue_split_active
  ON public.external_revenue_split_settings (is_active);

ALTER TABLE public.external_revenue_split_settings ENABLE ROW LEVEL SECURITY;

-- Seed: a default 50/50 split (admin can change in UI).
INSERT INTO public.external_revenue_split_settings (
  source_id, creator_pool_percentage, listener_pool_percentage,
  creator_attribution, listener_attribution
)
SELECT NULL, 50.00, 50.00, 'plays_in_period', 'feed_contribution_pool'
WHERE NOT EXISTS (
  SELECT 1 FROM public.external_revenue_split_settings
  WHERE source_id IS NULL AND is_active = true
);

DROP TRIGGER IF EXISTS trg_external_revenue_split_updated_at ON public.external_revenue_split_settings;
CREATE TRIGGER trg_external_revenue_split_updated_at
  BEFORE UPDATE ON public.external_revenue_split_settings
  FOR EACH ROW EXECUTE FUNCTION public.external_revenue_set_updated_at();

-- ============================================================================
-- 4) external_revenue_distributions : one run per entry (idempotency header)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.external_revenue_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL UNIQUE
    REFERENCES public.external_revenue_entries(id) ON DELETE RESTRICT,

  net_amount_usd numeric(14, 4) NOT NULL,
  distributable_amount_usd numeric(14, 4) NOT NULL,
  creator_pool_usd numeric(14, 4) NOT NULL,
  listener_pool_usd numeric(14, 4) NOT NULL,
  platform_retained_usd numeric(14, 4) NOT NULL,

  creator_attribution text NOT NULL,
  listener_attribution text NOT NULL,
  attribution_window_days integer NOT NULL,
  attribution_window_start date NOT NULL,
  attribution_window_end date NOT NULL,

  creators_paid_count integer NOT NULL DEFAULT 0,
  listeners_paid_count integer NOT NULL DEFAULT 0,
  contribution_pool_topup_usd numeric(14, 4) NOT NULL DEFAULT 0,

  status text NOT NULL DEFAULT 'distributed'
    CHECK (status IN ('distributed', 'reversed', 'partial')),

  reverses_distribution_id uuid REFERENCES public.external_revenue_distributions(id),
  reversed_by_distribution_id uuid REFERENCES public.external_revenue_distributions(id),
  reversal_reason text,

  executed_by uuid REFERENCES public.users(id),
  executed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT external_revenue_distribution_pools_sum
    CHECK (round((creator_pool_usd + listener_pool_usd + platform_retained_usd)::numeric, 2)
           = round(net_amount_usd::numeric, 2))
);

CREATE INDEX IF NOT EXISTS idx_external_revenue_distributions_entry
  ON public.external_revenue_distributions(entry_id);
CREATE INDEX IF NOT EXISTS idx_external_revenue_distributions_status
  ON public.external_revenue_distributions(status, executed_at DESC);

ALTER TABLE public.external_revenue_distributions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5) external_revenue_creator_payouts : per-creator amounts
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.external_revenue_creator_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id uuid NOT NULL
    REFERENCES public.external_revenue_distributions(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE RESTRICT,
  attribution_metric_value numeric(20, 6) NOT NULL DEFAULT 0,
  payout_usd numeric(14, 4) NOT NULL DEFAULT 0
    CHECK (payout_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (distribution_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_external_revenue_creator_payouts_dist
  ON public.external_revenue_creator_payouts(distribution_id);
CREATE INDEX IF NOT EXISTS idx_external_revenue_creator_payouts_artist
  ON public.external_revenue_creator_payouts(artist_id, created_at DESC);

ALTER TABLE public.external_revenue_creator_payouts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 6) external_revenue_listener_payouts : per-listener amounts (Mode B only)
-- ============================================================================
-- Only populated when listener_attribution != 'feed_contribution_pool'.
-- When 'feed_contribution_pool' is used, the listener pool is added to the
-- next contribution conversion and listeners are credited through the
-- existing monthly contribution flow instead.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.external_revenue_listener_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id uuid NOT NULL
    REFERENCES public.external_revenue_distributions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  attribution_metric_value numeric(20, 6) NOT NULL DEFAULT 0,
  payout_usd numeric(14, 4) NOT NULL DEFAULT 0
    CHECK (payout_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (distribution_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_external_revenue_listener_payouts_dist
  ON public.external_revenue_listener_payouts(distribution_id);
CREATE INDEX IF NOT EXISTS idx_external_revenue_listener_payouts_user
  ON public.external_revenue_listener_payouts(user_id, created_at DESC);

ALTER TABLE public.external_revenue_listener_payouts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 7) Contribution pool top-up bridge (Mode A: feed_contribution_pool)
-- ============================================================================
-- Tracks listener-pool USD waiting to top up the next monthly contribution
-- conversion. The contribution conversion RPC reads from here, consumes the
-- pending rows (marks them consumed), and includes them in the reward pool.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.external_revenue_contribution_pool_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id uuid NOT NULL UNIQUE
    REFERENCES public.external_revenue_distributions(id) ON DELETE CASCADE,
  amount_usd numeric(14, 4) NOT NULL CHECK (amount_usd > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'reversed')),
  consumed_for_period_date date,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_revenue_topups_status
  ON public.external_revenue_contribution_pool_topups(status, created_at);

ALTER TABLE public.external_revenue_contribution_pool_topups ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES (admin-only writes; selected reads for affected users)
-- ============================================================================

DO $$
BEGIN
  -- Sources: admins manage, everyone authenticated can read active sources.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_sources'
      AND policyname='Admins manage external revenue sources'
  ) THEN
    CREATE POLICY "Admins manage external revenue sources"
      ON public.external_revenue_sources
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()
                     AND role IN ('admin','manager','account')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()
                          AND role IN ('admin','manager','account')));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_sources'
      AND policyname='Authenticated read active external revenue sources'
  ) THEN
    CREATE POLICY "Authenticated read active external revenue sources"
      ON public.external_revenue_sources
      FOR SELECT TO authenticated
      USING (is_active = true);
  END IF;

  -- Entries: admins manage; account/manager can view; creator/listener cannot.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_entries'
      AND policyname='Admins manage external revenue entries'
  ) THEN
    CREATE POLICY "Admins manage external revenue entries"
      ON public.external_revenue_entries
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_entries'
      AND policyname='Finance staff read external revenue entries'
  ) THEN
    CREATE POLICY "Finance staff read external revenue entries"
      ON public.external_revenue_entries
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()
                     AND role IN ('admin','manager','account')));
  END IF;

  -- Split settings: admins manage; account/manager can view.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_split_settings'
      AND policyname='Admins manage external revenue split settings'
  ) THEN
    CREATE POLICY "Admins manage external revenue split settings"
      ON public.external_revenue_split_settings
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_split_settings'
      AND policyname='Finance staff read external revenue split settings'
  ) THEN
    CREATE POLICY "Finance staff read external revenue split settings"
      ON public.external_revenue_split_settings
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()
                     AND role IN ('admin','manager','account')));
  END IF;

  -- Distributions: admins manage; finance staff read; creators/listeners read OWN payouts via the per-row tables below.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_distributions'
      AND policyname='Admins manage external revenue distributions'
  ) THEN
    CREATE POLICY "Admins manage external revenue distributions"
      ON public.external_revenue_distributions
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_distributions'
      AND policyname='Finance staff read external revenue distributions'
  ) THEN
    CREATE POLICY "Finance staff read external revenue distributions"
      ON public.external_revenue_distributions
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()
                     AND role IN ('admin','manager','account')));
  END IF;

  -- Creator payouts: admins manage; the artist's linked user can read own.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_creator_payouts'
      AND policyname='Admins manage external revenue creator payouts'
  ) THEN
    CREATE POLICY "Admins manage external revenue creator payouts"
      ON public.external_revenue_creator_payouts
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_creator_payouts'
      AND policyname='Artists read own external revenue creator payouts'
  ) THEN
    CREATE POLICY "Artists read own external revenue creator payouts"
      ON public.external_revenue_creator_payouts
      FOR SELECT TO authenticated
      USING (
        artist_id IN (
          SELECT ap.artist_id FROM public.artist_profiles ap WHERE ap.user_id = auth.uid()
        )
      );
  END IF;

  -- Listener payouts: admins manage; user reads own.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_listener_payouts'
      AND policyname='Admins manage external revenue listener payouts'
  ) THEN
    CREATE POLICY "Admins manage external revenue listener payouts"
      ON public.external_revenue_listener_payouts
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_listener_payouts'
      AND policyname='Users read own external revenue listener payouts'
  ) THEN
    CREATE POLICY "Users read own external revenue listener payouts"
      ON public.external_revenue_listener_payouts
      FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;

  -- Topups: admin manage; finance staff read.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_contribution_pool_topups'
      AND policyname='Admins manage external revenue topups'
  ) THEN
    CREATE POLICY "Admins manage external revenue topups"
      ON public.external_revenue_contribution_pool_topups
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='external_revenue_contribution_pool_topups'
      AND policyname='Finance staff read external revenue topups'
  ) THEN
    CREATE POLICY "Finance staff read external revenue topups"
      ON public.external_revenue_contribution_pool_topups
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()
                     AND role IN ('admin','manager','account')));
  END IF;
END $$;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE public.external_revenue_sources IS
  'Catalog of external (non-AdMob) revenue source types: subscriptions, sponsorships, partnerships, etc.';
COMMENT ON TABLE public.external_revenue_entries IS
  'Admin-logged external revenue events. Locked-before-distribute. Platform retained = net - distributable.';
COMMENT ON TABLE public.external_revenue_split_settings IS
  'How the distributable pool is split between creators and listeners. Platform percent is intentionally absent.';
COMMENT ON TABLE public.external_revenue_distributions IS
  'One distribution run per entry (UNIQUE entry_id). Audit header for creator/listener payouts.';
COMMENT ON TABLE public.external_revenue_creator_payouts IS
  'Per-artist external revenue payout audit. Mirrors ad_creator_daily_payouts.';
COMMENT ON TABLE public.external_revenue_listener_payouts IS
  'Per-listener payouts (only when listener_attribution != feed_contribution_pool).';
COMMENT ON TABLE public.external_revenue_contribution_pool_topups IS
  'Listener-pool USD waiting to be added to the next monthly contribution conversion (Mode A).';
