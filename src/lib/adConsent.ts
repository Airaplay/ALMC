import { isWebTarget } from "@/lib/buildTarget";
import { loadGoogleAnalytics, updateAnalyticsConsent } from "@/lib/seo/analytics";

const ADSENSE_CLIENT_ID =
  import.meta.env.VITE_ADSENSE_CLIENT_ID?.trim() || "ca-pub-4739421992298461";

const STORAGE_KEY = "airaplay_ad_consent_v1";
const CONSENT_VERSION = 1;

export type AdConsentChoice = "granted" | "denied";

interface StoredAdConsent {
  version: number;
  ads: AdConsentChoice;
  updatedAt: number;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

type ConsentListener = (ads: AdConsentChoice | null) => void;

const listeners = new Set<ConsentListener>();
let scriptPromise: Promise<void> | null = null;

function emit(ads: AdConsentChoice | null): void {
  listeners.forEach((cb) => cb(ads));
}

function readStorage(): StoredAdConsent | null {
  if (!isWebTarget()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAdConsent;
    if (parsed?.version !== CONSENT_VERSION) return null;
    if (parsed.ads !== "granted" && parsed.ads !== "denied") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(ads: AdConsentChoice): void {
  const payload: StoredAdConsent = {
    version: CONSENT_VERSION,
    ads,
    updatedAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function updateGoogleConsent(ads: AdConsentChoice): void {
  window.gtag?.("consent", "update", {
    ad_storage: ads === "granted" ? "granted" : "denied",
    ad_user_data: ads === "granted" ? "granted" : "denied",
    ad_personalization: ads === "granted" ? "granted" : "denied",
  });
}

function adSenseScriptSelector(client: string): string {
  return `script[data-airaplay-adsense="${client}"]`;
}

/** Load `adsbygoogle.js` only after the user grants ad consent. */
export function loadAdSenseScript(client: string = ADSENSE_CLIENT_ID): Promise<void> {
  if (!isWebTarget() || !client) {
    return Promise.resolve();
  }

  if (document.querySelector(adSenseScriptSelector(client))) {
    return Promise.resolve();
  }

  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    script.dataset.airaplayAdsense = client;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load AdSense script"));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export function getStoredAdConsent(): AdConsentChoice | null {
  return readStorage()?.ads ?? null;
}

export function isAdConsentGranted(): boolean {
  return getStoredAdConsent() === "granted";
}

export function shouldPromptForAdConsent(): boolean {
  return isWebTarget() && getStoredAdConsent() === null;
}

export function subscribeAdConsent(listener: ConsentListener): () => void {
  listeners.add(listener);
  listener(getStoredAdConsent());
  return () => listeners.delete(listener);
}

export function grantAdConsent(): void {
  if (!isWebTarget()) return;
  writeStorage("granted");
  updateGoogleConsent("granted");
  updateAnalyticsConsent(true);
  emit("granted");
  void loadAdSenseScript().catch(() => {
    /* non-critical — units retry on mount */
  });
  void loadGoogleAnalytics().catch(() => {});
}

export function denyAdConsent(): void {
  if (!isWebTarget()) return;
  writeStorage("denied");
  updateGoogleConsent("denied");
  updateAnalyticsConsent(false);
  emit("denied");
}

/** Re-open preferences (e.g. from footer). Clears stored choice and shows banner again. */
export function resetAdConsent(): void {
  if (!isWebTarget()) return;
  localStorage.removeItem(STORAGE_KEY);
  updateGoogleConsent("denied");
  emit(null);
}

export async function ensureAdSenseReady(): Promise<boolean> {
  if (!isWebTarget() || !isAdConsentGranted()) return false;
  try {
    await loadAdSenseScript();
    return true;
  } catch {
    return false;
  }
}
