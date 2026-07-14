/*
  # Web Ad Networks Configuration

  Adds configuration support for web-specific ad networks (Google AdSense and Monetag web banners).

  ## New Tables
    - `web_ad_config` - Stores AdSense and Monetag web configuration per slot
      - `id` (uuid, primary key)
      - `network` (text) - 'adsense' or 'monetag_web'
      - `slot_id` (text) - AdSense ad slot ID or Monetag zone ID
      - `publisher_id` (text) - AdSense publisher ID (ca-pub-XXXXX)
      - `placement` (text) - where this ad is shown: 'sidebar', 'banner_top', 'banner_bottom', 'interstitial_web'
      - `is_active` (boolean)
      - `created_at` / `updated_at`

  ## Security
    - RLS enabled
    - Admins can read/write
    - Authenticated users can read active configs (needed for client-side ad loading)
*/

CREATE TABLE IF NOT EXISTS web_ad_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network text NOT NULL CHECK (network IN ('adsense', 'monetag_web')),
  slot_id text NOT NULL DEFAULT '',
  publisher_id text NOT NULL DEFAULT '',
  placement text NOT NULL DEFAULT 'sidebar' CHECK (placement IN ('sidebar', 'banner_top', 'banner_bottom', 'interstitial_web', 'in_feed')),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE web_ad_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage web ad config"
  ON web_ad_config
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert web ad config"
  ON web_ad_config
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'account_admin')
    )
  );

CREATE POLICY "Admins can update web ad config"
  ON web_ad_config
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'account_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'account_admin')
    )
  );

CREATE POLICY "Admins can delete web ad config"
  ON web_ad_config
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'account_admin')
    )
  );

INSERT INTO web_ad_config (network, slot_id, publisher_id, placement, is_active) VALUES
  ('adsense', '', '', 'sidebar', false),
  ('adsense', '', '', 'banner_top', false),
  ('adsense', '', '', 'in_feed', false),
  ('monetag_web', '', '', 'banner_bottom', false),
  ('monetag_web', '', '', 'interstitial_web', false)
ON CONFLICT DO NOTHING;
