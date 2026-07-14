import { supabase } from './supabase';

export type EarningsAccountType = 'listener' | 'creator';

export interface EarningsWithdrawalSettings {
  withdrawalsEnabled: boolean;
  minimumWithdrawalUsd: number;
  minimumWithdrawalUsdListener: number;
  minimumWithdrawalUsdCreator: number;
  accountType: EarningsAccountType;
  exchangeRate: number;
  withdrawalFeeType: 'percentage' | 'fixed';
  withdrawalFeeValue: number;
  exchangeRateLastUpdated: string | null;
}

const DEFAULTS: EarningsWithdrawalSettings = {
  withdrawalsEnabled: true,
  minimumWithdrawalUsd: 10,
  minimumWithdrawalUsdListener: 10,
  minimumWithdrawalUsdCreator: 10,
  accountType: 'listener',
  exchangeRate: 1,
  withdrawalFeeType: 'percentage',
  withdrawalFeeValue: 0,
  exchangeRateLastUpdated: null,
};

export const earningsAccountTypeLabel = (type?: EarningsAccountType | string): string =>
  type === 'creator' ? 'Creator / Artist' : 'Listener';

export const isCreatorRole = (role?: string | null): boolean =>
  role === 'creator' || role === 'admin';

export function resolveMinimumWithdrawalUsd(
  listenerMin: number,
  creatorMin: number,
  userRole?: string | null
): number {
  return isCreatorRole(userRole) ? creatorMin : listenerMin;
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeRpcRow(data: unknown): Record<string, unknown> | null {
  if (!data) return null;
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null;
  if (typeof data === 'object') return data as Record<string, unknown>;
  return null;
}

export function parseEarningsWithdrawalSettings(
  row: Record<string, unknown> | null,
  userRole?: string | null
): EarningsWithdrawalSettings {
  if (!row) return { ...DEFAULTS, accountType: isCreatorRole(userRole) ? 'creator' : 'listener' };

  const legacyMin = toNumber(row.minimum_withdrawal_usd, 10);
  const listenerMin = toNumber(row.minimum_withdrawal_usd_listener, legacyMin);
  const creatorMin = toNumber(row.minimum_withdrawal_usd_creator, legacyMin);
  const accountType: EarningsAccountType =
    row.account_type === 'creator' || isCreatorRole(userRole) ? 'creator' : 'listener';
  const rpcMin = toNumber(row.minimum_withdrawal_usd, NaN);
  const computedMin = resolveMinimumWithdrawalUsd(listenerMin, creatorMin, userRole);
  const hasDistinctThresholds = listenerMin !== creatorMin;
  const minimumWithdrawalUsd =
    userRole != null || hasDistinctThresholds
      ? computedMin
      : Number.isFinite(rpcMin)
        ? rpcMin
        : computedMin;

  return {
    withdrawalsEnabled: row.withdrawals_enabled !== false,
    minimumWithdrawalUsd,
    minimumWithdrawalUsdListener: listenerMin,
    minimumWithdrawalUsdCreator: creatorMin,
    accountType,
    exchangeRate: toNumber(row.exchange_rate, 1),
    withdrawalFeeType: row.withdrawal_fee_type === 'fixed' ? 'fixed' : 'percentage',
    withdrawalFeeValue: toNumber(row.withdrawal_fee_value, 0),
    exchangeRateLastUpdated: (row.exchange_rate_last_updated as string | null) ?? null,
  };
}

let cachedSettings: { value: EarningsWithdrawalSettings; role: string | null; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function fetchEarningsWithdrawalSettings(
  userRole?: string | null,
  opts?: { force?: boolean }
): Promise<EarningsWithdrawalSettings> {
  const roleKey = userRole ?? null;
  if (
    !opts?.force &&
    cachedSettings &&
    cachedSettings.role === roleKey &&
    Date.now() - cachedSettings.at < CACHE_TTL_MS
  ) {
    return cachedSettings.value;
  }

  try {
    const { data, error } = await supabase.rpc('get_earnings_withdrawal_settings');
    if (error) {
      console.warn('get_earnings_withdrawal_settings failed:', error.message);
      return parseEarningsWithdrawalSettings(null, userRole);
    }
    const parsed = parseEarningsWithdrawalSettings(normalizeRpcRow(data), userRole);
    cachedSettings = { value: parsed, role: roleKey, at: Date.now() };
    return parsed;
  } catch (err) {
    console.warn('get_earnings_withdrawal_settings error:', err);
    return parseEarningsWithdrawalSettings(null, userRole);
  }
}

export function clearEarningsWithdrawalSettingsCache(): void {
  cachedSettings = null;
}
