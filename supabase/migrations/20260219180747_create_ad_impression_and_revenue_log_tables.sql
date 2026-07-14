/*
  # Create Ad Impression Logs and Ad Revenue Logs Tables

  ## Summary
  adLoggingService.ts writes to `ad_impression_logs` and `ad_revenue_logs` tables
  that did not exist, causing all ad revenue logging to silently fail with insert
  errors. This migration creates both tables with RLS and indexes, and seeds the
  required `native_grid` placement and `native` / `monetag_web` network rows needed
  for native and web ad revenue reconciliation.

  ## New Tables

  ### 1. ad_impression_logs
  - Per-impression audit log for AdMob, Monetag, native cards, and web ads
  - Optionally FK-linked to the core `ad_impressions` table
  - Fields: user, ad unit, placement key, network, ad type, duration, completed

  ### 2. ad_revenue_logs
  - Per-impression estimated revenue record
  - Fields: estimated CPM, estimated revenue USD, winning network, placement key

  ## Seed Data
  - `native_grid` row in `ad_placements`
  - `native` and `monetag_web` rows in `ad_networks`

  ## Security
  - RLS enabled on both tables
  - Authenticated users: INSERT their own rows
  - Admin / account_admin: SELECT all rows
*/

-- ── ad_impression_logs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_impression_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_impression_id  uuid        REFERENCES ad_impressions(id) ON DELETE SET NULL,
  user_id           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  ad_unit_id        uuid,
  placement_key     text,
  network           text,
  ad_type           text,
  impression_count  integer     NOT NULL DEFAULT 1,
  view_duration     integer     NOT NULL DEFAULT 0,
  completed         boolean     NOT NULL DEFAULT false,
  failed            boolean     NOT NULL DEFAULT false,
  failure_reason    text,
  metadata          jsonb       NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ad_impression_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ad_impression_logs_user_id
  ON ad_impression_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_ad_impression_logs_created_at
  ON ad_impression_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_impression_logs_network
  ON ad_impression_logs (network);
CREATE INDEX IF NOT EXISTS idx_ad_impression_logs_placement_key
  ON ad_impression_logs (placement_key);

CREATE POLICY "Users can insert own impression logs"
  ON ad_impression_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Admins can view all impression logs"
  ON ad_impression_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'account_admin')
    )
  );

-- ── ad_revenue_logs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_revenue_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_impression_id  uuid        REFERENCES ad_impressions(id) ON DELETE SET NULL,
  ad_unit_id        uuid,
  network_id        uuid,
  placement_key     text,
  estimated_cpm     numeric(10,6),
  estimated_revenue numeric(10,8),
  currency          text        NOT NULL DEFAULT 'USD',
  ecpm_floor_used   numeric(10,6),
  winning_network   text,
  metadata          jsonb       NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ad_revenue_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ad_revenue_logs_created_at
  ON ad_revenue_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_revenue_logs_winning_network
  ON ad_revenue_logs (winning_network);
CREATE INDEX IF NOT EXISTS idx_ad_revenue_logs_placement_key
  ON ad_revenue_logs (placement_key);

CREATE POLICY "Admins can view all revenue logs"
  ON ad_revenue_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'account_admin')
    )
  );

CREATE POLICY "Authenticated users can insert revenue logs"
  ON ad_revenue_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ── Seed: native_grid placement ───────────────────────────────────────────────
INSERT INTO ad_placements (placement_key, placement_name, screen_name, ad_type, is_enabled, display_priority)
SELECT 'native_grid', 'Native Grid Ad', 'home', 'native', true, 5
WHERE NOT EXISTS (
  SELECT 1 FROM ad_placements WHERE placement_key = 'native_grid'
);

-- ── Seed: native network ──────────────────────────────────────────────────────
INSERT INTO ad_networks (network, api_key, app_id, is_active)
SELECT 'native', '', '', true
WHERE NOT EXISTS (
  SELECT 1 FROM ad_networks WHERE network = 'native'
);

-- ── Seed: monetag_web network ─────────────────────────────────────────────────
INSERT INTO ad_networks (network, api_key, app_id, is_active)
SELECT 'monetag_web', '', '', true
WHERE NOT EXISTS (
  SELECT 1 FROM ad_networks WHERE network = 'monetag_web'
);
