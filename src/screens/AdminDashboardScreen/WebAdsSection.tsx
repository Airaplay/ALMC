import { useEffect, useMemo, useState } from "react";
import { Check, AlertTriangle, Globe, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  WEB_PLACEMENT_KEY_MAP,
  WEB_RELEVANT_PLACEMENT_KEYS,
} from "../../lib/webAdPlacements";
import { WEB_AD_SURFACE_MAP } from "../../lib/webAdPlacementKeys";
import { isAdSenseNetwork } from "../../lib/webAdService";
import type { WebAdPlacement } from "../../lib/webAdPlacements";

interface AdNetworkRow {
  id: string;
  network: string;
  api_key: string;
  app_id: string;
  is_active: boolean;
}

interface PlacementRow {
  id: string;
  placement_key: string;
  placement_name: string;
  screen_name: string;
  ad_type: string;
  is_enabled: boolean;
  ad_unit_id: string | null;
  ad_units?: {
    id: string;
    unit_id: string;
    unit_type: string;
    is_active: boolean;
    ad_networks?: { network: string; api_key: string; is_active: boolean } | null;
  } | null;
}

const WEB_SLOTS: WebAdPlacement[] = [
  "banner_top",
  "banner_bottom",
  "in_feed",
  "sidebar",
  "interstitial_web",
];

export const WebAdsSection = (): JSX.Element => {
  const [networks, setNetworks] = useState<AdNetworkRow[]>([]);
  const [placements, setPlacements] = useState<PlacementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [netRes, placeRes] = await Promise.all([
        supabase.from("ad_networks").select("id, network, api_key, app_id, is_active").order("network"),
        supabase
          .from("ad_placements")
          .select(
            `
            id, placement_key, placement_name, screen_name, ad_type, is_enabled, ad_unit_id,
            ad_units (
              id, unit_id, unit_type, is_active,
              ad_networks ( network, api_key, is_active )
            )
          `
          )
          .in("placement_key", WEB_RELEVANT_PLACEMENT_KEYS)
          .order("placement_key"),
      ]);

      if (netRes.error) throw netRes.error;
      if (placeRes.error) throw placeRes.error;
      setNetworks((netRes.data as AdNetworkRow[]) ?? []);
      setPlacements((placeRes.data as PlacementRow[]) ?? []);
    } catch (e) {
      console.error(e);
      setError("Failed to load web ad configuration");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const adsenseNetwork = useMemo(
    () => networks.find((n) => isAdSenseNetwork(n.network)),
    [networks]
  );

  const slotStatus = useMemo(() => {
    return WEB_SLOTS.map((slot) => {
      const meta = WEB_PLACEMENT_KEY_MAP[slot];
      const match = placements.find(
        (p) => meta.keys.includes(p.placement_key) && p.is_enabled
      );
      const unit = match?.ad_units;
      const net = unit?.ad_networks;
      const wired =
        !!match &&
        !!unit?.is_active &&
        !!net?.is_active &&
        isAdSenseNetwork(net.network) &&
        /^\d+$/.test(unit.unit_id?.trim() ?? "") &&
        /ca-pub-\d+/i.test(net.api_key ?? "");

      return {
        slot,
        label: meta.label,
        keys: meta.keys.join(", "),
        placement: match,
        wired,
      };
    });
  }, [placements]);

  const wiredCount = slotStatus.filter((s) => s.wired).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Globe className="w-5 h-5 text-[#309605]" />
            Web ads (Google AdSense)
          </h3>
          <p className="text-gray-600 text-sm mt-1 max-w-2xl">
            The website uses <strong>AdSense</strong> with <code className="text-xs bg-gray-100 px-1 rounded">web_*</code>{" "}
            placement keys. The Android/iOS app keeps existing keys (e.g.{" "}
            <code className="text-xs bg-gray-100 px-1 rounded">music_player_bottom_banner</code>) for{" "}
            <strong>AdMob</strong> — no conflict.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{error}</div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="p-4 bg-white border border-gray-200 rounded-xl">
          <h4 className="font-semibold text-gray-900 mb-2">1. Ad network</h4>
          {adsenseNetwork ? (
            <div className="flex items-start gap-2 text-sm text-gray-700">
              <Check className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <div>
                <p>
                  <span className="font-medium capitalize">{adsenseNetwork.network}</span>
                  {adsenseNetwork.is_active ? " (active)" : " (inactive)"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Publisher ID: <code>{adsenseNetwork.api_key || "—"}</code>
                </p>
                <p className="text-xs text-gray-500">Site label: {adsenseNetwork.app_id || "—"}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p>
                Add an <strong>Ad Network</strong> with type <code>adsense</code>. Set API Key to your publisher ID
                (e.g. <code>ca-pub-4739421992298461</code>).
              </p>
            </div>
          )}
        </div>

        <div className="p-4 bg-white border border-gray-200 rounded-xl">
          <h4 className="font-semibold text-gray-900 mb-2">2. Coverage</h4>
          <p className="text-2xl font-bold text-[#309605]">
            {wiredCount} / {WEB_SLOTS.length}
          </p>
          <p className="text-xs text-gray-500 mt-1">web UI slots with an enabled AdSense placement + unit</p>
        </div>
      </div>

      <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 space-y-2">
        <p className="font-semibold text-gray-900">Setup (once)</p>
        <ol className="list-decimal list-inside space-y-1 text-gray-600">
          <li>
            <strong>Ad Networks</strong> → Add <code>adsense</code>, API Key = <code>ca-pub-…</code>
          </li>
          <li>
            <strong>Ad Units</strong> → Network = AdSense, Unit ID = numeric slot from AdSense → Ads → By ad unit,
            Type = <code>banner</code> or <code>adsense</code>
          </li>
          <li>
            <strong>Placements</strong> → Create <strong>web_*</strong> rows (templates under “Web” in Placements tab), link AdSense units
          </li>
        </ol>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="p-3 font-medium text-gray-700">Web slot</th>
              <th className="p-3 font-medium text-gray-700">DB placement keys</th>
              <th className="p-3 font-medium text-gray-700">Active placement</th>
              <th className="p-3 font-medium text-gray-700">AdSense unit</th>
              <th className="p-3 font-medium text-gray-700">Status</th>
            </tr>
          </thead>
          <tbody>
            {slotStatus.map((row) => (
              <tr key={row.slot} className="border-t border-gray-200">
                <td className="p-3 font-medium text-gray-900">{row.label}</td>
                <td className="p-3 text-gray-600 text-xs font-mono">{row.keys}</td>
                <td className="p-3 text-gray-700">
                  {row.placement ? (
                    <>
                      {row.placement.placement_name}
                      <br />
                      <span className="text-xs font-mono text-gray-500">{row.placement.placement_key}</span>
                    </>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="p-3 text-gray-700 font-mono text-xs">
                  {row.placement?.ad_units?.unit_id ?? "—"}
                </td>
                <td className="p-3">
                  {row.wired ? (
                    <span className="inline-flex items-center gap-1 text-green-700 text-xs font-medium">
                      <Check className="w-3 h-3" /> Live on web
                    </span>
                  ) : (
                    <span className="text-amber-700 text-xs">Not configured</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-xl">
        <h4 className="p-3 bg-gray-100 font-semibold text-gray-900 border-b border-gray-200">
          Where ads appear on the website
        </h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-3 font-medium text-gray-700">Surface</th>
              <th className="p-3 font-medium text-gray-700">Route / context</th>
              <th className="p-3 font-medium text-gray-700">Web placement key</th>
              <th className="p-3 font-medium text-gray-700">App key (reference)</th>
              <th className="p-3 font-medium text-gray-700">Status</th>
            </tr>
          </thead>
          <tbody>
            {WEB_AD_SURFACE_MAP.map((row) => {
              const p = placements.find(
                (pl) => pl.placement_key === row.placementKey && pl.is_enabled
              );
              const unit = p?.ad_units;
              const net = unit?.ad_networks;
              const wired =
                !!p &&
                !!unit?.is_active &&
                !!net?.is_active &&
                isAdSenseNetwork(net.network) &&
                /^\d+$/.test(unit.unit_id?.trim() ?? "") &&
                /ca-pub-\d+/i.test(net.api_key ?? "");

              return (
                <tr key={`${row.surface}-${row.placementKey}`} className="border-t border-gray-200">
                  <td className="p-3 text-gray-900">{row.surface}</td>
                  <td className="p-3 text-gray-600 text-xs">{row.routeOrContext}</td>
                  <td className="p-3 font-mono text-xs text-gray-700">{row.placementKey}</td>
                  <td className="p-3 font-mono text-xs text-gray-400">{row.nativeKeyHint}</td>
                  <td className="p-3">
                    {wired ? (
                      <span className="text-green-700 text-xs font-medium">Live</span>
                    ) : (
                      <span className="text-amber-700 text-xs">Not wired</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Optional env fallback: <code>VITE_ADSENSE_SLOT_DISPLAY</code> only when Admin has no row for that slot.
        Reuse one AdSense unit on multiple <code>web_*</code> rows if you want (e.g. all use <code>web_home_screen_banner</code>).
      </p>
    </div>
  );
};
