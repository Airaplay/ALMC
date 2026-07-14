import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw,
  Search,
  Headphones,
  Music,
  MousePointer,
  UserPlus,
  Gift,
  Coins,
  ArrowDownCircle,
  Wallet,
  Info,
  FileSpreadsheet,
  FileDown,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import type { ListenerLedgerExportPayload } from '../../lib/listenerLedgerExport.types';

type LedgerCategory =
  | 'listen_reward'
  | 'ad_interaction'
  | 'referral_reward'
  | 'bonus_campaign'
  | 'withdrawal'
  | 'other';

type LedgerEntry = {
  category: LedgerCategory;
  label: string;
  amount_usd: number | null;
  amount_treats: number | null;
  currency: string;
  occurred_at: string | null;
  ref_id: string;
};

type LedgerTotals = {
  songs_listened: number;
  ad_interactions: number;
  referral_rewards_treats: number;
  bonus_campaigns_treats: number;
  withdrawals_treats: number;
  withdrawals_usd: number;
};

type LedgerPayload = {
  success: boolean;
  error?: string;
  user?: {
    id: string;
    display_name: string | null;
    email: string | null;
    current_balance_treats: number;
    current_balance_usd: number;
  };
  totals?: LedgerTotals;
  entries?: LedgerEntry[];
};

type UserSearchRow = {
  id: string;
  display_name: string | null;
  email: string | null;
};

function formatSupabaseError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Request failed';
  const e = err as { message?: string; details?: string; hint?: string; code?: string };
  const parts = [e.message, e.details, e.hint].filter(Boolean);
  return parts.length ? parts.join(' — ') : 'Request failed';
}

function normalizeLedgerRpcData(data: unknown): LedgerPayload | null {
  if (data == null) return null;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as LedgerPayload;
    } catch {
      return null;
    }
  }
  if (Array.isArray(data) && data.length > 0) {
    return data[0] as LedgerPayload;
  }
  return data as LedgerPayload;
}

function formatLedgerWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'MMM d, yyyy HH:mm');
  } catch {
    return iso;
  }
}

const fmtUsd = (n: number | null | undefined): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(n ?? 0));

const fmtTreats = (n: number | null | undefined): string => {
  const v = Number(n ?? 0);
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} Treats`;
};

function ledgerToExportPayload(payload: LedgerPayload): ListenerLedgerExportPayload | null {
  if (!payload.user || !payload.totals) return null;
  return {
    user: payload.user,
    totals: payload.totals,
    entries: (payload.entries || []).map((e) => ({
      category: e.category,
      label: e.label,
      amount_usd: e.amount_usd,
      amount_treats: e.amount_treats,
      currency: e.currency,
      occurred_at: e.occurred_at,
      ref_id: e.ref_id,
    })),
  };
}

const categoryBadge = (c: LedgerCategory): string => {
  switch (c) {
    case 'listen_reward':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'ad_interaction':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    case 'referral_reward':
      return 'bg-violet-50 text-violet-800 border-violet-200';
    case 'bonus_campaign':
      return 'bg-sky-50 text-sky-800 border-sky-200';
    case 'withdrawal':
      return 'bg-rose-50 text-rose-800 border-rose-200';
    default:
      return 'bg-gray-50 text-gray-800 border-gray-200';
  }
};

export const ListenerEarningsLedgerSection = (): JSX.Element => {
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<UserSearchRow[]>([]);
  const [selected, setSelected] = useState<UserSearchRow | null>(null);
  const [ledger, setLedger] = useState<LedgerPayload | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const term = q.trim();
    if (term.length < 2) {
      setSearchHits([]);
      return;
    }
    setSearching(true);
    setError(null);
    const pattern = `%${term.replace(/%/g, '')}%`;

    try {
      let { data, error: qErr } = await supabase
        .from('users')
        .select('id, display_name, email, username')
        .or(`display_name.ilike.${pattern},email.ilike.${pattern},username.ilike.${pattern}`)
        .limit(25);

      if (qErr) {
        const retry = await supabase
          .from('users')
          .select('id, display_name, email')
          .or(`display_name.ilike.${pattern},email.ilike.${pattern}`)
          .limit(25);
        if (retry.error) throw retry.error;
        data = retry.data;
      }
      setSearchHits((data || []) as UserSearchRow[]);
    } catch (e) {
      console.error(e);
      setError(formatSupabaseError(e));
      setSearchHits([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      runSearch(search);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, runSearch]);

  const loadLedger = useCallback(async (userId: string) => {
    setLoadingLedger(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_get_listener_earnings_ledger', {
        p_user_id: userId,
      });
      if (rpcErr) throw rpcErr;
      const payload = normalizeLedgerRpcData(data);
      if (!payload) {
        setError('Empty response from ledger');
        setLedger(null);
        return;
      }
      if (!payload.success) {
        setError(payload.error ? String(payload.error) : 'Ledger request was not successful');
        setLedger(null);
        return;
      }
      if (!payload.user || !payload.totals) {
        setError('Incomplete ledger data from server (missing user or totals)');
        setLedger(null);
        return;
      }
      setLedger(payload);
    } catch (e) {
      console.error(e);
      setError(formatSupabaseError(e));
      setLedger(null);
    } finally {
      setLoadingLedger(false);
    }
  }, []);

  useEffect(() => {
    if (selected?.id) {
      void loadLedger(selected.id);
    } else {
      setLedger(null);
    }
  }, [selected?.id, loadLedger]);

  const totals = ledger?.totals;

  const handleExportExcel = useCallback(async () => {
    if (!ledger?.success || !ledger.user || !ledger.totals) return;
    const exportPayload = ledgerToExportPayload(ledger);
    if (!exportPayload) return;
    try {
      const { buildListenerExportFilenameBase, exportListenerLedgerExcel } = await import(
        '../../lib/listenerLedgerExport'
      );
      exportListenerLedgerExcel(exportPayload, buildListenerExportFilenameBase(ledger.user.display_name));
    } catch (e) {
      console.error('[ListenerEarningsLedger] Excel export failed:', e);
      setError('Could not load export tools. Try refreshing the page.');
    }
  }, [ledger]);

  const handleExportPdf = useCallback(async () => {
    if (!ledger?.success || !ledger.user || !ledger.totals) return;
    const exportPayload = ledgerToExportPayload(ledger);
    if (!exportPayload) return;
    try {
      const { buildListenerExportFilenameBase, exportListenerLedgerPdf } = await import(
        '../../lib/listenerLedgerExport'
      );
      exportListenerLedgerPdf(exportPayload, buildListenerExportFilenameBase(ledger.user.display_name));
    } catch (e) {
      console.error('[ListenerEarningsLedger] PDF export failed:', e);
      setError('Could not load export tools. Try refreshing the page.');
    }
  }, [ledger]);

  const canExport = Boolean(ledger?.success && ledger.user && ledger.totals && !loadingLedger);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-900 text-white flex items-center justify-center flex-shrink-0">
            <Headphones className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Listener Earnings Ledger</h2>
            <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
              Listen-to-earn transparency: songs listened, ad interactions, referral and bonus Treats, withdrawals, and
              balances. Treat rewards are in Treats; live balance (USD) reflects cash-out side when applicable.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          {canExport && (
            <>
              <button
                type="button"
                onClick={handleExportExcel}
                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg text-gray-800 text-sm shadow-sm"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                Export Excel
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg text-gray-800 text-sm shadow-sm"
              >
                <FileDown className="w-4 h-4 text-rose-700" />
                Export PDF
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => selected && loadLedger(selected.id)}
            disabled={!selected || loadingLedger}
            className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 text-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loadingLedger ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-3">
        <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-900">
          <span className="font-semibold">Why this matters.</span> Airaplay is listen-to-earn — users check earnings
          constantly. This view ties listening activity, ad interactions, referrals, bonus campaigns, and withdrawals to
          the same Treat wallet and live USD balance support and finance rely on.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Find listener (name, email, or username)
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Start typing…"
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#309605]/30 focus:border-[#309605]"
          />
        </div>
        {searching && <p className="text-xs text-gray-400 mt-2">Searching…</p>}
        {searchHits.length > 0 && (
          <ul className="mt-3 max-h-48 overflow-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
            {searchHits.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(row);
                    setSearchHits([]);
                    setSearch('');
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                    selected?.id === row.id ? 'bg-[#e6f7f1]' : ''
                  }`}
                >
                  <span className="font-medium text-gray-900">{row.display_name || 'Unknown'}</span>
                  <span className="text-gray-500"> · {row.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-lg text-red-800 text-sm">{error}</div>
      )}

      {selected && (
        <div className="text-sm text-gray-600">
          Selected: <span className="font-semibold text-gray-900">{selected.display_name}</span> ({selected.email})
        </div>
      )}

      {loadingLedger && (
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading ledger…
        </div>
      )}

      {ledger?.success && totals && ledger.user && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase">
                <Music className="w-3.5 h-3.5" /> Songs listened
              </div>
              <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{totals.songs_listened.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">Rows in listening history for this user</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase">
                <MousePointer className="w-3.5 h-3.5" /> Ad interactions
              </div>
              <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{totals.ad_interactions.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">Ad impression logs recorded for this user</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase">
                <UserPlus className="w-3.5 h-3.5" /> Referral rewards
              </div>
              <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{fmtTreats(totals.referral_rewards_treats)}</p>
              <p className="text-xs text-gray-400 mt-1">Sum of referral_bonus credits</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase">
                <Gift className="w-3.5 h-3.5" /> Bonus campaigns
              </div>
              <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{fmtTreats(totals.bonus_campaigns_treats)}</p>
              <p className="text-xs text-gray-400 mt-1">Bonus + daily check-in Treats</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4 flex items-start gap-3">
              <Coins className="w-5 h-5 text-amber-600 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Withdrawals (Treats)</p>
                <p className="text-lg font-bold text-gray-900">{fmtTreats(totals.withdrawals_treats)}</p>
                <p className="text-xs text-gray-400 mt-1">Total withdrawn from earned Treats (wallet)</p>
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4 flex items-start gap-3">
              <ArrowDownCircle className="w-5 h-5 text-rose-500 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Withdrawals (USD)</p>
                <p className="text-lg font-bold text-gray-900">{fmtUsd(totals.withdrawals_usd)}</p>
                <p className="text-xs text-gray-400 mt-1">Non-pending payout requests (cash/bank)</p>
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4 flex items-start gap-3">
              <Wallet className="w-5 h-5 text-[#309605] mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Current balance</p>
                <p className="text-lg font-bold text-gray-900">{fmtTreats(ledger.user.current_balance_treats)}</p>
                <p className="text-xs text-indigo-700 mt-1">Live balance (USD): {fmtUsd(ledger.user.current_balance_usd)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-semibold text-gray-900 shrink-0">Ledger (most recent 500)</h3>
              {canExport && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleExportExcel}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-md hover:bg-emerald-100"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Excel
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-rose-50 text-rose-900 border border-rose-200 rounded-md hover:bg-rose-100"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    PDF
                  </button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-500">
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(ledger.entries || []).map((row, idx) => {
                    const when = formatLedgerWhen(row.occurred_at);
                    const amt =
                      row.currency === 'USD'
                        ? fmtUsd(row.amount_usd ?? 0)
                        : fmtTreats(row.amount_treats ?? 0);
                    const cat = row.category as LedgerCategory;
                    return (
                      <tr key={`${row.ref_id}-${idx}`} className="border-t border-gray-50 hover:bg-gray-50/80">
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{when}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs border ${categoryBadge(cat)}`}
                          >
                            {String(cat).replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-800">{row.label}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-900">{amt}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {(ledger.entries || []).length === 0 && (
                <p className="px-4 py-8 text-center text-gray-500 text-sm">No ledger rows yet for this user.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
