import { useCallback, useEffect, useState } from 'react';
import { admobService } from '../lib/admobService';
import {
  getActivePlacement,
  getActivePlacementsForScreen,
  checkPlacementConditions,
  AdPlacement,
} from '../lib/adPlacementService';
import { resolveRewardedInterstitialAdUnitId } from '../lib/adPlacementConstants';
import { BannerAdPosition } from '@capacitor-community/admob';

// Global fullscreen ad cooldown so fullscreen ads (rewarded or interstitial) never appear too frequently across screens
const FULLSCREEN_AD_COOLDOWN_MS = 3.5 * 60 * 1000; // 3 minutes 30 seconds
let lastFullscreenAdTime = 0;
let fullscreenAdLock = false;

/**
 * Hook to easily manage ad placements in screens
 * 
 * @example
 * // In a screen component
 * const { showBanner, showInterstitial, showRewarded } = useAdPlacement('MusicPlayerScreen');
 * 
 * useEffect(() => {
 *   // Show banner on mount
 *   showBanner();
 * }, []);
 */
export function useAdPlacement(screenName?: string) {
  const [placements, setPlacements] = useState<AdPlacement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!screenName) {
      setIsLoading(false);
      return;
    }

    const loadPlacements = async () => {
      try {
        const screenPlacements = await getActivePlacementsForScreen(screenName);
        setPlacements(screenPlacements);
      } catch (error) {
        console.error('Failed to load ad placements:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadPlacements();
  }, [screenName]);

  /**
   * Show a banner ad by placement key or screen.
   * Revenue is attributed per song: when the ad is shown during song playback, always pass
   * context: { contentId: song.id, contentType: 'song' } so each ad impression is tied to that song.
   * margin: optional, in dp; for BOTTOM_CENTER = offset from bottom (e.g. 64 = just above nav+mini).
   *
   * Automatically adds margin for BOTTOM_CENTER position to prevent overlap with navigation bar.
   *
   * Stable reference (useCallback) so effects like `usePlayerBottomBanner` do not re-run on unrelated
   * re-renders (e.g. isPlaying) — otherwise cleanup calls hideBanner and an immediate show can be
   * skipped by admobService's same-unit throttle, leaving the banner hidden.
   */
  const showBanner = useCallback(
    async (
      placementKey?: string,
      position: BannerAdPosition = BannerAdPosition.BOTTOM_CENTER,
      context?: Record<string, any>,
      margin?: number
    ) => {
      try {
        // Automatically add margin for bottom banners to prevent overlap with navigation bar
        // Navigation bar is 72dp high
        let finalMargin = margin;
        if (finalMargin === undefined && position === BannerAdPosition.BOTTOM_CENTER) {
          finalMargin = 72; // 72dp = navigation bar height
        }

        // Keyed placements: admobService resolves the unit (single getActivePlacement + skip duplicate work in hook).
        if (placementKey) {
          await admobService.showBanner(
            position,
            context?.contentId,
            context?.contentType || 'general',
            placementKey,
            undefined,
            finalMargin
          );
          return;
        }

        let placement: AdPlacement | null = null;
        if (screenName && placements.length > 0) {
          placement = placements.find(p => p.ad_type === 'banner' && checkPlacementConditions(p, context || {})) || null;
        }

        if (!placement || placement.ad_type !== 'banner') {
          console.warn('No banner placement found for screen/conditions, falling back to default banner config');
          await admobService.showBanner(
            position,
            context?.contentId,
            context?.contentType || 'general',
            undefined,
            undefined,
            finalMargin
          );
          return;
        }

        await admobService.showBanner(
          position,
          context?.contentId,
          context?.contentType || 'general',
          placement.placement_key,
          placement.ad_unit_id || undefined,
          finalMargin
        );
      } catch (error) {
        console.error('Failed to show banner:', error);
      }
    },
    [screenName, placements]
  );

  /**
   * Show an interstitial ad by placement key or screen
   */
  const showInterstitial = useCallback(
    async (
      placementKey?: string,
      context?: Record<string, any>,
      options?: { muteAppAudio?: boolean }
    ) => {
      try {
        const now = Date.now();
        if (fullscreenAdLock || (now - lastFullscreenAdTime) < FULLSCREEN_AD_COOLDOWN_MS) {
          console.log('Fullscreen ad skipped by cooldown (interstitial).');
          return;
        }
        fullscreenAdLock = true;

        let placement: AdPlacement | null = null;

        if (placementKey) {
          placement = await getActivePlacement(placementKey);
        } else if (screenName && placements.length > 0) {
          placement = placements.find(p => p.ad_type === 'interstitial' && checkPlacementConditions(p, context || {})) || null;
        }

        if (placementKey && (!placement || placement.ad_type !== 'interstitial')) {
          await admobService.showInterstitial(
            context?.contentId,
            context?.contentType || 'general',
            placementKey,
            undefined,
            options
          );
          lastFullscreenAdTime = Date.now();
          return;
        }

        if (!placement || placement.ad_type !== 'interstitial') {
          console.warn('No interstitial placement found');
          return;
        }

        await admobService.showInterstitial(
          context?.contentId,
          context?.contentType || 'general',
          placement.placement_key,
          placement.ad_unit_id || undefined,
          options
        );
        lastFullscreenAdTime = Date.now();
      } catch (error) {
        console.error('Failed to show interstitial:', error);
      } finally {
        fullscreenAdLock = false;
      }
    },
    [screenName, placements]
  );

  /**
   * Show a rewarded ad by placement key or screen
   */
  const showRewarded = useCallback(
    async (placementKey?: string, context?: Record<string, any>): Promise<void> => {
      try {
        const now = Date.now();
        if (fullscreenAdLock || (now - lastFullscreenAdTime) < FULLSCREEN_AD_COOLDOWN_MS) {
          console.log('Fullscreen ad skipped by cooldown (rewarded).');
          return;
        }
        fullscreenAdLock = true;

        let placement: AdPlacement | null = null;

        if (placementKey) {
          placement = await getActivePlacement(placementKey);
        } else if (screenName && placements.length > 0) {
          placement = placements.find(p => p.ad_type === 'rewarded' && checkPlacementConditions(p, context || {})) || null;
        }

        if (placementKey && (!placement || placement.ad_type !== 'rewarded')) {
          await admobService.showRewardedAd(
            context?.contentId,
            context?.contentType || 'general',
            placementKey,
            undefined
          );
          lastFullscreenAdTime = Date.now();
          return;
        }

        if (!placement || placement.ad_type !== 'rewarded') {
          console.warn('No rewarded placement found');
          return;
        }

        await admobService.showRewardedAd(
          context?.contentId,
          context?.contentType || 'general',
          placement.placement_key,
          placement.ad_unit_id || undefined
        );
        lastFullscreenAdTime = Date.now();
      } catch (error) {
        console.error('Failed to show rewarded ad:', error);
      } finally {
        fullscreenAdLock = false;
      }
    },
    [screenName, placements]
  );

  /**
   * Song bonus card: uses placement key `song_bonus_rewarded` for analytics and
   * explicit `VITE_ADMOB_REWARDED_ID` when set (see admobService direct pub id path).
   */
  const showSongBonusRewarded = useCallback(async (context: { contentId: string }): Promise<void> => {
    try {
      const now = Date.now();
      if (fullscreenAdLock || (now - lastFullscreenAdTime) < FULLSCREEN_AD_COOLDOWN_MS) {
        console.log('Fullscreen ad skipped by cooldown (song bonus rewarded).');
        return;
      }
      fullscreenAdLock = true;
      const unitId = import.meta.env.VITE_ADMOB_REWARDED_ID?.trim();
      await admobService.showRewardedAd(
        context.contentId,
        'song',
        'song_bonus_rewarded',
        unitId
      );
      lastFullscreenAdTime = Date.now();
    } catch (error) {
      console.error('Failed to show song bonus rewarded:', error);
    } finally {
      fullscreenAdLock = false;
    }
  }, []);

  /**
   * Rewarded interstitial uses env + {@link resolveRewardedInterstitialAdUnitId} only (no `ad_placements` / Supabase).
   * `placementKey` is optional metadata for impression logging (e.g. `between_songs_rewarded_interstitial`).
   */
  const showRewardedInterstitial = useCallback(
    async (
      placementKey?: string,
      context?: Record<string, any>,
      options?: { muteAppAudio?: boolean }
    ): Promise<void> => {
      try {
        const now = Date.now();
        if (fullscreenAdLock || (now - lastFullscreenAdTime) < FULLSCREEN_AD_COOLDOWN_MS) {
          console.log('Fullscreen ad skipped by cooldown (rewarded interstitial).');
          return;
        }
        fullscreenAdLock = true;

        const unitId = resolveRewardedInterstitialAdUnitId();
        await admobService.showRewardedInterstitial(
          context?.contentId,
          context?.contentType || 'general',
          placementKey,
          unitId,
          options
        );
        lastFullscreenAdTime = Date.now();
      } catch (error) {
        console.error('Failed to show rewarded interstitial:', error);
        throw error;
      } finally {
        fullscreenAdLock = false;
      }
    },
    []
  );

  /**
   * Hide banner ad. Safe to call when no banner is shown; never throws.
   * Returns a Promise so callers can await hide before show (avoids race where hide completes after show).
   */
  const hideBanner = useCallback((ownerPlacementKey?: string): Promise<void> => {
    return admobService.hideBannerOwnedBy(ownerPlacementKey).catch(() => {});
  }, []);

  /**
   * Remove banner ad. Safe to call when no banner is shown; never throws.
   */
  const removeBanner = useCallback((ownerPlacementKey?: string) => {
    admobService.removeBannerOwnedBy(ownerPlacementKey).catch(() => {});
  }, []);

  /** Show either an interstitial or a rewarded ad at random; single lock/cooldown so they never clash. Resolves when ad is dismissed. */
  const showInterstitialOrRewarded = useCallback(
    (
      options?: {
        contentId?: string;
        contentType?: string;
        interstitialPlacementKey?: string;
        rewardedPlacementKey?: string;
        rewardedInterstitialPlacementKey?: string;
        preferRewardedInterstitial?: boolean;
      }
    ): Promise<void> => {
      return admobService.showInterstitialOrRewarded(options ?? {}).catch(() => {});
    },
    []
  );

  return {
    placements,
    isLoading,
    showBanner,
    showInterstitial,
    showRewarded,
    showSongBonusRewarded,
    showRewardedInterstitial,
    showInterstitialOrRewarded,
    hideBanner,
    removeBanner,
  };
}


