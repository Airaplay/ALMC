/**
 * Canonical AdMob placement keys for bottom banners.
 * Main tab surfaces (Home, Explore, Library, Profile, …) must use {@link MAIN_APP_BOTTOM_BANNER_PLACEMENT} only.
 * Full-screen audio players use {@link FULL_SCREEN_PLAYER_BOTTOM_BANNER_KEYS} — separate placement keys; ad unit may match {@link DEFAULT_BOTTOM_BANNER_AD_UNIT_ID} when configured.
 */

/** Default native bottom banner AdMob ad unit (fallback when `VITE_ADMOB_BANNER_ID` is unset; keep in sync with production env). */
export const DEFAULT_BOTTOM_BANNER_AD_UNIT_ID = 'ca-app-pub-4739421992298461/3774323540' as const;

/** Default rewarded interstitial unit (fallback when `VITE_ADMOB_REWARDED_INTERSTITIAL_ID` is unset). */
export const DEFAULT_REWARDED_INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-4739421992298461/3122096164' as const;

/** Google sample rewarded interstitial (dev / emulators). */
export const GOOGLE_TEST_REWARDED_INTERSTITIAL_AD_UNIT_ID =
  'ca-app-pub-3940256099942544/5354046379' as const;

/**
 * Resolved AdMob rewarded interstitial ad unit — env + defaults only (no Supabase).
 * Use for init, hooks, and preload so this format never depends on `ad_placements`.
 */
export function resolveRewardedInterstitialAdUnitId(): string {
  const fromEnv = import.meta.env.VITE_ADMOB_REWARDED_INTERSTITIAL_ID?.trim();
  if (fromEnv) return fromEnv;
  if (import.meta.env.MODE === 'development') {
    return GOOGLE_TEST_REWARDED_INTERSTITIAL_AD_UNIT_ID;
  }
  return DEFAULT_REWARDED_INTERSTITIAL_AD_UNIT_ID;
}

export const MAIN_APP_BOTTOM_BANNER_PLACEMENT = 'main_app_bottom_banner' as const;

export const FULL_SCREEN_PLAYER_BOTTOM_BANNER_KEYS = [
  'music_player_bottom_banner',
  'playlist_player_bottom_banner',
  'album_player_bottom_banner',
  'daily_mix_player_bottom_banner',
] as const;

export type FullScreenPlayerBottomBannerKey = (typeof FULL_SCREEN_PLAYER_BOTTOM_BANNER_KEYS)[number];

export function isFullScreenPlayerBottomBannerKey(
  placementKey: string | undefined | null
): placementKey is FullScreenPlayerBottomBannerKey {
  if (!placementKey) return false;
  return (FULL_SCREEN_PLAYER_BOTTOM_BANNER_KEYS as readonly string[]).includes(placementKey);
}

/** Full-screen modals that call `showBanner` over the native surface; closing must restore the player/tab banner underneath. */
export const OVERLAY_MODAL_BANNER_PLACEMENT_KEYS = [
  'tipping_modal_bottom_banner',
  'treat_withdrawal_modal_bottom_banner',
  'comments_modal_bottom_banner',
] as const;

export function isOverlayModalBannerPlacementKey(key: string | undefined | null): boolean {
  if (!key) return false;
  return (OVERLAY_MODAL_BANNER_PLACEMENT_KEYS as readonly string[]).includes(key);
}
