import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw,
  Search,
  ScrollText,
  Music,
  DollarSign,
  Gift,
  UserPlus,
  Megaphone,
  ArrowDownCircle,
  Wallet,
  Info,
  FileSpreadsheet,
  FileDown,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import type { LedgerExportPayload } from '../../lib/artistLedgerExport.types';

type LedgerCategory =
  | 'stream_earning'
  | 'creator_pool'
  | 'contribution_reward'
  | 'referral_reward'
  | 'promotion_paid'
  | 'bonus'
  | 'withdrawal';

type LedgerEntry = {
  category: LedgerCategory;
  label: string;
  amount_usd: number | null;
  amount_treats: number | null;
  currency: string;
  occurred_at: string | null;
  ref_id: string;
  detail?: Record<string, unknown>;
};

type LedgerTotals = {
  song_streams: number;
  stream_earnings_usd: number;
  stream_earnings_impression_usd: number;
  creator_pool_payout_usd: number;
  bonuses_treats: number;
  contribution_rewards_usd: number;
  referral_rewards_treats: number;
  promotions_paid_treats: number;
  withdrawals_usd: number;
};

type LedgerPayload = {
  success: boolean;
  error?: string;
  user?: {
    id: string;
    display_name: string | null;
    email: string | null;
    current_balance_usd: number;
  };
  artist?: {
    artist_id: string | null;
    stage_name: string | null;
  };
  totals?: LedgerTotals;
  entries?: LedgerEntry[];
};

type ArtistSearchRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  artist_profiles:
    | { stage_name: string | null; artist_id: string | null }
    | { stage_name: string | null; artist_id: string | null }[]
    | null;
};

type StageSearchRow = {
  user_id: string;
  stage_name: string | null;
  artist_id: string | null;
  users:
    | { id: string; display_name: string | null; email: string | null }
    | { id: string; display_name: string | null; email: string | null }[];
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

/** Display label for the Description column (and exports). */
function formatLedgerDescriptionLabel(label: string): string {
  const t = label.trim();
  const lower = t.toLowerCase();
  if (lower === 'ad revenue') {
    return 'Revenue';
  }
  if (lower === 'revenue (processed stream/impression)') {
    return 'Revenue (processed stream/impression)';
  }
  if (lower === 'ad revenue (processed stream/impression)') {
    return 'Revenue (processed stream/impression)';
  }
  return label;
}

function ledgerToExportPayload(payload: LedgerPayload): LedgerExportPayload | null {
  if (!payload.user || !payload.totals) return null;
  return {
    user: payload.user,
    artist: payload.artist,
    totals: payload.totals,
    entries: (payload.entries || []).map((e) => ({
      category: e.category,
      label: formatLedgerDescriptionLabel(e.label),
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
    case 'stream_earning':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'creator_pool':
      return 'bg-teal-50 text-teal-800 border-teal-200';
    case 'contribution_reward':
      return 'bg-indigo-50 text-indigo-800 border-indigo-200';
    case 'referral_reward':
      return 'bg-violet-50 text-violet-800 border-violet-200';
    case 'promotion_paid':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    case 'bonus':
      return 'bg-sky-50 text-sky-800 border-sky-200';
    case 'withdrawal':
      return 'bg-rose-50 text-rose-800 border-rose-200';
    default:
      return 'bg-gray-50 text-gray-800 border-gray-200';
  }
};

export const ArtistEarningsLedgerSection = (): JSX.Element => {
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<ArtistSearchRow[]>([]);
  const [selected, setSelected] = useState<ArtistSearchRow | null>(null);
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
    // PostgREST cannot OR filters across embedded resources (e.g. users.* on artist_profiles).
    // Run two queries and merge: (1) users with artist profile by display/email/username,
    // (2) artist_profiles by stage name.
    const pattern = `%${term.replace(/%/g, '')}%`;

    try {
      let byUserFields = await supabase
        .from('users')
        .select('id, display_name, email, artist_profiles!inner(stage_name, artist_id)')
        .or(`display_name.ilike.${pattern},email.ilike.${pattern},username.ilike.${pattern}`)
        .limit(25);

      if (byUserFields.error) {
        byUserFields = await supabase
          .from('users')
          .select('id, display_name, email, artist_profiles!inner(stage_name, artist_id)')
          .or(`display_name.ilike.${pattern},email.ilike.${pattern}`)
          .limit(25);
      }

      if (byUserFields.error) throw byUserFields.error;

      let stageRows: StageSearchRow[] | null = null;

      const stageQuery = await supabase
        .from('artist_profiles')
        .select('user_id, stage_name, artist_id, users!artist_profiles_user_id_fkey(id, display_name, email)')
        .ilike('stage_name', pattern)
        .limit(25);

      if (!stageQuery.error) {
        stageRows = (stageQuery.data || []) as StageSearchRow[];
      } else {
        const fallback = await supabase
          .from('artist_profiles')
          .select('user_id, stage_name, artist_id, users(id, display_name, email)')
          .ilike('stage_name', pattern)
          .limit(25);
        if (!fallback.error) {
          stageRows = (fallback.data || []) as StageSearchRow[];
        } else {
          console.warn('[ArtistEarningsLedger] Stage name search failed:', stageQuery.error, fallback.error);
        }
      }

      const map = new Map<string, ArtistSearchRow>();

      const uRows = (byUserFields.data || []) as {
        id: string;
        display_name: string | null;
        email: string | null;
        artist_profiles:
          | { stage_name: string | null; artist_id: string | null }
          | { stage_name: string | null; artist_id: string | null }[]
          | null;
      }[];

      for (const row of uRows) {
        const ap = Array.isArray(row.artist_profiles) ? row.artist_profiles[0] : row.artist_profiles;
        if (!ap) continue;
        map.set(row.id, {
          id: row.id,
          display_name: row.display_name,
          email: row.email,
          artist_profiles: ap,
        });
      }

      for (const row of stageRows || []) {
        if (map.has(row.user_id)) continue;
        const u = Array.isArray(row.users) ? row.users[0] : row.users;
        if (!u) continue;
        map.set(row.user_id, {
          id: row.user_id,
          display_name: u.display_name,
          email: u.email,
          artist_profiles: { stage_name: row.stage_name, artist_id: row.artist_id },
        });
      }

      setSearchHits(Array.from(map.values()).slice(0, 25));
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
      const { data, error: rpcErr } = await supabase.rpc('admin_get_artist_earnings_ledger', {
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
      const { buildExportFilenameBase, exportArtistLedgerExcel } = await import(
        '../../lib/artistLedgerExport'
      );
      exportArtistLedgerExcel(exportPayload, buildExportFilenameBase(ledger.user.display_name));
    } catch (e) {
      console.error('[ArtistEarningsLedger] Excel export failed:', e);
      setError('Could not load export tools. Try refreshing the page.');
    }
  }, [ledger]);

  const handleExportPdf = useCallback(async () => {
    if (!ledger?.success || !ledger.user || !ledger.totals) return;
    const exportPayload = ledgerToExportPayload(ledger);
    if (!exportPayload) return;
    try {
      const { buildExportFilenameBase, exportArtistLedgerPdf } = await import(
        '../../lib/artistLedgerExport'
      );
      exportArtistLedgerPdf(exportPayload, buildExportFilenameBase(ledger.user.display_name));
    } catch (e) {
      console.error('[ArtistEarningsLedger] PDF export failed:', e);
      setError('Could not load export tools. Try refreshing the page.');
    }
  }, [ledger]);

  const canExport =
    Boolean(ledger?.success && ledger.user && ledger.totals && !loadingLedger);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-900 text-white flex items-center justify-center flex-shrink-0">
            <ScrollText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Artist Earnings Ledger</h2>
            <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
              Transparency for support and finance: streams, ad earnings, bonuses, referrals, promotions, and withdrawals in one place.
              Treat rewards are shown in Treats; live balance is USD.
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
          <span className="font-semibold">Why this matters.</span> Artists ask how their balance was calculated. This ledger ties each credit and debit to
          underlying records (ads, referrals, promotions, payouts). Stream earnings USD includes processed ad impressions plus any creator-pool rows when used.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Find artist (name or email)</label>
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
                  {(Array.isArray(row.artist_profiles) ? row.artist_profiles[0]?.stage_name : row.artist_profiles?.stage_name) && (
                    <span className="block text-xs text-gray-400 mt-0.5">
                      Stage:{' '}
                      {Array.isArray(row.artist_profiles)
                        ? row.artist_profiles[0]?.stage_name
                        : row.artist_profiles?.stage_name}
                    </span>
                  )}
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
                <Music className="w-3.5 h-3.5" /> Song streams
              </div>
              <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{totals.song_streams.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">Sum of play counts on this artist&apos;s tracks</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase">
                <DollarSign className="w-3.5 h-3.5" /> Earnings from streams (ads)
              </div>
              <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{fmtUsd(totals.stream_earnings_usd)}</p>
              <p className="text-xs text-gray-400 mt-1">
                Impressions {fmtUsd(totals.stream_earnings_impression_usd)}
                {totals.creator_pool_payout_usd > 0 && <> + pool {fmtUsd(totals.creator_pool_payout_usd)}</>}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase">
                <Gift className="w-3.5 h-3.5" /> Bonuses (Treats)
              </div>
              <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{fmtTreats(totals.bonuses_treats)}</p>
              {totals.contribution_rewards_usd > 0 && (
                <p className="text-xs text-indigo-700 mt-1">+ Contribution USD {fmtUsd(totals.contribution_rewards_usd)}</p>
              )}
            </div>
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase">
                <Wallet className="w-3.5 h-3.5" /> Current balance
              </div>
              <p className="text-2xl font-bold text-[#309605] mt-1 tabular-nums">{fmtUsd(ledger.user.current_balance_usd)}</p>
              <p className="text-xs text-gray-400 mt-1">Live balance (USD)</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4 flex items-start gap-3">
              <UserPlus className="w-5 h-5 text-violet-500 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Referral rewards</p>
                <p className="text-lg font-bold text-gray-900">{fmtTreats(totals.referral_rewards_treats)}</p>
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4 flex items-start gap-3">
              <Megaphone className="w-5 h-5 text-amber-600 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Promotions paid</p>
                <p className="text-lg font-bold text-gray-900">{fmtTreats(totals.promotions_paid_treats)}</p>
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-4 flex items-start gap-3">
              <ArrowDownCircle className="w-5 h-5 text-rose-500 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Withdrawals (completed)</p>
                <p className="text-lg font-bold text-gray-900">{fmtUsd(totals.withdrawals_usd)}</p>
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
                        <td className="px-3 py-2 text-gray-800">{formatLedgerDescriptionLabel(row.label)}</td>
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
