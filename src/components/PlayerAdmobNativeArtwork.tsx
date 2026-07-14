import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { NativeAdData } from '@brandonknudsen/admob-native-advanced';
import {
  configureNativeArtworkStyle,
  hideNativeArtworkOverlay,
  isNativeArtworkOverlayBlocked,
  positionNativeArtworkOverlay,
  subscribeNativeArtworkOverlayBlocked,
} from '../lib/admobNativeAdvancedService';
import { cn } from '../lib/utils';

interface PlayerAdmobNativeArtworkProps {
  ad: NativeAdData;
  className?: string;
  visible?: boolean;
}

export const PlayerAdmobNativeArtwork = ({
  ad,
  className = '',
  visible = true,
}: PlayerAdmobNativeArtworkProps): JSX.Element | null => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isNative = Capacitor.isNativePlatform();
  const [overlayBlocked, setOverlayBlocked] = useState(() => isNativeArtworkOverlayBlocked());

  const overlayActive = visible && !overlayBlocked;

  useEffect(() => {
    const syncBlocked = () => setOverlayBlocked(isNativeArtworkOverlayBlocked());
    syncBlocked();

    const unsubscribe = subscribeNativeArtworkOverlayBlocked(syncBlocked);

    const observer =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(syncBlocked)
        : null;
    observer?.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    return () => {
      unsubscribe();
      observer?.disconnect();
    };
  }, []);

  const positionOverlay = useCallback(() => {
    if (!isNative || !containerRef.current || !overlayActive) return;

    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    void positionNativeArtworkOverlay(ad.adId, {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, [ad.adId, isNative, overlayActive]);

  useEffect(() => {
    if (!isNative || !overlayActive) {
      if (isNative) {
        void hideNativeArtworkOverlay(ad.adId);
      }
      return;
    }

    void configureNativeArtworkStyle(ad.adId);

    const frameId = window.requestAnimationFrame(() => {
      positionOverlay();
    });

    const el = containerRef.current;
    const resizeObserver =
      el && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            positionOverlay();
          })
        : null;
    resizeObserver?.observe(el);

    const onScroll = () => positionOverlay();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      void hideNativeArtworkOverlay(ad.adId);
    };
  }, [ad.adId, isNative, overlayActive, positionOverlay]);

  return (
    <div
      ref={containerRef}
      className={cn('absolute inset-0 z-10 pointer-events-none', className)}
      aria-label={overlayActive ? 'Sponsored advertisement' : undefined}
      aria-hidden={!overlayActive}
    />
  );
};
