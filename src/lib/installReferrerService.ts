import { Capacitor, registerPlugin } from '@capacitor/core';

export const AIRPLAY_OPEN_HOSTS = new Set(['airaplay.com', 'www.airaplay.com']);

type InstallReferrerResult = {
  consumed?: boolean;
  referralCode?: string;
  referrerUrl?: string;
};

type InstallReferrerPlugin = {
  getInstallReferrer: () => Promise<InstallReferrerResult>;
};

const InstallReferrer = registerPlugin<InstallReferrerPlugin>('InstallReferrer');

export const ANDROID_PACKAGE_ID = 'com.airaplay.app';

export const PLAY_STORE_LISTING_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_ID}&hl=en`;

export const getPlayStoreReferralUrl = (referralCode: string): string => {
  const referrerPayload = `ref=${encodeURIComponent(referralCode)}`;
  return `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_ID}&referrer=${encodeURIComponent(referrerPayload)}`;
};

/** Parse `open=<https deeplink>` from Play install referrer blob (stored as referrerUrl query fragment). */
export function parseOpenFromReferrerBlob(referrerBlob: string | null | undefined): string | null {
  if (!referrerBlob || typeof referrerBlob !== 'string') return null;
  const trimmed = referrerBlob.trim();
  if (!trimmed) return null;
  try {
    const qIdx = trimmed.indexOf('?');
    const qs = qIdx >= 0 ? trimmed.slice(qIdx + 1) : trimmed;
    const params = new URLSearchParams(qs.startsWith('&') ? qs.slice(1) : qs);
    const raw = params.get('open');
    if (!raw) return null;
    const rawOpen = raw.trim();
    // URLSearchParams.get already applies one decode; avoid decodeURIComponent doubling it unnecessarily.
    if (/^https?:\/\//i.test(rawOpen)) return rawOpen;
    try {
      const once = decodeURIComponent(rawOpen).trim();
      if (/^https?:\/\//i.test(once)) return once;
    } catch {
      /* ignore */
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns SPA internal path (/song/id, ...) for an Airaplay HTTPS open link, if safe.
 */
export function airaplayOpenUrlToInternalPath(openUrl: string): string | null {
  try {
    const u = new URL(openUrl);
    if (!AIRPLAY_OPEN_HOSTS.has(u.hostname)) return null;
    const path = `${u.pathname}${u.search || ''}`;
    return path.startsWith('/') ? path : `/${path}`;
  } catch {
    return null;
  }
}

export type InstallReferrerDeferredRoute = {
  referralCode: string | null;
  /** From install referrer parameter `open=` (full https URL into the app/web). */
  openDeepLink: string | null;
};

/** Session flag: Play install-referrer deferred navigation was applied (or attempted once). Prevents re-applying on every `location.search` change after `?ref=` is stripped. */
const DEFERRED_INSTALL_REFERRER_DONE_KEY = 'aira_deferred_install_referrer_done_v1';
const DEFERRED_INSTALL_REFERRER_LOCK_KEY = 'aira_deferred_install_referrer_lock_v1';

export const hasDeferredInstallReferrerBeenHandled = (): boolean => {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DEFERRED_INSTALL_REFERRER_DONE_KEY) === '1';
  } catch {
    return false;
  }
};

export const markDeferredInstallReferrerHandled = (): void => {
  try {
    sessionStorage.setItem(DEFERRED_INSTALL_REFERRER_DONE_KEY, '1');
  } catch {
    /* ignore */
  }
};

/** Returns true if this call acquired the lock (caller must release after await). */
export const tryAcquireDeferredInstallReferrerLock = (): boolean => {
  try {
    if (typeof sessionStorage === 'undefined') return true;
    if (sessionStorage.getItem(DEFERRED_INSTALL_REFERRER_LOCK_KEY) === '1') return false;
    sessionStorage.setItem(DEFERRED_INSTALL_REFERRER_LOCK_KEY, '1');
    return true;
  } catch {
    return false;
  }
};

export const releaseDeferredInstallReferrerLock = (): void => {
  try {
    sessionStorage.removeItem(DEFERRED_INSTALL_REFERRER_LOCK_KEY);
  } catch {
    /* ignore */
  }
};

/**
 * One-shot deferred routing after Android install — reads `open=` Play Store referrer and/or legacy `ref=`.
 */
export const consumeInstallReferrerDeferredRoutes = async (): Promise<InstallReferrerDeferredRoute> => {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return { referralCode: null, openDeepLink: null };
  }

  try {
    const result = await InstallReferrer.getInstallReferrer();
    const ref = typeof result?.referralCode === 'string' ? result.referralCode.trim() : '';
    const openFromBlob = parseOpenFromReferrerBlob(result?.referrerUrl);
    return {
      referralCode: ref || null,
      openDeepLink: openFromBlob && /^https?:\/\//i.test(openFromBlob) ? openFromBlob.trim() : null,
    };
  } catch (error) {
    console.warn('[InstallReferrer] Failed to read install referrer', error);
    return { referralCode: null, openDeepLink: null };
  }
};

/**
 * Legacy helper: referral code only (for flows that ignore `open=`).
 */
export const consumeInstallReferrerCode = async (): Promise<string | null> => {
  const { referralCode } = await consumeInstallReferrerDeferredRoutes();
  return referralCode;
};
