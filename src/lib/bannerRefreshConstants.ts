/** Policy-aligned range for rotating banner creatives (AdMob-friendly; avoids fixed sync across users). */
export const BANNER_AUTO_REFRESH_MIN_MS = 30_000;
export const BANNER_AUTO_REFRESH_MAX_MS = 45_000;

/** Preloaded resolution must be consumed before this age so a stale config is not applied after long delays. */
export const BANNER_PRELOAD_PARAMS_MAX_AGE_MS = 25_000;

export function getNextBannerAutoRefreshDelayMs(): number {
  return BANNER_AUTO_REFRESH_MIN_MS + Math.random() * (BANNER_AUTO_REFRESH_MAX_MS - BANNER_AUTO_REFRESH_MIN_MS);
}

// Main tab (Home/Explore/Library/Profile) banners use the same 30–45s policy-safe cadence.
export const MAIN_TAB_BANNER_AUTO_REFRESH_MIN_MS = 30_000;
export const MAIN_TAB_BANNER_AUTO_REFRESH_MAX_MS = 45_000;

export function getNextMainTabBannerAutoRefreshDelayMs(): number {
  return MAIN_TAB_BANNER_AUTO_REFRESH_MIN_MS + Math.random() * (MAIN_TAB_BANNER_AUTO_REFRESH_MAX_MS - MAIN_TAB_BANNER_AUTO_REFRESH_MIN_MS);
}

/**
 * How long before the scheduled refresh we resolve placement/ad unit (and any display rules)
 * so the native `loadAd` at swap time is not blocked on network.
 * AdMob policy: refresh interval remains 30–45s; this only shifts work earlier within that window.
 */
export const BANNER_PRELOAD_LEAD_MIN_MS = 5_000;
export const BANNER_PRELOAD_LEAD_MAX_MS = 10_000;

export function getBannerPreloadLeadTimeMs(refreshDelayMs: number): number {
  const span = BANNER_PRELOAD_LEAD_MAX_MS - BANNER_PRELOAD_LEAD_MIN_MS;
  const jitter = BANNER_PRELOAD_LEAD_MIN_MS + Math.random() * span;
  const maxLead = Math.max(0, refreshDelayMs - 1_000);
  return Math.max(500, Math.min(Math.floor(jitter), maxLead));
}
