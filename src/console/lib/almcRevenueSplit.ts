export type AlmcSplitSettings = {
  orgSplitPct: number;
  artistSplitPct: number;
  override: number | null;
};

export type AlmcRevenueBreakdown = {
  gross: number;
  orgShare: number;
  artistShare: number;
  orgSplitPct: number;
  artistSplitPct: number;
};

export const ALMC_ORG_SPLIT_KEY = 'almc_org_split_org_pct';
export const ALMC_ARTIST_OVERRIDES_KEY = 'almc_artist_split_overrides';

export function clampSplitPct(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

export function parseOrgSettingsSplit(settings: Record<string, unknown> | null | undefined): {
  orgSplitPct: number;
  overrides: Record<string, number>;
} {
  const orgSplitPct = clampSplitPct(settings?.[ALMC_ORG_SPLIT_KEY], 0);
  const raw = settings?.[ALMC_ARTIST_OVERRIDES_KEY];
  const overrides: Record<string, number> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [artistId, pct] of Object.entries(raw as Record<string, unknown>)) {
      if (pct === null || pct === undefined || pct === '') continue;
      overrides[artistId] = clampSplitPct(pct, orgSplitPct);
    }
  }
  return { orgSplitPct, overrides };
}

export function resolveArtistSplit(
  orgSplitPct: number,
  override: number | null | undefined
): AlmcSplitSettings {
  const effective = override === null || override === undefined ? orgSplitPct : clampSplitPct(override, orgSplitPct);
  return {
    orgSplitPct: effective,
    artistSplitPct: 100 - effective,
    override: override === null || override === undefined ? null : clampSplitPct(override, orgSplitPct),
  };
}

export function applyRevenueSplit(gross: number, orgSplitPct: number): AlmcRevenueBreakdown {
  const safeGross = Number.isFinite(gross) ? gross : 0;
  const pct = clampSplitPct(orgSplitPct, 0);
  const orgShare = Math.round(safeGross * (pct / 100) * 100) / 100;
  const artistShare = Math.round(safeGross * ((100 - pct) / 100) * 100) / 100;
  return {
    gross: safeGross,
    orgShare,
    artistShare,
    orgSplitPct: pct,
    artistSplitPct: 100 - pct,
  };
}
