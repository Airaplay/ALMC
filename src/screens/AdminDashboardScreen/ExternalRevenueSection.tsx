import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  RefreshCw,
  Plus,
  Lock,
  Eye,
  PlayCircle,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  Info,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

// =========================================================================
// Types
// =========================================================================

type SourceCode =
  | 'subscription'
  | 'sponsorship'
  | 'brand_deal'
  | 'partnership'
  | 'merch'
  | 'premium_feature'
  | 'treat_commission'
  | 'grant'
  | 'other';

interface RevenueSource {
  id: string;
  code: SourceCode | string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface SplitSetting {
  id: string;
  source_id: string | null;
  creator_pool_percentage: number;
  listener_pool_percentage: number;
  creator_attribution: 'equal_active' | 'plays_in_period' | 'manual';
  listener_attribution:
    | 'feed_contribution_pool'
    | 'proportional_points'
    | 'equal_active_listeners';
  attribution_window_days: number;
  min_plays_for_creator_eligibility: number;
  min_points_for_listener_eligibility: number;
}

interface DistributionSummary {
  id: string;
  status: 'distributed' | 'reversed' | 'partial';
  creator_pool_usd: number;
  listener_pool_usd: number;
  platform_retained_usd: number;
  creators_paid_count: number;
  listeners_paid_count: number;
  contribution_pool_topup_usd: number;
  executed_at: string;
}

interface EntryRow {
  id: string;
  entry_date: string;
  source_id: string;
  source_code: string;
  source_name: string;
  gross_amount_usd: number;
  fees_usd: number;
  net_amount_usd: number;
  distributable_amount_usd: number;
  original_currency: string | null;
  fx_rate_to_usd: number | null;
  reference: string | null;
  notes: string | null;
  is_locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  distribution: DistributionSummary | null;
}

interface OverviewKpis {
  totals: {
    net_revenue_usd: number;
    distributable_usd: number;
    distributed_usd: number;
    creator_paid_usd: number;
    listener_direct_paid_usd: number;
    listener_pool_topup_usd: number;
    listener_paid_usd: number;
    platform_retained_usd: number;
    pending_topups_usd: number;
  };
  counts: {
    unlocked_entries: number;
    locked_undistributed_entries: number;
    distributions: number;
  };
}

interface PreviewResponse {
  success: boolean;
  error?: string;
  entry?: {
    id: string;
    entry_date: string;
    source_id: string;
    gross_amount_usd: number;
    fees_usd: number;
    net_amount_usd: number;
    distributable_amount_usd: number;
    is_locked: boolean;
  };
  split?: SplitSetting & {
    attribution_window_start: string;
    attribution_window_end: string;
  };
  pools?: {
    creator_pool_usd: number;
    listener_pool_usd: number;
    platform_retained_usd: number;
  };
  counts?: {
    creators_eligible: number;
    listeners_eligible: number;
  };
  samples?: {
    creators: Array<{
      artist_id: string;
      plays_count: number;
      metric: number;
      estimated_payout_usd: number;
    }>;
    listeners: Array<Record<string, unknown>>;
  };
  warnings?: Array<{ code?: string; message?: string }>;
  blocking_errors?: Array<{ code?: string; message?: string }>;
  can_distribute?: boolean;
}

type Tab =
  | 'overview'
  | 'entries'
  | 'split_settings'
  | 'sources'
  | 'history';

// =========================================================================
// Helpers
// =========================================================================

const fmtUsd = (n: number | null | undefined): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n || 0));

const fmtDate = (s: string | null | undefined): string => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().slice(0, 10);
};

const fmtDateTime = (s: string | null | undefined): string => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().slice(0, 16).replace('T', ' ');
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const statusOfEntry = (e: EntryRow): {
  label: string;
  className: string;
} => {
  if (e.distribution?.status === 'reversed') {
    return { label: 'Reversed', className: 'bg-red-50 text-red-700 border-red-200' };
  }
  if (e.distribution?.status === 'partial') {
    return { label: 'Partial (manual creator)', className: 'bg-blue-50 text-blue-700 border-blue-200' };
  }
  if (e.distribution?.status === 'distributed') {
    return { label: 'Distributed', className: 'bg-green-50 text-green-700 border-green-200' };
  }
  if (e.is_locked) {
    return { label: 'Locked', className: 'bg-amber-50 text-amber-700 border-amber-200' };
  }
  return { label: 'Draft', className: 'bg-gray-50 text-gray-700 border-gray-200' };
};

// =========================================================================
// Component
// =========================================================================

export const ExternalRevenueSection = (): JSX.Element => {
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewKpis | null>(null);
  const [sources, setSources] = useState<RevenueSource[]>([]);
  const [defaultSplit, setDefaultSplit] = useState<SplitSetting | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [entriesTotal, setEntriesTotal] = useState(0);
  const [filterStatus, setFilterStatus] = useState<
    'all' | 'unlocked' | 'locked' | 'distributed' | 'reversed'
  >('all');
  const [filterSource, setFilterSource] = useState<string>('all');

  // Create/edit entry modal
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EntryRow | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);
  const [entryForm, setEntryForm] = useState({
    entry_date: todayIso(),
    source_code: 'subscription' as string,
    gross_amount_usd: '',
    fees_usd: '0',
    distributable_amount_usd: '',
    original_currency: 'USD',
    fx_rate_to_usd: '1.0',
    reference: '',
    notes: '',
  });

  // Preview modal
  const [previewing, setPreviewing] = useState<EntryRow | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Distribute confirm
  const [confirmingDistribute, setConfirmingDistribute] = useState<EntryRow | null>(null);
  const [distributing, setDistributing] = useState(false);

  // Reverse confirm
  const [confirmingReverse, setConfirmingReverse] = useState<EntryRow | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);

  // Split settings form
  const [splitForm, setSplitForm] = useState({
    creator_pool_percentage: '50',
    listener_pool_percentage: '50',
    creator_attribution: 'plays_in_period' as SplitSetting['creator_attribution'],
    listener_attribution: 'feed_contribution_pool' as SplitSetting['listener_attribution'],
    attribution_window_days: '30',
    min_plays_for_creator_eligibility: '1',
    min_points_for_listener_eligibility: '10',
  });
  const [savingSplit, setSavingSplit] = useState(false);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4500);
    return () => clearTimeout(t);
  }, [success]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 7000);
    return () => clearTimeout(t);
  }, [error]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: ov, error: ovErr }, srcRes, splitRes, listRes] = await Promise.all([
        supabase.rpc('admin_external_revenue_overview'),
        supabase
          .from('external_revenue_sources')
          .select('*')
          .order('code', { ascending: true }),
        supabase.rpc('admin_get_external_revenue_split_for_source', {
          p_source_code: null,
        }),
        supabase.rpc('admin_list_external_revenue_entries', {
          p_limit: 100,
          p_offset: 0,
          p_source_code: filterSource === 'all' ? null : filterSource,
          p_status: filterStatus === 'all' ? null : filterStatus,
        }),
      ]);

      if (ovErr) throw ovErr;
      if (srcRes.error) throw srcRes.error;
      if (splitRes.error) throw splitRes.error;
      if (listRes.error) throw listRes.error;

      const ovd = (ov ?? {}) as { success?: boolean; totals?: OverviewKpis['totals']; counts?: OverviewKpis['counts'] };
      if (ovd.totals && ovd.counts) {
        setOverview({ totals: ovd.totals, counts: ovd.counts });
      }

      setSources(((srcRes.data as RevenueSource[]) ?? []).filter(s => s.is_active));

      const sd = (splitRes.data ?? {}) as { split?: SplitSetting | null };
      if (sd?.split) {
        setDefaultSplit(sd.split);
        setSplitForm({
          creator_pool_percentage: String(sd.split.creator_pool_percentage ?? 50),
          listener_pool_percentage: String(sd.split.listener_pool_percentage ?? 50),
          creator_attribution: sd.split.creator_attribution,
          listener_attribution: sd.split.listener_attribution,
          attribution_window_days: String(sd.split.attribution_window_days ?? 30),
          min_plays_for_creator_eligibility: String(sd.split.min_plays_for_creator_eligibility ?? 1),
          min_points_for_listener_eligibility: String(sd.split.min_points_for_listener_eligibility ?? 10),
        });
      }

      const ld = (listRes.data ?? {}) as { total?: number; rows?: EntryRow[] };
      setEntries(ld.rows ?? []);
      setEntriesTotal(ld.total ?? 0);
    } catch (err) {
      console.error('External revenue refresh error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load external revenue data');
    } finally {
      setLoading(false);
    }
  }, [filterSource, filterStatus]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // ----------------------- create / edit entry -----------------------
  const openCreateEntry = () => {
    setEditingEntry(null);
    setEntryForm({
      entry_date: todayIso(),
      source_code: sources[0]?.code ?? 'subscription',
      gross_amount_usd: '',
      fees_usd: '0',
      distributable_amount_usd: '',
      original_currency: 'USD',
      fx_rate_to_usd: '1.0',
      reference: '',
      notes: '',
    });
    setShowEntryModal(true);
  };

  const openEditEntry = (e: EntryRow) => {
    setEditingEntry(e);
    setEntryForm({
      entry_date: e.entry_date,
      source_code: e.source_code,
      gross_amount_usd: String(e.gross_amount_usd),
      fees_usd: String(e.fees_usd),
      distributable_amount_usd: String(e.distributable_amount_usd),
      original_currency: e.original_currency ?? 'USD',
      fx_rate_to_usd: String(e.fx_rate_to_usd ?? 1.0),
      reference: e.reference ?? '',
      notes: e.notes ?? '',
    });
    setShowEntryModal(true);
  };

  const saveEntry = async () => {
    setSavingEntry(true);
    setError(null);
    try {
      const gross = parseFloat(entryForm.gross_amount_usd || '0');
      const fees = parseFloat(entryForm.fees_usd || '0');
      const distributable = parseFloat(entryForm.distributable_amount_usd || '0');
      const fx = parseFloat(entryForm.fx_rate_to_usd || '1');

      if (!entryForm.entry_date) throw new Error('Entry date is required');
      if (Number.isNaN(gross) || gross < 0) throw new Error('Gross amount must be a number >= 0');
      if (Number.isNaN(fees) || fees < 0) throw new Error('Fees must be a number >= 0');
      if (Number.isNaN(distributable) || distributable < 0) throw new Error('Distributable amount must be >= 0');
      if (distributable > gross - fees) throw new Error('Distributable amount cannot exceed gross - fees');

      if (editingEntry) {
        const { data, error: rpcErr } = await supabase.rpc('admin_update_external_revenue_entry', {
          p_entry_id: editingEntry.id,
          p_entry_date: entryForm.entry_date,
          p_source_code: entryForm.source_code,
          p_gross_amount_usd: gross,
          p_fees_usd: fees,
          p_net_amount_usd: gross - fees,
          p_distributable_amount_usd: distributable,
          p_original_currency: entryForm.original_currency,
          p_fx_rate_to_usd: fx,
          p_reference: entryForm.reference || null,
          p_notes: entryForm.notes || null,
        });
        if (rpcErr) throw rpcErr;
        const d = (data ?? {}) as { success?: boolean; error?: string };
        if (!d.success) throw new Error(d.error || 'Failed to update entry');
        setSuccess('Entry updated');
      } else {
        const { data, error: rpcErr } = await supabase.rpc('admin_create_external_revenue_entry', {
          p_entry_date: entryForm.entry_date,
          p_source_code: entryForm.source_code,
          p_gross_amount_usd: gross,
          p_fees_usd: fees,
          p_net_amount_usd: gross - fees,
          p_distributable_amount_usd: distributable,
          p_original_currency: entryForm.original_currency,
          p_fx_rate_to_usd: fx,
          p_reference: entryForm.reference || null,
          p_notes: entryForm.notes || null,
        });
        if (rpcErr) throw rpcErr;
        const d = (data ?? {}) as { success?: boolean; error?: string };
        if (!d.success) throw new Error(d.error || 'Failed to create entry');
        setSuccess('Entry created');
      }

      setShowEntryModal(false);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save entry');
    } finally {
      setSavingEntry(false);
    }
  };

  const lockEntry = async (e: EntryRow) => {
    if (
      !window.confirm(
        `Lock and automatically distribute this entry?\n\nDate: ${e.entry_date}\nNet: ${fmtUsd(e.net_amount_usd)}\nDistributable: ${fmtUsd(e.distributable_amount_usd)}\n\nThis credits creators/listeners (or queues listener topups) and posts accounting. Locked entries cannot be edited. Preview first if you are unsure.`,
      )
    ) {
      return;
    }
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_lock_external_revenue_entry', {
        p_entry_id: e.id,
        p_auto_distribute: true,
      });
      if (rpcErr) throw rpcErr;
      const d = (data ?? {}) as {
        success?: boolean;
        error?: string;
        status?: string;
        auto_distributed?: boolean;
        lock_status?: string;
        message?: string;
        creators_paid?: number;
        listeners_paid?: number;
      };
      if (!d.success) throw new Error(d.error || d.message || 'Failed to lock and distribute entry');
      if (d.auto_distributed) {
        setSuccess(
          d.status === 'partial'
            ? 'Entry locked and distributed (creator pool reserved for manual assignment).'
            : `Entry locked and distributed (${d.creators_paid ?? 0} creators · ${d.listeners_paid ?? 0} listeners direct).`,
        );
      } else if (d.status === 'locked' || d.status === 'already_locked') {
        setSuccess(d.message || 'Entry locked (awaiting admin distribution).');
      } else {
        setSuccess('Entry processed');
      }
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to lock and distribute entry');
    }
  };

  const deleteEntry = async (e: EntryRow) => {
    if (!window.confirm(`Delete entry for ${e.entry_date}? This cannot be undone.`)) return;
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_delete_external_revenue_entry', {
        p_entry_id: e.id,
      });
      if (rpcErr) throw rpcErr;
      const d = (data ?? {}) as { success?: boolean; error?: string };
      if (!d.success) throw new Error(d.error || 'Failed to delete entry');
      setSuccess('Entry deleted');
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry');
    }
  };

  // ----------------------- preview / distribute / reverse -----------------------
  const openPreview = async (e: EntryRow) => {
    setPreviewing(e);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        'admin_preview_external_revenue_distribution',
        { p_entry_id: e.id, p_sample_size: 25 },
      );
      if (rpcErr) throw rpcErr;
      setPreview(data as PreviewResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  };

  const runDistribute = async () => {
    if (!confirmingDistribute) return;
    setDistributing(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        'admin_distribute_external_revenue_entry',
        { p_entry_id: confirmingDistribute.id },
      );
      if (rpcErr) throw rpcErr;
      const d = (data ?? {}) as { success?: boolean; error?: string; status?: string };
      if (!d.success) throw new Error(d.error || 'Distribution failed');
      setSuccess(`Distribution ${d.status === 'already_distributed' ? 'already exists' : 'completed'}`);
      setConfirmingDistribute(null);
      setPreviewing(null);
      setPreview(null);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Distribution failed');
    } finally {
      setDistributing(false);
    }
  };

  const runReverse = async () => {
    if (!confirmingReverse?.distribution) return;
    setReversing(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        'admin_reverse_external_revenue_distribution',
        {
          p_distribution_id: confirmingReverse.distribution.id,
          p_reason: reverseReason || null,
        },
      );
      if (rpcErr) throw rpcErr;
      const d = (data ?? {}) as { success?: boolean; error?: string };
      if (!d.success) throw new Error(d.error || 'Reversal failed');
      setSuccess('Distribution reversed');
      setConfirmingReverse(null);
      setReverseReason('');
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reversal failed');
    } finally {
      setReversing(false);
    }
  };

  // ----------------------- split settings save -----------------------
  const saveSplit = async () => {
    setSavingSplit(true);
    setError(null);
    try {
      const creator = parseFloat(splitForm.creator_pool_percentage || '0');
      const listener = parseFloat(splitForm.listener_pool_percentage || '0');
      if (Number.isNaN(creator) || Number.isNaN(listener)) throw new Error('Percentages must be numbers');
      if (Math.round((creator + listener) * 100) !== 10000) {
        throw new Error('Creator + Listener percentages must equal 100');
      }

      const { data, error: rpcErr } = await supabase.rpc('admin_upsert_external_revenue_split', {
        p_source_code: null,
        p_creator_pool_percentage: creator,
        p_listener_pool_percentage: listener,
        p_creator_attribution: splitForm.creator_attribution,
        p_listener_attribution: splitForm.listener_attribution,
        p_attribution_window_days: parseInt(splitForm.attribution_window_days || '30', 10),
        p_min_plays_for_creator_eligibility: parseInt(splitForm.min_plays_for_creator_eligibility || '1', 10),
        p_min_points_for_listener_eligibility: parseInt(splitForm.min_points_for_listener_eligibility || '10', 10),
      });
      if (rpcErr) throw rpcErr;
      const d = (data ?? {}) as { success?: boolean; error?: string };
      if (!d.success) throw new Error(d.error || 'Failed to save split settings');
      setSuccess('Default split saved');
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save split settings');
    } finally {
      setSavingSplit(false);
    }
  };

  const platformRetainedPreview = useMemo(() => {
    const gross = parseFloat(entryForm.gross_amount_usd || '0') || 0;
    const fees = parseFloat(entryForm.fees_usd || '0') || 0;
    const dist = parseFloat(entryForm.distributable_amount_usd || '0') || 0;
    const net = Math.max(0, gross - fees);
    return Math.max(0, net - dist);
  }, [entryForm.gross_amount_usd, entryForm.fees_usd, entryForm.distributable_amount_usd]);

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-900 text-white flex items-center justify-center">
            <Banknote className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">External Revenue Sharing</h2>
            <p className="text-sm text-gray-500">
              Share platform earnings from non-AdMob sources with creators and listeners.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
          title="Refresh"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-green-700 text-sm">{success}</p>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900">
          <p className="font-medium mb-1">How this works</p>
          <ul className="list-disc list-inside space-y-0.5 text-blue-800">
            <li>This rail is SEPARATE from AdMob revenue. AdMob remains 60/0/40.</li>
            <li>You choose how much of each entry to share. Platform keeps the rest automatically.</li>
            <li>Locking an entry automatically distributes it (admin). Preview first to check eligibility.</li>
            <li>Listener share queues a topup that is auto-included in the next monthly contribution conversion.</li>
          </ul>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-1 w-fit">
        {([
          { id: 'overview', label: 'Overview' },
          { id: 'entries', label: 'Entries' },
          { id: 'split_settings', label: 'Split Settings' },
          { id: 'sources', label: 'Sources' },
          { id: 'history', label: 'History' },
        ] as const).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-md text-sm ${
              tab === t.id ? 'bg-[#309605] text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiCard label="Net Revenue (all time)" value={fmtUsd(overview?.totals.net_revenue_usd)} />
            <KpiCard label="Distributable" value={fmtUsd(overview?.totals.distributable_usd)} />
            <KpiCard label="Distributed" value={fmtUsd(overview?.totals.distributed_usd)} />
            <KpiCard label="Platform Retained" value={fmtUsd(overview?.totals.platform_retained_usd)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiCard label="Paid to Creators" value={fmtUsd(overview?.totals.creator_paid_usd)} subtle />
            <KpiCard label="Listener Direct Payouts" value={fmtUsd(overview?.totals.listener_direct_paid_usd)} subtle />
            <KpiCard
              label="Pending Topups (Contribution Pool)"
              value={fmtUsd(overview?.totals.pending_topups_usd)}
              subtle
            />
            <KpiCard
              label="Listener Pool Topups (allocated)"
              value={fmtUsd(overview?.totals.listener_pool_topup_usd)}
              subtle
            />
          </div>
          <p className="text-xs text-gray-500">
            Entries: {overview?.counts.distributions ?? 0} distributed · {overview?.counts.locked_undistributed_entries ?? 0} locked · {overview?.counts.unlocked_entries ?? 0} draft
          </p>
        </div>
      )}

      {/* ENTRIES */}
      {tab === 'entries' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
              >
                <option value="all">All sources</option>
                {sources.map(s => (
                  <option key={s.id} value={s.code}>{s.name}</option>
                ))}
              </select>
              <select
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
              >
                <option value="all">All statuses</option>
                <option value="unlocked">Draft (unlocked)</option>
                <option value="locked">Locked (undistributed)</option>
                <option value="distributed">Distributed</option>
                <option value="reversed">Reversed</option>
              </select>
              <span className="text-xs text-gray-500">{entriesTotal} total</span>
            </div>
            <button
              type="button"
              onClick={openCreateEntry}
              className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg text-sm flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> New Entry
            </button>
          </div>

          <div className="bg-white rounded-lg shadow border border-gray-200 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-2 text-xs text-gray-700 font-medium">Date</th>
                  <th className="p-2 text-xs text-gray-700 font-medium">Source</th>
                  <th className="p-2 text-xs text-gray-700 font-medium text-right">Net</th>
                  <th className="p-2 text-xs text-gray-700 font-medium text-right">Distributable</th>
                  <th className="p-2 text-xs text-gray-700 font-medium text-right">Platform Retained</th>
                  <th className="p-2 text-xs text-gray-700 font-medium">Status</th>
                  <th className="p-2 text-xs text-gray-700 font-medium">Reference</th>
                  <th className="p-2 text-xs text-gray-700 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr><td colSpan={8} className="p-6 text-center text-sm text-gray-500">No entries yet.</td></tr>
                ) : entries.map(e => {
                  const s = statusOfEntry(e);
                  const platformRetained = Number(e.net_amount_usd) - Number(e.distributable_amount_usd);
                  return (
                    <tr key={e.id} className="border-b border-gray-200">
                      <td className="p-2 text-sm text-gray-700 font-medium">{fmtDate(e.entry_date)}</td>
                      <td className="p-2 text-sm text-gray-700">{e.source_name}</td>
                      <td className="p-2 text-sm text-gray-900 text-right">{fmtUsd(e.net_amount_usd)}</td>
                      <td className="p-2 text-sm text-gray-900 text-right">{fmtUsd(e.distributable_amount_usd)}</td>
                      <td className="p-2 text-sm text-gray-700 text-right">{fmtUsd(platformRetained)}</td>
                      <td className="p-2 text-sm">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${s.className}`}>{s.label}</span>
                      </td>
                      <td className="p-2 text-sm text-gray-500">{e.reference || '—'}</td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {!e.is_locked && !e.distribution && (
                            <>
                              <IconBtn title="Edit" onClick={() => openEditEntry(e)} icon={<Settings className="w-3.5 h-3.5" />} />
                              <IconBtn title="Lock & distribute" onClick={() => lockEntry(e)} icon={<Lock className="w-3.5 h-3.5" />} />
                              <IconBtn title="Delete" onClick={() => deleteEntry(e)} icon={<Trash2 className="w-3.5 h-3.5" />} variant="danger" />
                            </>
                          )}
                          {e.is_locked && !e.distribution && (
                            <>
                              <IconBtn title="Preview" onClick={() => openPreview(e)} icon={<Eye className="w-3.5 h-3.5" />} />
                              <IconBtn title="Distribute (admin)" onClick={() => { setConfirmingDistribute(e); }} icon={<PlayCircle className="w-3.5 h-3.5" />} variant="primary" />
                            </>
                          )}
                          {e.distribution?.status === 'distributed' && (
                            <>
                              <IconBtn title="View preview" onClick={() => openPreview(e)} icon={<Eye className="w-3.5 h-3.5" />} />
                              <IconBtn title="Reverse" onClick={() => setConfirmingReverse(e)} icon={<RotateCcw className="w-3.5 h-3.5" />} variant="danger" />
                            </>
                          )}
                          {e.distribution?.status === 'partial' && (
                            <>
                              <IconBtn title="View preview" onClick={() => openPreview(e)} icon={<Eye className="w-3.5 h-3.5" />} />
                              <IconBtn title="Reverse" onClick={() => setConfirmingReverse(e)} icon={<RotateCcw className="w-3.5 h-3.5" />} variant="danger" />
                            </>
                          )}
                          {e.distribution?.status === 'reversed' && (
                            <IconBtn title="View preview" onClick={() => openPreview(e)} icon={<Eye className="w-3.5 h-3.5" />} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SPLIT SETTINGS */}
      {tab === 'split_settings' && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-5 max-w-2xl space-y-4">
          <div>
            <p className="font-semibold text-gray-900">Default Split</p>
            <p className="text-xs text-gray-500">
              Applies to every external revenue entry unless a per-source override exists.
              Platform retention is derived from each entry (net − distributable).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberField
              label="Creator pool (%)"
              value={splitForm.creator_pool_percentage}
              onChange={(v) => setSplitForm(p => ({ ...p, creator_pool_percentage: v }))}
            />
            <NumberField
              label="Listener pool (%)"
              value={splitForm.listener_pool_percentage}
              onChange={(v) => setSplitForm(p => ({ ...p, listener_pool_percentage: v }))}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SelectField
              label="Creator attribution"
              value={splitForm.creator_attribution}
              options={[
                { value: 'plays_in_period', label: 'Plays in attribution window' },
                { value: 'equal_active', label: 'Equal among active creators' },
                { value: 'manual', label: 'Manual — reserve pool, no auto artist payouts' },
              ]}
              onChange={(v) => setSplitForm(p => ({ ...p, creator_attribution: v as SplitSetting['creator_attribution'] }))}
            />
            <SelectField
              label="Listener attribution"
              value={splitForm.listener_attribution}
              options={[
                { value: 'feed_contribution_pool', label: 'Feed monthly contribution pool (recommended)' },
                { value: 'proportional_points', label: 'Distribute now, by contribution points' },
                { value: 'equal_active_listeners', label: 'Equal among eligible listeners' },
              ]}
              onChange={(v) => setSplitForm(p => ({ ...p, listener_attribution: v as SplitSetting['listener_attribution'] }))}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <NumberField
              label="Attribution window (days)"
              value={splitForm.attribution_window_days}
              onChange={(v) => setSplitForm(p => ({ ...p, attribution_window_days: v }))}
            />
            <NumberField
              label="Min plays (creator eligibility)"
              value={splitForm.min_plays_for_creator_eligibility}
              onChange={(v) => setSplitForm(p => ({ ...p, min_plays_for_creator_eligibility: v }))}
            />
            <NumberField
              label="Min points (listener eligibility)"
              value={splitForm.min_points_for_listener_eligibility}
              onChange={(v) => setSplitForm(p => ({ ...p, min_points_for_listener_eligibility: v }))}
            />
          </div>

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={saveSplit}
              disabled={savingSplit}
              className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg text-sm disabled:opacity-50"
            >
              {savingSplit ? 'Saving…' : 'Save Default Split'}
            </button>
          </div>

          {defaultSplit && (
            <div className="text-xs text-gray-500 border-t pt-3">
              Current saved: {defaultSplit.creator_pool_percentage}% creators · {defaultSplit.listener_pool_percentage}% listeners ·
              creator={defaultSplit.creator_attribution} · listener={defaultSplit.listener_attribution} · window={defaultSplit.attribution_window_days}d
            </div>
          )}
        </div>
      )}

      {/* SOURCES */}
      {tab === 'sources' && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-5 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2 text-xs text-gray-700 font-medium">Code</th>
                <th className="p-2 text-xs text-gray-700 font-medium">Name</th>
                <th className="p-2 text-xs text-gray-700 font-medium">Description</th>
                <th className="p-2 text-xs text-gray-700 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.id} className="border-b border-gray-200">
                  <td className="p-2 text-sm font-mono text-gray-700">{s.code}</td>
                  <td className="p-2 text-sm text-gray-900">{s.name}</td>
                  <td className="p-2 text-sm text-gray-600">{s.description || '—'}</td>
                  <td className="p-2 text-sm">{s.is_active ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-3">
            Source types are managed via DB seed today. Adding/removing source codes requires a small migration.
          </p>
        </div>
      )}

      {/* HISTORY */}
      {tab === 'history' && (
        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2 text-xs text-gray-700 font-medium">Executed</th>
                <th className="p-2 text-xs text-gray-700 font-medium">Entry Date</th>
                <th className="p-2 text-xs text-gray-700 font-medium">Source</th>
                <th className="p-2 text-xs text-gray-700 font-medium text-right">Creator Pool</th>
                <th className="p-2 text-xs text-gray-700 font-medium text-right">Listener Pool</th>
                <th className="p-2 text-xs text-gray-700 font-medium text-right">Platform Retained</th>
                <th className="p-2 text-xs text-gray-700 font-medium">Creators</th>
                <th className="p-2 text-xs text-gray-700 font-medium">Listeners</th>
                <th className="p-2 text-xs text-gray-700 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.filter(e => e.distribution).length === 0 ? (
                <tr><td colSpan={9} className="p-6 text-center text-sm text-gray-500">No distributions yet.</td></tr>
              ) : entries.filter(e => e.distribution).map(e => (
                <tr key={e.id} className="border-b border-gray-200">
                  <td className="p-2 text-sm text-gray-700">{fmtDateTime(e.distribution!.executed_at)}</td>
                  <td className="p-2 text-sm text-gray-700">{fmtDate(e.entry_date)}</td>
                  <td className="p-2 text-sm text-gray-700">{e.source_name}</td>
                  <td className="p-2 text-sm text-gray-900 text-right">{fmtUsd(e.distribution!.creator_pool_usd)}</td>
                  <td className="p-2 text-sm text-gray-900 text-right">{fmtUsd(e.distribution!.listener_pool_usd)}</td>
                  <td className="p-2 text-sm text-gray-900 text-right">{fmtUsd(e.distribution!.platform_retained_usd)}</td>
                  <td className="p-2 text-sm text-gray-700">{e.distribution!.creators_paid_count}</td>
                  <td className="p-2 text-sm text-gray-700">{e.distribution!.listeners_paid_count || (e.distribution!.contribution_pool_topup_usd > 0 ? 'pool topup' : '—')}</td>
                  <td className="p-2 text-sm">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${e.distribution!.status === 'reversed' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                      {e.distribution!.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ENTRY MODAL */}
      {showEntryModal && (
        <Modal onClose={() => !savingEntry && setShowEntryModal(false)} title={editingEntry ? 'Edit Entry' : 'New External Revenue Entry'}>
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Entry date</label>
                <input
                  type="date"
                  value={entryForm.entry_date}
                  onChange={(e) => setEntryForm(p => ({ ...p, entry_date: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Source</label>
                <select
                  value={entryForm.source_code}
                  onChange={(e) => setEntryForm(p => ({ ...p, source_code: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  {sources.map(s => <option key={s.id} value={s.code}>{s.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <NumberField label="Gross (USD)" value={entryForm.gross_amount_usd} onChange={(v) => setEntryForm(p => ({ ...p, gross_amount_usd: v }))} />
              <NumberField label="Fees (USD)" value={entryForm.fees_usd} onChange={(v) => setEntryForm(p => ({ ...p, fees_usd: v }))} />
              <NumberField label="Distributable (USD)" value={entryForm.distributable_amount_usd} onChange={(v) => setEntryForm(p => ({ ...p, distributable_amount_usd: v }))} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Original currency</label>
                <input
                  type="text"
                  value={entryForm.original_currency}
                  onChange={(e) => setEntryForm(p => ({ ...p, original_currency: e.target.value.toUpperCase() }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm uppercase"
                  maxLength={3}
                />
              </div>
              <NumberField label="FX rate to USD" value={entryForm.fx_rate_to_usd} onChange={(v) => setEntryForm(p => ({ ...p, fx_rate_to_usd: v }))} />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">Reference</label>
              <input
                type="text"
                value={entryForm.reference}
                onChange={(e) => setEntryForm(p => ({ ...p, reference: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="Invoice #, deal name, etc."
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Notes</label>
              <textarea
                value={entryForm.notes}
                onChange={(e) => setEntryForm(p => ({ ...p, notes: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[72px]"
              />
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700">
              Platform will retain: <span className="font-semibold text-gray-900">{fmtUsd(platformRetainedPreview)}</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowEntryModal(false)}
                disabled={savingEntry}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
              >Cancel</button>
              <button
                type="button"
                onClick={saveEntry}
                disabled={savingEntry}
                className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg text-sm disabled:opacity-50"
              >{savingEntry ? 'Saving…' : (editingEntry ? 'Save Changes' : 'Create Entry')}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* PREVIEW MODAL */}
      {previewing && (
        <Modal onClose={() => { setPreviewing(null); setPreview(null); }} title={`Preview · ${previewing.source_name} · ${fmtDate(previewing.entry_date)}`} wide>
          {previewLoading || !preview ? (
            <div className="py-6 text-center text-sm text-gray-500">Computing preview…</div>
          ) : !preview.success ? (
            <div className="text-sm text-red-700">{preview.error || 'Preview failed'}</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Net" value={fmtUsd(preview.entry?.net_amount_usd)} />
                <Stat label="Distributable" value={fmtUsd(preview.entry?.distributable_amount_usd)} />
                <Stat label="Creator Pool" value={fmtUsd(preview.pools?.creator_pool_usd)} />
                <Stat label="Listener Pool" value={fmtUsd(preview.pools?.listener_pool_usd)} />
                <Stat label="Platform Retained" value={fmtUsd(preview.pools?.platform_retained_usd)} />
                <Stat label="Window" value={`${fmtDate(preview.split?.attribution_window_start)} → ${fmtDate(preview.split?.attribution_window_end)}`} />
                <Stat label="Creators Eligible" value={String(preview.counts?.creators_eligible ?? 0)} />
                <Stat label="Listeners Eligible" value={String(preview.counts?.listeners_eligible ?? 0)} />
              </div>

              {(preview.blocking_errors?.length ?? 0) > 0 && (
                <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded p-3 space-y-1">
                  <p className="font-medium">Distribution blocked</p>
                  {preview.blocking_errors!.map((w, i) => (
                    <p key={i}>{w.message}</p>
                  ))}
                </div>
              )}

              {(preview.warnings?.length ?? 0) > 0 && (
                <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3 space-y-1">
                  <p className="font-medium">Notes</p>
                  {preview.warnings!.map((w, i) => (
                    <p key={i}>{w.message}</p>
                  ))}
                </div>
              )}

              <div>
                <p className="text-sm font-semibold text-gray-900 mb-1">Top creator allocations (sample)</p>
                <div className="overflow-x-auto border border-gray-200 rounded">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 text-left text-xs text-gray-600">Artist ID</th>
                        <th className="p-2 text-right text-xs text-gray-600">Plays</th>
                        <th className="p-2 text-right text-xs text-gray-600">Metric</th>
                        <th className="p-2 text-right text-xs text-gray-600">Estimated USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.samples?.creators?.length ? preview.samples.creators.map((c, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="p-2 font-mono text-xs">{c.artist_id}</td>
                          <td className="p-2 text-right">{c.plays_count}</td>
                          <td className="p-2 text-right">{Number(c.metric).toFixed(2)}</td>
                          <td className="p-2 text-right">{fmtUsd(c.estimated_payout_usd)}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan={4} className="p-3 text-center text-xs text-gray-500">No creators eligible in window.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-900 mb-1">Listener allocation</p>
                <div className="border border-gray-200 rounded p-3 text-sm text-gray-700">
                  Strategy: <span className="font-medium">{preview.split?.listener_attribution}</span>
                  {preview.split?.listener_attribution === 'feed_contribution_pool' && (
                    <p className="mt-1 text-xs text-gray-500">
                      The listener pool will be queued as a pending topup and auto-included in the next monthly contribution conversion reward pool.
                    </p>
                  )}
                </div>
              </div>

              {!previewing.is_locked && preview.can_distribute !== false && (
                <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">
                  Ready to lock &amp; distribute in one step.
                </div>
              )}

              {preview.can_distribute === false && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  Fix blocking issues above before locking.
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setPreviewing(null); setPreview(null); }}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
                >Close</button>
                {!previewing.distribution && (
                  <button
                    type="button"
                    onClick={() => { setPreviewing(null); setPreview(null); void lockEntry(previewing); }}
                    disabled={preview.can_distribute === false}
                    className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >Lock & distribute</button>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* CONFIRM DISTRIBUTE */}
      {confirmingDistribute && (
        <Modal onClose={() => !distributing && setConfirmingDistribute(null)} title="Confirm distribution">
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Distribute the locked entry from <strong>{fmtDate(confirmingDistribute.entry_date)}</strong> ({confirmingDistribute.source_name}).
              Use this when finance locked the entry without auto-distribution.
            </p>
            <p className="text-sm text-gray-700">
              Net: <strong>{fmtUsd(confirmingDistribute.net_amount_usd)}</strong> · Distributable: <strong>{fmtUsd(confirmingDistribute.distributable_amount_usd)}</strong>
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmingDistribute(null)}
                disabled={distributing}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
              >Cancel</button>
              <button
                type="button"
                onClick={runDistribute}
                disabled={distributing}
                className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg text-sm disabled:opacity-50"
              >{distributing ? 'Distributing…' : 'Distribute'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* CONFIRM REVERSE */}
      {confirmingReverse && (
        <Modal onClose={() => !reversing && setConfirmingReverse(null)} title="Reverse Distribution">
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
              This will debit creator and listener balances (clamped at 0), reverse pending contribution-pool topups, and post a compensating journal entry. This cannot be undone automatically.
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Reason (optional, recorded in ledger memo)</label>
              <textarea
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[72px]"
                placeholder="e.g. duplicate payment, refunded sponsorship, accounting correction"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmingReverse(null)}
                disabled={reversing}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
              >Cancel</button>
              <button
                type="button"
                onClick={runReverse}
                disabled={reversing}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm disabled:opacity-50"
              >{reversing ? 'Reversing…' : 'Reverse Distribution'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// =========================================================================
// Small UI helpers
// =========================================================================

const KpiCard: React.FC<{ label: string; value: string; subtle?: boolean }> = ({ label, value, subtle }) => (
  <div className={`rounded-lg border ${subtle ? 'border-gray-100 bg-white' : 'border-gray-200 bg-white'} shadow-sm p-5`}>
    <p className="text-xs text-gray-500">{label}</p>
    <p className={`mt-1 ${subtle ? 'text-lg font-semibold text-gray-800' : 'text-xl font-bold text-gray-900'}`}>{value}</p>
  </div>
);

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-gray-50 rounded p-2">
    <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
    <p className="text-sm font-semibold text-gray-900">{value}</p>
  </div>
);

const NumberField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div>
    <label className="text-xs font-medium text-gray-600">{label}</label>
    <input
      type="number"
      inputMode="decimal"
      step="any"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
    />
  </div>
);

const SelectField: React.FC<{ label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }> = ({ label, value, options, onChange }) => (
  <div>
    <label className="text-xs font-medium text-gray-600">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const IconBtn: React.FC<{ title: string; onClick: () => void; icon: React.ReactNode; variant?: 'default' | 'primary' | 'danger' }> = ({ title, onClick, icon, variant = 'default' }) => {
  const cls = variant === 'primary'
    ? 'bg-[#309605] hover:bg-[#3ba208] text-white'
    : variant === 'danger'
    ? 'bg-red-50 hover:bg-red-100 text-red-700'
    : 'bg-gray-100 hover:bg-gray-200 text-gray-700';
  return (
    <button type="button" title={title} onClick={onClick} className={`p-1.5 rounded ${cls}`}>
      {icon}
    </button>
  );
};

const Modal: React.FC<{ onClose: () => void; title: string; wide?: boolean; children: React.ReactNode }> = ({ onClose, title, wide, children }) => (
  <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
    <div className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} max-h-[90vh] overflow-y-auto`}>
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <p className="font-semibold text-gray-900">{title}</p>
        <button type="button" onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);
