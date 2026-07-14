import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Stable per-install identifier (not hardware ID).
 * Used only for anti-Sybil aggregation on the server.
 */
export function getOrCreateDeviceId(): string | null {
  const key = 'airaplay_device_id_v1';

  // Native: store in Capacitor Preferences (more durable than localStorage in WebView).
  try {
    if (Capacitor.isNativePlatform()) {
      // Preferences is async; we keep a sync cache via localStorage when available.
      // If localStorage is unavailable, caller gets null and server-side falls back gracefully.
      // (Most contribution calls happen in UI contexts where localStorage exists.)
      const storage = getStorage();
      const cached = storage?.getItem(key);
      if (cached && cached.length >= 16) return cached;
      const id = randomId();
      void Preferences.set({ key, value: id });
      storage?.setItem(key, id);
      return id;
    }
  } catch {
    /* ignore */
  }

  // Web: localStorage
  const storage = getStorage();
  if (!storage) return null;
  const existing = storage.getItem(key);
  if (existing && existing.length >= 16) return existing;
  const id = randomId();
  storage.setItem(key, id);
  return id;
}

export function getBestEffortUserAgent(): string | null {
  try {
    return typeof navigator !== 'undefined' ? navigator.userAgent : null;
  } catch {
    return null;
  }
}

let cachedPublicIp: string | null = null;
let publicIpFetchPromise: Promise<string | null> | null = null;

/** Best-effort client IP for anti-Sybil metadata; never throws. */
export async function getBestEffortPublicIp(): Promise<string | null> {
  if (cachedPublicIp) return cachedPublicIp;
  if (publicIpFetchPromise) return publicIpFetchPromise;

  publicIpFetchPromise = (async () => {
    if (typeof window === 'undefined') return null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch('https://api.ipify.org?format=json', {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const payload = (await response.json()) as { ip?: string };
      cachedPublicIp = typeof payload.ip === 'string' ? payload.ip : null;
      return cachedPublicIp;
    } catch {
      return null;
    } finally {
      publicIpFetchPromise = null;
    }
  })();

  return publicIpFetchPromise;
}

