import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { BannerAdPosition } from '@capacitor-community/admob';
import { admobService } from '../lib/admobService';

const isNative = Capacitor.isNativePlatform();

const PLAYER_BANNER_REFRESH_MS_MIN = 30_000;
const PLAYER_BANNER_REFRESH_MS_MAX = 45_000;

function nextRefreshDelayMs(): number {
  return PLAYER_BANNER_REFRESH_MS_MIN + Math.random() * (PLAYER_BANNER_REFRESH_MS_MAX - PLAYER_BANNER_REFRESH_MS_MIN);
}

type ShowBannerFn = (
  placementKey?: string,
  position?: BannerAdPosition,
  context?: Record<string, unknown>,
  margin?: number
) => Promise<void>;

type HideBannerFn = (ownerPlacementKey?: string) => Promise<void>;

/**
 * Mounts the immersive-player bottom banner, optional periodic refresh (native), and cleanup.
 *
 * @param bottomMarginDp Passed through to `showBanner` (0 = flush bottom per `useAdPlacement` rules).
 * @param disablePeriodicRefresh When true, skip preload/refresh timers (initial show only).
 */
export function usePlayerBottomBanner(
  placementKey: string,
  showBanner: ShowBannerFn,
  hideBanner: HideBannerFn,
  getAdContext: () => { contentId?: string; contentType?: string },
  contextDeps: unknown[],
  isActive: boolean,
  bottomMarginDp?: number,
  disablePeriodicRefresh?: boolean
): void {
  const getAdContextRef = useRef(getAdContext);
  getAdContextRef.current = getAdContext;

  useEffect(() => {
    if (!isNative || !isActive) return;

    let cancelled = false;
    let preloadTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const runShow = () => {
      const ctx = getAdContextRef.current();
      return showBanner(placementKey, BannerAdPosition.BOTTOM_CENTER, ctx, bottomMarginDp);
    };

    void runShow().catch(() => {});

    const scheduleNext = () => {
      if (disablePeriodicRefresh || cancelled) return;
      const total = nextRefreshDelayMs();
      const preloadAt = Math.max(0, total - (5_000 + Math.random() * 5_000));
      preloadTimer = setTimeout(() => {
        if (cancelled) return;
        void admobService.preloadNextBannerRefresh();
      }, preloadAt);
      refreshTimer = setTimeout(() => {
        if (cancelled) return;
        void admobService
          .refreshBannerAd()
          .catch(() => {})
          .finally(() => {
            scheduleNext();
          });
      }, total);
    };

    if (!disablePeriodicRefresh) {
      scheduleNext();
    }

    return () => {
      cancelled = true;
      if (preloadTimer != null) window.clearTimeout(preloadTimer);
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      void hideBanner(placementKey).catch(() => {});
    };
    /* showBanner / hideBanner are stable useCallbacks from useAdPlacement; contextDeps are caller-driven */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contextDeps are the caller's content identity
  }, [isActive, placementKey, bottomMarginDp, disablePeriodicRefresh, hideBanner, showBanner, ...contextDeps]);
}
