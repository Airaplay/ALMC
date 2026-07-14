import { isWebTarget } from "./buildTarget";
import type { WebAdPlacement } from "./webAdPlacements";

/** Publisher ID (public). Matches vite `injectAdSenseHead` default. */
export const ADSENSE_CLIENT_ID =
  import.meta.env.VITE_ADSENSE_CLIENT_ID?.trim() || "ca-pub-4739421992298461";

declare global {
  interface Window {
    adsbygoogle?: Record<string, unknown>[];
  }
}

const envSlot = (key: string): string | undefined =>
  (import.meta.env[key] as string | undefined)?.trim() || undefined;

/** Per-placement slot IDs from AdSense → Ad units (numeric slot). */
const PLACEMENT_SLOT_ENV: Record<WebAdPlacement, string | undefined> = {
  sidebar: envSlot("VITE_ADSENSE_SLOT_SIDEBAR"),
  banner_top:
    envSlot("VITE_ADSENSE_SLOT_BANNER_TOP") ?? envSlot("VITE_ADSENSE_SLOT_MINI_PLAYER"),
  banner_bottom:
    envSlot("VITE_ADSENSE_SLOT_BANNER_BOTTOM") ??
    envSlot("VITE_ADSENSE_SLOT_PLAYER") ??
    envSlot("VITE_ADSENSE_SLOT_MUSIC_PLAYER"),
  in_feed: envSlot("VITE_ADSENSE_SLOT_IN_FEED"),
  interstitial_web: envSlot("VITE_ADSENSE_SLOT_INTERSTITIAL"),
};

const DEFAULT_SLOT = envSlot("VITE_ADSENSE_SLOT_DISPLAY");

export function getAdSenseClient(): string | null {
  if (!isWebTarget()) return null;
  return ADSENSE_CLIENT_ID || null;
}

/** Normalize DB `ad_units.unit_id` when it stores an AdSense slot (digits only). */
export function normalizeAdSenseSlot(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;
  return null;
}

/** `ad_networks.api_key` for network `adsense` → ca-pub-XXXXXXXX */
export function normalizeAdSensePublisherId(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  const match = s.match(/ca-pub-(\d+)/i);
  if (match) return `ca-pub-${match[1]}`;
  if (/^\d+$/.test(s)) return `ca-pub-${s}`;
  return null;
}

export interface AdSenseRenderParams {
  client: string;
  slot: string;
}

export function resolveAdSenseSlot(
  placement: WebAdPlacement,
  dbUnitId?: string | null
): string | null {
  if (!isWebTarget()) return null;
  return (
    normalizeAdSenseSlot(dbUnitId) ??
    PLACEMENT_SLOT_ENV[placement] ??
    DEFAULT_SLOT ??
    null
  );
}

/** Env-only fallback when Admin has not wired a placement yet. */
export function getEnvAdSenseParams(
  placement: WebAdPlacement,
  dbUnitId?: string | null
): AdSenseRenderParams | null {
  const client = getAdSenseClient();
  const slot = resolveAdSenseSlot(placement, dbUnitId);
  if (!client || !slot) return null;
  return { client, slot };
}

export function isAdSenseConfigured(
  placement: WebAdPlacement,
  dbUnitId?: string | null,
  admin?: AdSenseRenderParams | null
): boolean {
  if (admin?.client && admin?.slot) return true;
  return !!getEnvAdSenseParams(placement, dbUnitId);
}

export function resolveAdSenseParams(
  placement: WebAdPlacement,
  dbUnitId?: string | null,
  admin?: AdSenseRenderParams | null
): AdSenseRenderParams | null {
  if (admin?.client && admin?.slot) return admin;
  return getEnvAdSenseParams(placement, dbUnitId);
}

export function pushAdSenseRequest(): void {
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch {
    /* ad blockers / script not loaded */
  }
}
