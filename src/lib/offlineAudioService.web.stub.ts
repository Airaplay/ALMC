/**
 * Web / Vercel build: no @capacitor/filesystem or @capacitor/preferences.
 * Real implementation is swapped in via vite.config for `VITE_APP_TARGET=app`.
 */

export interface OfflineSongMeta {
  songId: string;
  title: string;
  artist: string;
  coverImageUrl?: string | null;
  durationSeconds?: number | null;
}

export async function isOfflineAvailable(_songId: string): Promise<boolean> {
  return false;
}

export async function getOfflinePlaybackUrl(_songId: string): Promise<string | null> {
  return null;
}

export async function downloadOfflineSong(_meta: OfflineSongMeta, _audioUrl: string): Promise<void> {
  throw new Error('Offline downloads are only supported on Android native builds.');
}

export async function deleteOfflineSong(_songId: string): Promise<void> {
  // no-op on web
}

export async function listOfflineDownloads(): Promise<never[]> {
  return [];
}

export function subscribeOfflineDownloadsChanged(_cb: () => void): () => void {
  return () => {};
}

/** Web / Vercel: native offline downloads are app-only (see real module on Android). */
export function isOfflineDownloadPlatformSupported(): boolean {
  return false;
}
