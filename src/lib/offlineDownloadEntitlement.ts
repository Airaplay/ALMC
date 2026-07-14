import { supabase } from './supabase';

export const DEFAULT_OFFLINE_DOWNLOAD_MONTHLY_COST_TREATS = 300;

export interface OfflineDownloadStatus {
  active: boolean;
  expiresAt: string | null;
  monthlyCostTreats: number;
}

function parseExpiresAt(raw: unknown): string | null {
  if (raw == null || raw === 'null') return null;
  if (typeof raw === 'string') return raw;
  return null;
}

function parseStatus(data: unknown): OfflineDownloadStatus {
  const o = data as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') {
    return {
      active: false,
      expiresAt: null,
      monthlyCostTreats: DEFAULT_OFFLINE_DOWNLOAD_MONTHLY_COST_TREATS,
    };
  }
  const active = o.active === true;
  const expiresAt = parseExpiresAt(o.expires_at);
  const rawCost = o.monthly_cost_treats;
  let cost = DEFAULT_OFFLINE_DOWNLOAD_MONTHLY_COST_TREATS;
  if (typeof rawCost === 'number') {
    cost = rawCost;
  } else if (typeof rawCost === 'string') {
    const n = Number(rawCost);
    if (!Number.isNaN(n)) cost = n;
  }
  return { active, expiresAt, monthlyCostTreats: cost };
}

export async function fetchOfflineDownloadStatus(): Promise<OfflineDownloadStatus> {
  const { data, error } = await supabase.rpc('get_offline_download_status');
  if (error) {
    console.warn('[offlineDownload] get_offline_download_status', error);
    return {
      active: false,
      expiresAt: null,
      monthlyCostTreats: DEFAULT_OFFLINE_DOWNLOAD_MONTHLY_COST_TREATS,
    };
  }
  return parseStatus(data);
}

export async function subscribeOfflineDownloadMonthly(): Promise<{
  success: boolean;
  error?: string;
  required?: number;
  balance?: number;
  expiresAt?: string | null;
}> {
  const { data, error } = await supabase.rpc('subscribe_offline_download_monthly');
  if (error) {
    return { success: false, error: error.message };
  }
  const o = data as Record<string, unknown> | null;
  if (!o) {
    return { success: false, error: 'no_data' };
  }
  if (o.success === false) {
    return {
      success: false,
      error: typeof o.error === 'string' ? o.error : 'subscription_failed',
      required: typeof o.required === 'number' ? o.required : undefined,
      balance: typeof o.balance === 'number' ? o.balance : undefined,
    };
  }
  if (o.success !== true) {
    return { success: false, error: 'unexpected_response' };
  }
  return {
    success: true,
    expiresAt: parseExpiresAt(o.expires_at),
  };
}

type ShowConfirm = (options: {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger' | 'warning';
}) => Promise<boolean>;

type ShowAlert = (
  optionsOrMessage:
    | string
    | {
        title?: string;
        message: string;
        type?: 'info' | 'success' | 'error' | 'warning';
      },
  type?: 'info' | 'success' | 'error' | 'warning'
) => void;

export async function ensureOfflineDownloadAllowedWithPaywall(
  showConfirm: ShowConfirm,
  showAlert: ShowAlert
): Promise<boolean> {
  const status = await fetchOfflineDownloadStatus();
  if (status.active) return true;

  const cost = status.monthlyCostTreats;
  const ok = await showConfirm({
    title: 'Offline downloads',
    message: `Offline downloads require an active subscription. Pay ${cost} Treats once to unlock 30 days of access. Renewing early stacks extra time.`,
    confirmText: `Pay ${cost} Treats`,
    cancelText: 'Not now',
    variant: 'default',
  });
  if (!ok) return false;

  const res = await subscribeOfflineDownloadMonthly();
  if (!res.success) {
    if (res.error === 'insufficient_treats') {
      showAlert({
        title: 'Not enough Treats',
        message: `You need ${res.required ?? cost} Treats to unlock offline downloads. Your balance is ${res.balance ?? 0}.`,
        type: 'warning',
      });
    } else {
      showAlert({
        title: 'Could not unlock',
        message: res.error ?? 'Something went wrong. Try again.',
        type: 'error',
      });
    }
    return false;
  }

  showAlert({
    title: 'Offline downloads unlocked',
    message: 'You can download songs for the next 30 days.',
    type: 'success',
  });
  return true;
}
