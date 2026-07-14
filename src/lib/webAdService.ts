/**
 * Web Ad Service — reads ad placements from Supabase and manages
 * which ads to show on the web frontend.
 *
 * Optimization: caches config in sessionStorage to avoid 3 DB queries
 * on every page load. Only re-fetches when cache expires.
 */
import { supabase } from "./supabase";
import {
  getAdSenseClient,
  normalizeAdSenseSlot,
  normalizeAdSensePublisherId,
} from "./adsense";
import { WEB_PLACEMENT_KEY_MAP } from "./webAdPlacements";

export type { WebAdPlacement } from "./webAdPlacements";
import type { WebAdPlacement } from "./webAdPlacements";

interface AdPlacement {
  id: string;
  placement_key: string;
  placement_name: string;
  ad_type: string;
  screen_name: string;
  position: string | null;
  display_priority: number | null;
  is_enabled: boolean;
  ad_unit_id: string | null;
  conditions: Record<string, unknown> | null;
}

interface AdNetworkRow {
  network: string;
  api_key: string | null;
  is_active: boolean;
}

interface AdUnit {
  id: string;
  unit_type: string;
  unit_id: string;
  placement: string;
  ecpm_floor: number | null;
  is_active: boolean;
  network_id?: string | null;
  ad_networks?: AdNetworkRow | AdNetworkRow[] | null;
}

export interface WebAdSenseDisplayConfig {
  client: string;
  slot: string;
  placementKey: string;
  placementName: string;
}

interface WebAdConfig {
  placements: AdPlacement[];
  units: AdUnit[];
  displayRules: { rule_type: string; rule_value: string }[];
  fetchedAt: number;
}

/** Returns true when running in a web browser (not a mobile webview / Capacitor). */
export const isWebTarget = (): boolean => {
  if (typeof window === "undefined") return false;
  if ((window as Window & { Capacitor?: unknown; cordova?: unknown }).Capacitor) return false;
  if ((window as Window & { cordova?: unknown }).cordova) return false;
  return true;
};

const SESSION_CACHE_KEY = "web_ad_config_v5";
const CACHE_TTL = 30 * 60 * 1000; // 30 min

interface WebAdDisplayRpcPayload {
  placements?: AdPlacement[];
  units?: AdUnit[];
  display_rules?: { rule_type: string; rule_value: string }[];
}

/** Map web UI slots to `ad_placements.placement_key` (shared admin templates). */
const PLACEMENT_MAP: Record<WebAdPlacement, { keys: string[]; fallbackType: string }> =
  Object.fromEntries(
    Object.entries(WEB_PLACEMENT_KEY_MAP).map(([slot, meta]) => [
      slot,
      { keys: meta.keys, fallbackType: slot === "interstitial_web" ? "interstitial" : "banner" },
    ])
  ) as Record<WebAdPlacement, { keys: string[]; fallbackType: string }>;

function networkRow(unit: AdUnit | null): AdNetworkRow | null {
  if (!unit?.ad_networks) return null;
  return Array.isArray(unit.ad_networks) ? unit.ad_networks[0] ?? null : unit.ad_networks;
}

export function isAdSenseNetwork(network: string | null | undefined): boolean {
  return (network ?? "").toLowerCase() === "adsense";
}

class WebAdService {
  private config: WebAdConfig | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private readyListeners: Array<() => void> = [];

  /** Call once at app startup (web builds). */
  async initialize(): Promise<void> {
    if (!isWebTarget()) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._load();
    return this.initPromise;
  }

  /** Subscribe to be notified when the service is ready. Returns unsubscribe fn. */
  onReady(cb: () => void): () => void {
    if (this.initialized) {
      cb();
      return () => {};
    }
    this.readyListeners.push(cb);
    return () => {
      this.readyListeners = this.readyListeners.filter((l) => l !== cb);
    };
  }

  private async _load(): Promise<void> {
    try {
      try {
        const cached = sessionStorage.getItem(SESSION_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as WebAdConfig;
          if (parsed.fetchedAt && Date.now() - parsed.fetchedAt < CACHE_TTL) {
            this.config = parsed;
            this.initialized = true;
            this.readyListeners.forEach((cb) => cb());
            this.readyListeners = [];
            return;
          }
        }
      } catch {
        /* sessionStorage may fail in private browsing */
      }

      const loaded = await this._loadFromRpc();
      if (!loaded) {
        await this._loadFromTables();
      }

      try {
        if (this.config) {
          sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(this.config));
        }
      } catch {
        /* ignore quota errors */
      }

      this.initialized = true;
    } catch (err) {
      console.warn("[WebAdService] Failed to load ad config:", err);
      this.config = { placements: [], units: [], displayRules: [], fetchedAt: Date.now() };
      this.initialized = true;
    }
    this.readyListeners.forEach((cb) => cb());
    this.readyListeners = [];
  }

  /** Anon-safe config via SECURITY DEFINER RPC. */
  private async _loadFromRpc(): Promise<boolean> {
    const { data, error } = await supabase.rpc("get_web_ad_display_config");
    if (error) {
      if (import.meta.env.DEV) {
        console.warn("[WebAdService] get_web_ad_display_config:", error.message);
      }
      return false;
    }

    const payload = data as WebAdDisplayRpcPayload | null;
    if (!payload || typeof payload !== "object") return false;

    this.config = {
      placements: (payload.placements ?? []).filter(
        (p) => p.is_enabled && p.placement_key.startsWith("web_")
      ),
      units: payload.units ?? [],
      displayRules: payload.display_rules ?? [],
      fetchedAt: Date.now(),
    };
    return true;
  }

  /** Fallback when RPC is not deployed (admin session may still read via RLS). */
  private async _loadFromTables(): Promise<void> {
    const [placementsRes, unitsRes, rulesRes] = await Promise.all([
      supabase
        .from("ad_placements")
        .select(
          "id, placement_key, placement_name, ad_type, screen_name, position, display_priority, is_enabled, ad_unit_id, conditions"
        )
        .eq("is_enabled", true),
      supabase
        .from("ad_units")
        .select(
          "id, unit_type, unit_id, placement, ecpm_floor, is_active, network_id, ad_networks(network, api_key, is_active)"
        )
        .eq("is_active", true),
      supabase.from("ad_display_rules").select("rule_type, rule_value").eq("is_enabled", true),
    ]);

    const placements = ((placementsRes.data ?? []) as AdPlacement[]).filter((p) =>
      p.placement_key.startsWith("web_")
    );

    this.config = {
      placements,
      units: (unitsRes.data ?? []) as AdUnit[],
      displayRules: (rulesRes.data ?? []) as { rule_type: string; rule_value: string }[],
      fetchedAt: Date.now(),
    };
  }

  getPlacementByKey(placementKey: string): AdPlacement | null {
    if (!this.config) return null;
    return (
      this.config.placements.find(
        (pl) => pl.placement_key === placementKey && pl.is_enabled
      ) ?? null
    );
  }

  getPlacementByKeys(keys: readonly string[]): AdPlacement | null {
    for (const key of keys) {
      const p = this.getPlacementByKey(key);
      if (p) return p;
    }
    return null;
  }

  getPlacement(slot: WebAdPlacement): AdPlacement | null {
    if (!this.config) return null;
    const mapping = PLACEMENT_MAP[slot];
    if (!mapping) return null;
    return this.getPlacementByKeys(mapping.keys);
  }

  private resolveAdSenseFromPlacement(
    placement: AdPlacement | null
  ): WebAdSenseDisplayConfig | null {
    if (!placement?.ad_unit_id) return null;

    const unit = this.getAdUnit(placement.ad_unit_id);
    if (!unit?.is_active) return null;

    const network = networkRow(unit);
    if (!network?.is_active || !isAdSenseNetwork(network.network)) return null;

    const fromNetwork = normalizeAdSensePublisherId(network.api_key);
    const pageClient = getAdSenseClient();
    const adSlot = normalizeAdSenseSlot(unit.unit_id);
    if (!adSlot) return null;
    if (!fromNetwork && !pageClient) return null;

    // `<head>` script uses VITE_ADSENSE_CLIENT_ID — ins tag must use the same publisher.
    const client =
      pageClient && fromNetwork && pageClient !== fromNetwork
        ? pageClient
        : (fromNetwork ?? pageClient!);

    if (pageClient && fromNetwork && pageClient !== fromNetwork && import.meta.env.DEV) {
      console.warn(
        `[WebAdService] AdSense publisher in Admin (${fromNetwork}) differs from site script (${pageClient}); using ${pageClient}.`
      );
    }

    return {
      client,
      slot: adSlot,
      placementKey: placement.placement_key,
      placementName: placement.placement_name,
    };
  }

  getAdUnit(adUnitId: string | null): AdUnit | null {
    if (!adUnitId || !this.config) return null;
    return this.config.units.find((u) => u.id === adUnitId) ?? null;
  }

  getAdSenseDisplayConfig(
    slot: WebAdPlacement,
    opts?: { placementKey?: string; placementKeys?: readonly string[] }
  ): WebAdSenseDisplayConfig | null {
    const placement =
      (opts?.placementKey && this.getPlacementByKey(opts.placementKey)) ||
      (opts?.placementKeys?.length && this.getPlacementByKeys(opts.placementKeys)) ||
      this.getPlacement(slot);
    return this.resolveAdSenseFromPlacement(placement);
  }

  shouldShowAds(): boolean {
    if (!this.config) return false;
    return this.config.placements.length > 0;
  }

  async recordImpression(
    placementKey: string,
    adType: string,
    userId?: string
  ): Promise<void> {
    try {
      await supabase.from("ad_impressions").insert({
        ad_type: adType,
        content_type: "web",
        user_id: userId ?? null,
        completed: true,
        is_eligible_for_reward: false,
      });
    } catch {
      /* non-critical */
    }
  }

  get isInitialized() {
    return this.initialized;
  }
}

export const webAdService = new WebAdService();
