import { isWebTarget } from "@/lib/buildTarget";
import { GA_MEASUREMENT_ID } from "./config";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let gaScriptPromise: Promise<void> | null = null;

/** Load GA4 after consent grants analytics_storage. */
export function loadGoogleAnalytics(): Promise<void> {
  if (!isWebTarget() || !GA_MEASUREMENT_ID) return Promise.resolve();
  if (document.querySelector(`script[data-airaplay-ga="${GA_MEASUREMENT_ID}"]`)) {
    return Promise.resolve();
  }
  if (gaScriptPromise) return gaScriptPromise;

  gaScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    script.setAttribute("data-airaplay-ga", GA_MEASUREMENT_ID);
    script.onload = () => {
      window.gtag?.("js", new Date());
      window.gtag?.("config", GA_MEASUREMENT_ID, { send_page_view: false });
      resolve();
    };
    script.onerror = () => reject(new Error("GA4 script failed to load"));
    document.head.appendChild(script);
  });

  return gaScriptPromise;
}

export function trackPageView(path: string, title?: string): void {
  if (!isWebTarget() || !GA_MEASUREMENT_ID || !window.gtag) return;
  window.gtag("event", "page_view", {
    page_path: path,
    page_title: title || document.title,
  });
}

export function updateAnalyticsConsent(granted: boolean): void {
  window.gtag?.("consent", "update", {
    analytics_storage: granted ? "granted" : "denied",
  });
  if (granted) {
    loadGoogleAnalytics().catch(() => {});
  }
}
