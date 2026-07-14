import { Capacitor } from '@capacitor/core';
import {
  AdMobNativeAdvanced,
  type NativeAdData,
} from '@brandonknudsen/admob-native-advanced';
import { resolveNativeArtworkAdUnitId } from './adPlacementConstants';

const isNative = Capacitor.isNativePlatform();

/** Matches AndroidManifest APPLICATION_ID — no Supabase lookup for Native Advanced init. */
const ADMOB_APP_ID = 'ca-app-pub-4739421992298461~4630726757';

let initPromise: Promise<void> | null = null;

/** Ref-count + body modal classes — native overlays sit above the WebView and must be hidden for modals. */
let nativeArtworkOverlaySuspendCount = 0;
const nativeArtworkOverlayBlockedListeners = new Set<() => void>();

function notifyNativeArtworkOverlayBlockedChanged(): void {
  nativeArtworkOverlayBlockedListeners.forEach((listener) => listener());
}

export function isNativeArtworkOverlayBlocked(): boolean {
  if (typeof document === 'undefined') return nativeArtworkOverlaySuspendCount > 0;

  const body = document.body;
  return (
    nativeArtworkOverlaySuspendCount > 0 ||
    body.classList.contains('modal-open') ||
    body.classList.contains('auth-modal-open') ||
    body.classList.contains('create-playlist-modal-open')
  );
}

/** Hide native artwork overlays while a modal/sheet is open. Returns release function. */
export function suspendNativeArtworkOverlay(): () => void {
  nativeArtworkOverlaySuspendCount += 1;
  notifyNativeArtworkOverlayBlockedChanged();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    nativeArtworkOverlaySuspendCount = Math.max(0, nativeArtworkOverlaySuspendCount - 1);
    notifyNativeArtworkOverlayBlockedChanged();
  };
}

export function subscribeNativeArtworkOverlayBlocked(listener: () => void): () => void {
  nativeArtworkOverlayBlockedListeners.add(listener);
  return () => {
    nativeArtworkOverlayBlockedListeners.delete(listener);
  };
}

export async function ensureAdMobNativeAdvancedReady(): Promise<boolean> {
  if (!isNative) return false;

  if (!initPromise) {
    initPromise = AdMobNativeAdvanced.initialize({ appId: ADMOB_APP_ID }).catch((err) => {
      initPromise = null;
      console.warn('[AdMobNativeAdvanced] initialize failed', err);
      throw err;
    });
  }

  try {
    await initPromise;
    return true;
  } catch {
    return false;
  }
}

export async function loadNativeArtworkAd(): Promise<NativeAdData | null> {
  if (!isNative) return null;

  const ready = await ensureAdMobNativeAdvancedReady();
  if (!ready) return null;

  const adUnitId = resolveNativeArtworkAdUnitId();

  try {
    return await AdMobNativeAdvanced.loadAd({ adUnitId });
  } catch (err) {
    console.warn('[AdMobNativeAdvanced] loadAd failed', err);
    return null;
  }
}

export async function reportNativeArtworkClick(adId: string): Promise<void> {
  if (!isNative) return;
  try {
    await AdMobNativeAdvanced.reportClick({ adId } as never);
  } catch (err) {
    console.warn('[AdMobNativeAdvanced] reportClick failed', err);
  }
}

export async function reportNativeArtworkImpression(adId: string): Promise<void> {
  if (!isNative) return;
  try {
    await AdMobNativeAdvanced.reportImpression({ adId } as never);
  } catch (err) {
    console.warn('[AdMobNativeAdvanced] reportImpression failed', err);
  }
}

export async function hideNativeArtworkOverlay(adId: string): Promise<void> {
  if (!isNative) return;
  try {
    await AdMobNativeAdvanced.hideNativeAd({ adId });
  } catch {
    // ignore
  }
}

export async function positionNativeArtworkOverlay(
  adId: string,
  rect: { x: number; y: number; width: number; height: number }
): Promise<void> {
  if (!isNative) return;
  try {
    await AdMobNativeAdvanced.positionNativeAd({
      adId,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  } catch (err) {
    console.warn('[AdMobNativeAdvanced] positionNativeAd failed', err);
  }
}

export async function configureNativeArtworkStyle(adId: string): Promise<void> {
  if (!isNative) return;
  try {
    await AdMobNativeAdvanced.configureNativeAdStyle({
      adId,
      style: {
        backgroundColor: '#0a0a0a',
        cornerRadius: 16,
        borderWidth: 0,
        headlineColor: '#ffffff',
        bodyColor: '#cccccc',
        advertiserColor: '#999999',
        ctaBackgroundColor: '#00ad74',
        ctaTextColor: '#ffffff',
        headlineFontSize: 14,
        bodyFontSize: 12,
        advertiserFontSize: 10,
        ctaFontSize: 13,
        ctaMinHeight: 40,
      },
    });
  } catch {
    // ignore
  }
}
