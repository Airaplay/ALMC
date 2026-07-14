import { useEffect } from 'react';
import { suspendNativeArtworkOverlay } from '../lib/admobNativeAdvancedService';

/** Hides AdMob Native Advanced artwork overlays while this component is mounted (native layer is above WebView). */
export function useNativeArtworkOverlaySuspend(active = true): void {
  useEffect(() => {
    if (!active) return;
    return suspendNativeArtworkOverlay();
  }, [active]);
}
