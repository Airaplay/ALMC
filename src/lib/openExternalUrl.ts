import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

/**
 * Normalize user/admin-entered URLs for opening in the system browser / new tab.
 */
export function normalizeExternalHref(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\/\//.test(t)) return `https:${t}`;
  return `https://${t}`;
}

/**
 * Open an external URL. On native WebViews, `window.open` is often blocked; use Capacitor Browser.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const href = normalizeExternalHref(url);
  if (!href) return;

  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url: href });
    return;
  }

  const opened = window.open(href, '_blank', 'noopener,noreferrer');
  if (!opened) {
    window.location.assign(href);
  }
}
