/*
  # Add New Web Ad Placements for AdSense and Monetag

  Expands the web_ad_config table to support additional ad formats:

  ## AdSense New Placements
    - `in_article` - In-Article / Native ad (auto-sized, placed between content paragraphs)
    - `anchor` - Anchor / Overlay ad (fixed bottom of viewport, dismissed by user)
    - `responsive_display` - Responsive Display ad (flexible, fills any container)
    - `multiplex` - Matched Content / Multiplex ad (content recommendation grid)

  ## Monetag New Placements
    - `push_notification` - Web Push Notification ads (user opt-in push campaigns)
    - `native_banner` - Native Banner (blends with site content style)
    - `onclick_popunder` - Onclick / Popunder (opens new tab on click)
    - `in_page_push` - In-Page Push (banner styled like push notification within page)
    - `vignette` - Vignette / Full-screen interstitial between page navigations

  ## Changes
    - ALTER TABLE to widen the placement CHECK constraint
    - INSERT new default (inactive) rows for each new placement
*/

ALTER TABLE web_ad_config
  DROP CONSTRAINT IF EXISTS web_ad_config_placement_check;

ALTER TABLE web_ad_config
  ADD CONSTRAINT web_ad_config_placement_check
  CHECK (placement IN (
    'sidebar',
    'banner_top',
    'banner_bottom',
    'interstitial_web',
    'in_feed',
    'in_article',
    'anchor',
    'responsive_display',
    'multiplex',
    'push_notification',
    'native_banner',
    'onclick_popunder',
    'in_page_push',
    'vignette'
  ));

INSERT INTO web_ad_config (network, slot_id, publisher_id, placement, is_active) VALUES
  ('adsense',     '', '', 'in_article',          false),
  ('adsense',     '', '', 'anchor',               false),
  ('adsense',     '', '', 'responsive_display',   false),
  ('adsense',     '', '', 'multiplex',            false),
  ('monetag_web', '', '', 'push_notification',    false),
  ('monetag_web', '', '', 'native_banner',        false),
  ('monetag_web', '', '', 'onclick_popunder',     false),
  ('monetag_web', '', '', 'in_page_push',         false),
  ('monetag_web', '', '', 'vignette',             false)
ON CONFLICT DO NOTHING;
