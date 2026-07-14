import { supabase } from './supabase';
import { getOptimizedImageUrl } from './imageOptimization';

export interface NativeAdCard {
  id: string;
  title: string;
  description: string | null;
  image_url: string;
  companion_image_url?: string | null;
  companion_cta_text?: string | null;
  audio_url?: string | null;
  audio_insertion_interval_songs?: number | null;
  click_url: string;
  advertiser_name: string;
  placement_type: string;
  priority: number;
  is_active: boolean;
  impression_count: number;
  click_count: number;
  target_countries: string[] | null;
  target_genres: string[] | null;
  created_at: string;
  expires_at: string | null;
  placement_types?: string[] | null;
}

type NativeAdVariant = 'visual' | 'audio' | 'any';

const lastAudioAdPlaybackAtByPlacement = new Map<string, number>();
const audioAdRoundRobinIndexByPlacement = new Map<string, number>();
const completedSongCountByPlacement = new Map<string, number>();
const lastServedSongCountByAd = new Map<string, number>();
const AUDIO_AD_PLACEMENT_FALLBACKS: Record<string, string[]> = {
  music_player: ['music_player', 'music_player_popup'],
  album_player: ['album_player', 'album_player_popup'],
  playlist_player: ['playlist_player', 'playlist_player_popup'],
  daily_mix_player: ['daily_mix_player', 'daily_mix_player_popup'],
};

export interface GridItem {
  id: string;
  isAd: boolean;
  adData?: NativeAdCard;
  songData?: any;
}

/**
 * Fetch active native ads for a specific placement
 */
export async function getNativeAdsForPlacement(
  placementType: string,
  userCountry?: string | null,
  genreId?: string | null,
  limit: number = 10,
  adVariant: NativeAdVariant = 'visual'
): Promise<NativeAdCard[]> {
  try {
    const nowIso = new Date().toISOString();
    // Prefer dual-field matching so ads saved with placement_types[] are served
    // even when legacy placement_type does not match the active player surface.
    let { data, error } = await supabase
      .from('native_ad_cards')
      .select('*')
      .or(`placement_type.eq.${placementType},placement_types.cs.{${placementType}}`)
      .eq('is_active', true)
      .or('expires_at.is.null,expires_at.gt.' + nowIso)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    // Backward compatibility for databases that have not yet added placement_types.
    if (error && String(error.message || '').toLowerCase().includes("could not find the 'placement_types' column")) {
      const fallback = await supabase
        .from('native_ad_cards')
        .select('*')
        .eq('placement_type', placementType)
        .eq('is_active', true)
        .or('expires_at.is.null,expires_at.gt.' + nowIso)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error('Error fetching native ads:', error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Filter ads by targeting rules
    const filteredAds = data.filter((ad: NativeAdCard) => {
      const placements = ad.placement_types && ad.placement_types.length > 0
        ? ad.placement_types
        : [ad.placement_type];
      if (!placements.includes(placementType)) {
        return false;
      }

      // Filter by ad asset variant when requested.
      if (adVariant === 'audio') {
        if (!ad.audio_url || ad.audio_url.trim().length === 0) {
          return false;
        }
      } else if (adVariant === 'visual') {
        if (!ad.image_url || ad.image_url.trim().length === 0) {
          return false;
        }
        if (ad.audio_url && ad.audio_url.trim().length > 0) {
          return false;
        }
      }

      // Check country targeting
      if (ad.target_countries && ad.target_countries.length > 0 && userCountry) {
        if (!ad.target_countries.includes(userCountry)) {
          return false;
        }
      }

      // Check genre targeting
      if (ad.target_genres && ad.target_genres.length > 0 && genreId) {
        if (!ad.target_genres.includes(genreId)) {
          return false;
        }
      }

      return true;
    });

    return filteredAds;
  } catch (error) {
    console.error('Error in getNativeAdsForPlacement:', error);
    return [];
  }
}

/**
 * Record an impression for a native ad
 */
export async function recordNativeAdImpression(adId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('increment_native_ad_impression', {
      ad_id: adId
    });

    if (error) {
      console.error('Error recording native ad impression:', error);
    }
  } catch (error) {
    console.error('Error in recordNativeAdImpression:', error);
  }
}

/**
 * Record a click for a native ad
 */
export async function recordNativeAdClick(adId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('increment_native_ad_click', {
      ad_id: adId
    });

    if (error) {
      console.error('Error recording native ad click:', error);
    }
  } catch (error) {
    console.error('Error in recordNativeAdClick:', error);
  }
}

/**
 * Inject native ads into a content grid
 * @param items - Array of content items (songs, videos, etc.)
 * @param ads - Array of native ad cards
 * @param frequency - Insert an ad every N items (default: 6)
 * @param maxAds - Maximum number of ads to inject (default: unlimited)
 * @returns Array of items with ads injected at regular intervals
 */
export function injectAdsIntoGrid<T extends { id: string }>(
  items: T[],
  ads: NativeAdCard[],
  frequency: number = 6,
  maxAds?: number
): GridItem[] {
  if (!ads || ads.length === 0 || items.length === 0) {
    // No ads available or no items, return items as-is
    return items.map(item => ({
      id: item.id,
      isAd: false,
      songData: item
    }));
  }

  const result: GridItem[] = [];
  let adIndex = 0;
  let adsInjected = 0;

  for (let i = 0; i < items.length; i++) {
    // Add the content item
    result.push({
      id: items[i].id,
      isAd: false,
      songData: items[i]
    });

    // Check if we should inject an ad after this item
    const shouldInjectAd = (i + 1) % frequency === 0 &&
                          adIndex < ads.length &&
                          i < items.length - 1; // Don't inject ad after last item

    // Check maxAds limit
    const hasReachedMaxAds = maxAds !== undefined && adsInjected >= maxAds;

    if (shouldInjectAd && !hasReachedMaxAds) {
      const ad = ads[adIndex % ads.length]; // Cycle through ads if needed
      result.push({
        id: `ad-${ad.id}-${i}`,
        isAd: true,
        adData: ad
      });
      adIndex++;
      adsInjected++;
    }
  }

  return result;
}

/**
 * Get ad injection frequency based on admin configuration
 * Default is every 6 items if no config exists
 */
export async function getAdFrequencyConfig(): Promise<number> {
  try {
    // This could be extended to fetch from a configuration table
    // For now, return default value
    return 6;
  } catch (error) {
    console.error('Error fetching ad frequency config:', error);
    return 6; // Default fallback
  }
}

function normalizeAudioUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** True when the ad has a non-empty outbound URL for clicks (native ads may omit URL for awareness-only visuals). */
export function hasNativeAdClickUrl(clickUrl: string | null | undefined): boolean {
  return normalizeOptionalText(clickUrl) != null;
}

function normalizeAudioAdInterval(value: number | null | undefined): number {
  if (value == null) return 5;
  const rounded = Math.round(Number(value));
  if ([2, 3, 5, 6, 8, 10].includes(rounded)) return rounded;
  return 5;
}

function warmImageInBrowserCache(url: string | null): void {
  if (!url || typeof window === 'undefined') return;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = url;
  } catch {
    // Warming cache must never affect ad flow.
  }
}

const COMPANION_PRELOAD_LINK_ID = 'airaplay-audio-ad-companion-preload';

function setCompanionImagePreloadLink(url: string | null): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(COMPANION_PRELOAD_LINK_ID) as HTMLLinkElement | null;
  if (!url) {
    existing?.remove();
    return;
  }
  const link =
    existing ??
    (() => {
      const el = document.createElement('link');
      el.id = COMPANION_PRELOAD_LINK_ID;
      el.rel = 'preload';
      el.as = 'image';
      document.head.appendChild(el);
      return el;
    })();
  link.href = url;
}

function preloadImageUrl(url: string | null, timeoutMs: number): Promise<void> {
  if (!url) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    const t = window.setTimeout(done, timeoutMs);
    const img = new Image();
    img.onload = () => {
      window.clearTimeout(t);
      done();
    };
    img.onerror = () => {
      window.clearTimeout(t);
      done();
    };
    img.src = url;
  });
}

function waitAudioCanPlay(audio: HTMLAudioElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }
    const t = window.setTimeout(resolve, timeoutMs);
    const finish = () => {
      window.clearTimeout(t);
      resolve();
    };
    audio.addEventListener('canplay', finish, { once: true });
    audio.addEventListener('error', finish, { once: true });
    try {
      audio.load();
    } catch {
      finish();
    }
  });
}

/**
 * Warm likely companion art for a placement (e.g. when opening album player) so the first ad paints faster.
 */
export async function prefetchAudioAdCompanionForPlacement(
  placementType: string,
  userCountry?: string | null,
  genreId?: string | null
): Promise<void> {
  try {
    const candidatePlacements = AUDIO_AD_PLACEMENT_FALLBACKS[placementType] ?? [placementType];
    for (const candidatePlacement of candidatePlacements) {
      const ads = await getNativeAdsForPlacement(candidatePlacement, userCountry, genreId, 4, 'audio');
      const first = ads.find((item) => {
        const raw =
          normalizeOptionalText(item.companion_image_url) ?? normalizeOptionalText(item.image_url);
        return raw != null && !raw.includes('placehold.co');
      });
      if (!first) continue;
      const raw =
        normalizeOptionalText(first.companion_image_url) ?? normalizeOptionalText(first.image_url);
      if (!raw) continue;
      const opt = getOptimizedImageUrl(raw, {
        width: 768,
        height: 768,
        quality: 78,
        format: 'webp',
      });
      setCompanionImagePreloadLink(opt);
      warmImageInBrowserCache(opt);
      break;
    }
  } catch {
    // Prefetch must never throw.
  }
}

/**
 * Plays a native audio ad for a player placement and resolves when it ends/fails.
 * Returns true when an audio ad was attempted and completed naturally.
 */
export async function playNativeAudioAdForPlacement(
  placementType: string,
  userCountry?: string | null,
  genreId?: string | null,
  options?: {
    maxDurationMs?: number;
    minIntervalMs?: number;
  }
): Promise<boolean> {
  try {
    const now = Date.now();
    const minIntervalMs = options?.minIntervalMs ?? 45_000;
    const lastPlayedAt = lastAudioAdPlaybackAtByPlacement.get(placementType) ?? 0;
    if (now - lastPlayedAt < minIntervalMs) {
      return false;
    }
    const completedSongs = (completedSongCountByPlacement.get(placementType) ?? 0) + 1;
    completedSongCountByPlacement.set(placementType, completedSongs);

    const candidatePlacements = AUDIO_AD_PLACEMENT_FALLBACKS[placementType] ?? [placementType];
    let ad: NativeAdCard | undefined;

    for (const candidatePlacement of candidatePlacements) {
      const ads = await getNativeAdsForPlacement(candidatePlacement, userCountry, genreId, 5, 'audio');
      const eligibleAds = ads.filter((item) => {
        if (normalizeAudioUrl(item.audio_url) == null) return false;
        const interval = normalizeAudioAdInterval(item.audio_insertion_interval_songs);
        const adKey = `${placementType}:${item.id}`;
        const lastServedSongCount = lastServedSongCountByAd.get(adKey) ?? 0;
        return completedSongs - lastServedSongCount >= interval;
      });
      if (eligibleAds.length === 0) {
        continue;
      }

      const currentIndex = audioAdRoundRobinIndexByPlacement.get(candidatePlacement) ?? 0;
      const selectedIndex = currentIndex % eligibleAds.length;
      ad = eligibleAds[selectedIndex];
      audioAdRoundRobinIndexByPlacement.set(candidatePlacement, selectedIndex + 1);
      if (ad) {
        const selectedAdKey = `${placementType}:${ad.id}`;
        lastServedSongCountByAd.set(selectedAdKey, completedSongs);
      }
      if (ad) break;
    }

    if (!ad) {
      return false;
    }

    const audioUrl = normalizeAudioUrl(ad.audio_url);
    if (!audioUrl) return false;

    // Record impression right before playback attempt.
    void recordNativeAdImpression(ad.id);

    const companionImageUrl =
      normalizeOptionalText(ad.companion_image_url) ??
      normalizeOptionalText(ad.image_url);
    const companionClickUrl = normalizeOptionalText(ad.click_url);
    const companionCtaText = normalizeOptionalText(ad.companion_cta_text);
    const shouldSuppressCompanionImage =
      companionImageUrl != null && companionImageUrl.includes('placehold.co');
    const hasCompanionContent =
      (companionImageUrl != null && !shouldSuppressCompanionImage) ||
      companionClickUrl != null;

    const companionDisplayUrl =
      !shouldSuppressCompanionImage && companionImageUrl
        ? getOptimizedImageUrl(companionImageUrl, {
            width: 768,
            height: 768,
            quality: 78,
            format: 'webp',
          })
        : null;

    if (companionDisplayUrl) {
      setCompanionImagePreloadLink(companionDisplayUrl);
      warmImageInBrowserCache(companionDisplayUrl);
    }

    const showCompanionOverlay = () => {
      if (!hasCompanionContent) return;
      try {
        window.dispatchEvent(
          new CustomEvent('airaplay:audioAdCompanion', {
            detail: {
              action: 'show',
              ad: {
                id: ad.id,
                title: ad.title,
                advertiserName: ad.advertiser_name,
                imageUrl: companionDisplayUrl,
                clickUrl: companionClickUrl,
                ctaText: companionCtaText,
              },
            },
          })
        );
      } catch {
        // Companion UI should never block ad playback.
      }
    };
    const hideCompanionOverlay = () => {
      setCompanionImagePreloadLink(null);
      if (!hasCompanionContent) return;
      try {
        window.dispatchEvent(
          new CustomEvent('airaplay:audioAdCompanion', {
            detail: {
              action: 'hide',
              adId: ad.id,
            },
          })
        );
      } catch {
        // Companion UI should never block ad playback.
      }
    };

    const adAudio = new Audio(audioUrl);
    adAudio.preload = 'auto';

    await Promise.race([
      Promise.all([
        preloadImageUrl(companionDisplayUrl, 6000),
        waitAudioCanPlay(adAudio, 6000),
      ]),
      new Promise<void>((r) => window.setTimeout(r, 2000)),
    ]);

    const maxDurationMs = options?.maxDurationMs ?? 35_000;

    const completed = await new Promise<boolean>((resolve) => {
      let settled = false;

      const cleanup = () => {
        adAudio.removeEventListener('ended', onEnded);
        adAudio.removeEventListener('error', onError);
        window.clearTimeout(timeoutId);
        hideCompanionOverlay();
      };

      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const onEnded = () => {
        settle(true);
      };

      const onError = () => {
        settle(false);
      };

      const timeoutId = window.setTimeout(() => {
        try {
          adAudio.pause();
        } catch {
          // Ignore pause failures.
        }
        settle(false);
      }, maxDurationMs);

      adAudio.addEventListener('ended', onEnded, { once: true });
      adAudio.addEventListener('error', onError, { once: true });

      adAudio.play().catch(() => {
        settle(false);
      });
      showCompanionOverlay();
    });

    if (completed) {
      lastAudioAdPlaybackAtByPlacement.set(placementType, Date.now());
    }

    return completed;
  } catch (error) {
    console.error('Error playing native audio ad:', error);
    return false;
  }
}

/**
 * Reset audio ad cadence counters for a placement.
 * This is useful when the playback context changes (e.g. switching from playlist to album),
 * so "play after N songs" starts counting from the new session rather than a previous one.
 */
export function resetNativeAudioAdCadenceForPlacement(placementType: string): void {
  completedSongCountByPlacement.set(placementType, 0);
  lastAudioAdPlaybackAtByPlacement.delete(placementType);
  audioAdRoundRobinIndexByPlacement.delete(placementType);

  // Remove per-ad counters for this placement (keys are `${placementType}:${adId}`).
  const prefix = `${placementType}:`;
  for (const key of Array.from(lastServedSongCountByAd.keys())) {
    if (key.startsWith(prefix)) {
      lastServedSongCountByAd.delete(key);
    }
  }
}
