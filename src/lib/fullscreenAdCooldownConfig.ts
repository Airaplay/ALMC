import { supabase } from './supabase';

/** Default matching DB seed: 150s (2m 30s). */
export const DEFAULT_FULLSCREEN_AD_COOLDOWN_SECONDS = 150;
export const DEFAULT_FULLSCREEN_AD_COOLDOWN_MS =
  DEFAULT_FULLSCREEN_AD_COOLDOWN_SECONDS * 1000;

const MIN_SECONDS = 30;
const MAX_SECONDS = 600;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedMs: number | null = null;
let cachedAt = 0;
let refreshInFlight: Promise<number> | null = null;

function clampSeconds(sec: number): number {
  if (!Number.isFinite(sec)) return DEFAULT_FULLSCREEN_AD_COOLDOWN_SECONDS;
  return Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, Math.round(sec)));
}

/**
 * Milliseconds between fullscreen ads (interstitial / rewarded / rewarded interstitial).
 * Uses cached server value when available; refreshes in the background when stale.
 */
export function getFullscreenAdCooldownMsSync(): number {
  const now = Date.now();
  if (cachedMs == null) return DEFAULT_FULLSCREEN_AD_COOLDOWN_MS;
  if (now - cachedAt > CACHE_TTL_MS && !refreshInFlight) {
    refreshInFlight = refreshFullscreenAdCooldownConfig().finally(() => {
      refreshInFlight = null;
    });
  }
  return cachedMs;
}

/** Fetch from Supabase and update cache. Safe to call repeatedly. */
export async function refreshFullscreenAdCooldownConfig(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('app_ad_client_settings')
      .select('fullscreen_ad_cooldown_seconds')
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      cachedMs = DEFAULT_FULLSCREEN_AD_COOLDOWN_MS;
      cachedAt = Date.now();
      return cachedMs;
    }

    const ms = clampSeconds(data.fullscreen_ad_cooldown_seconds) * 1000;
    cachedMs = ms;
    cachedAt = Date.now();
    return ms;
  } catch {
    cachedMs = DEFAULT_FULLSCREEN_AD_COOLDOWN_MS;
    cachedAt = Date.now();
    return cachedMs;
  }
}

export function invalidateFullscreenAdCooldownCache(): void {
  cachedMs = null;
  cachedAt = 0;
}
