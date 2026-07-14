import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Ban,
  CheckCircle,
  RefreshCw,
  Search,
  Settings,
  Target,
  UserCheck,
  Users,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Card, CardContent } from '../../components/ui/card';
import { LoadingLogo } from '../../components/LoadingLogo';

interface MilestoneSettings {
  is_enabled: boolean;
  program_active: boolean;
  auto_approve_payout: boolean;
  required_qualified_referrals: number;
  min_active_days: number;
  reward_amount_ngn: number;
  reward_amount_usd: number;
  detect_abuse: boolean;
  detect_shared_device: boolean;
  max_accounts_per_device: number;
  program_start_at: string | null;
}

interface MilestoneStats {
  referrers_tracking: number;
  referrers_ready_for_review: number;
  referrers_paid: number;
}

interface LeaderboardRow {
  referrer_id: string;
  display_name: string | null;
  email: string | null;
  referral_code: string | null;
  qualified_count: number;
  pending_count: number;
  disqualified_count: number;
  target_count: number;
  progress_percent: number;
  payout_status: string;
  milestone_reached: boolean;
  milestone_eligible: boolean;
  excluded_at: string | null;
  exclusion_reason: string | null;
  credited_at: string | null;
  live_balance_after: number | null;
  current_live_balance_usd: number;
}

interface QualificationRow {
  referral_id: string;
  referred_name: string;
  status: string;
  active_days: number;
  min_active_days_required: number;
  disqualified_reason: string | null;
  qualified_at: string | null;
  referral_created_at: string;
  flagged_for_abuse: boolean;
}

interface SettingsForm {
  is_enabled: boolean;
  program_active: boolean;
  auto_approve_payout: boolean;
  required_qualified_referrals: number;
  min_active_days: number;
  reward_amount_ngn: number;
  reward_amount_usd: number;
  detect_abuse: boolean;
  detect_shared_device: boolean;
  max_accounts_per_device: number;
}

type StatusFilter = 'all' | 'tracking' | 'ready_for_review' | 'paid' | 'rejected';
type MilestoneFilter = 'all' | 'reached' | 'not_reached';
type SortOption = 'progress_desc' | 'progress_asc' | 'updated_desc' | 'name_asc';

const formatNgn = (amount: number): string =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);

const formatUsd = (amount: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

const payoutStatusClass = (status: string): string => {
  switch (status) {
    case 'ready_for_review':
      return 'bg-amber-100 text-amber-800';
    case 'paid':
      return 'bg-green-100 text-green-800';
    case 'rejected':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

const qualStatusClass = (status: string): string => {
  switch (status) {
    case 'qualified':
      return 'bg-green-100 text-green-700';
    case 'disqualified':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-yellow-100 text-yellow-800';
  }
};

function ProgressBar({ qualified, target, percent }: { qualified: number; target: number; percent: number }): JSX.Element {
  const pct = Math.min(100, percent);
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>
          {qualified}/{target}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full bg-[#309605] rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  accent: string;
  sub?: string;
}): JSX.Element {
  return (
    <Card>
      <CardContent className="p-6">
        <Icon className={`w-8 h-8 mb-2 ${accent}`} />
        <h3 className="text-gray-600 text-sm font-medium mb-1">{label}</h3>
        <p className={`text-2xl font-bold ${accent}`}>{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function SettingsFormPanel({
  formData,
  setFormData,
  isSaving,
  onSave,
}: {
  formData: SettingsForm;
  setFormData: Dispatch<SetStateAction<SettingsForm>>;
  isSaving: boolean;
  onSave: () => void;
}): JSX.Element {
  return (
    <>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={formData.is_enabled}
          onChange={(e) => setFormData((f) => ({ ...f, is_enabled: e.target.checked }))}
        />
        <span className="text-sm font-medium">Enable milestone program</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={formData.program_active}
          onChange={(e) => setFormData((f) => ({ ...f, program_active: e.target.checked }))}
        />
        <span className="text-sm font-medium">Program active</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={formData.auto_approve_payout}
          onChange={(e) => setFormData((f) => ({ ...f, auto_approve_payout: e.target.checked }))}
        />
        <span className="text-sm font-medium">
          Auto-approve payout (credit Live Balance when milestone is reached)
        </span>
      </label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { key: 'required_qualified_referrals' as const, label: 'Required qualified referrals' },
          { key: 'min_active_days' as const, label: 'Min active days (Treat active + ₦5K qualified)' },
          { key: 'reward_amount_ngn' as const, label: 'Reward (NGN)' },
          { key: 'max_accounts_per_device' as const, label: 'Max accounts per device' },
        ].map(({ key, label }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
            <input
              type="number"
              min={1}
              value={formData[key]}
              onChange={(e) => setFormData((f) => ({ ...f, [key]: parseInt(e.target.value, 10) || 0 }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        ))}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Reward (USD)</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={formData.reward_amount_usd}
            onChange={(e) => setFormData((f) => ({ ...f, reward_amount_usd: parseFloat(e.target.value) || 0 }))}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={formData.detect_abuse}
          onChange={(e) => setFormData((f) => ({ ...f, detect_abuse: e.target.checked }))}
        />
        <span className="text-sm">Use referral abuse detection</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={formData.detect_shared_device}
          onChange={(e) => setFormData((f) => ({ ...f, detect_shared_device: e.target.checked }))}
        />
        <span className="text-sm">Block shared-device / multi-account farming</span>
      </label>
      <button
        type="button"
        onClick={onSave}
        disabled={isSaving}
        className="px-6 py-3 bg-[#309605] text-white rounded-lg font-medium disabled:opacity-50"
      >
        {isSaving ? 'Saving settings…' : 'Save settings'}
      </button>
    </>
  );
}

export const ReferralMilestoneProgramTab = (): JSX.Element => {
  const [settings, setSettings] = useState<MilestoneSettings | null>(null);
  const [stats, setStats] = useState<MilestoneStats | null>(null);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [milestoneFilter, setMilestoneFilter] = useState<MilestoneFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('progress_desc');
  const [isApproving, setIsApproving] = useState(false);
  const [isTogglingEligibility, setIsTogglingEligibility] = useState(false);
  const [selectedReferrerId, setSelectedReferrerId] = useState<string | null>(null);
  const [detailQualifications, setDetailQualifications] = useState<QualificationRow[]>([]);
  const [detailPayout, setDetailPayout] = useState<Record<string, unknown> | null>(null);
  const [detailReferrer, setDetailReferrer] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [formData, setFormData] = useState<SettingsForm>({
    is_enabled: false,
    program_active: true,
    auto_approve_payout: false,
    required_qualified_referrals: 10,
    min_active_days: 3,
    reward_amount_ngn: 5000,
    reward_amount_usd: 4,
    detect_abuse: true,
    detect_shared_device: true,
    max_accounts_per_device: 1,
  });

  const loadOverview = useCallback(async () => {
    const [statsRes, boardRes] = await Promise.all([
      supabase.rpc('admin_get_referral_milestone_stats'),
      supabase.rpc('admin_get_referral_milestone_leaderboard', {
        p_limit: 100,
        p_offset: 0,
        p_search: searchQuery.trim() || null,
        p_status: statusFilter === 'all' ? null : statusFilter,
        p_milestone_reached:
          milestoneFilter === 'all' ? null : milestoneFilter === 'reached',
        p_min_qualified: null,
        p_sort: sortBy,
      }),
    ]);
    if (statsRes.error) throw statsRes.error;
    if (boardRes.error) throw boardRes.error;
    const payload = statsRes.data as { settings: MilestoneSettings; stats: MilestoneStats };
    setSettings(payload.settings);
    setStats(payload.stats);
    setFormData({
      is_enabled: payload.settings.is_enabled,
      program_active: payload.settings.program_active,
      auto_approve_payout: payload.settings.auto_approve_payout ?? false,
      required_qualified_referrals: payload.settings.required_qualified_referrals,
      min_active_days: payload.settings.min_active_days,
      reward_amount_ngn: payload.settings.reward_amount_ngn,
      reward_amount_usd: Number(payload.settings.reward_amount_usd),
      detect_abuse: payload.settings.detect_abuse,
      detect_shared_device: payload.settings.detect_shared_device,
      max_accounts_per_device: payload.settings.max_accounts_per_device,
    });
    const board = boardRes.data as { rows: LeaderboardRow[]; total: number };
    setRows(board.rows ?? []);
    setTotalRows(board.total ?? 0);
  }, [searchQuery, statusFilter, milestoneFilter, sortBy]);

  const loadDetail = useCallback(async (referrerId: string) => {
    const { data, error: rpcError } = await supabase.rpc('admin_get_referral_milestone_referrer_detail', {
      p_referrer_id: referrerId,
    });
    if (rpcError) throw rpcError;
    const payload = data as {
      referrer: Record<string, unknown>;
      payout: Record<string, unknown>;
      qualifications: QualificationRow[];
    };
    setDetailReferrer(payload.referrer);
    setDetailPayout(payload.payout);
    setDetailQualifications(payload.qualifications ?? []);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      await loadOverview();
      if (selectedReferrerId) await loadDetail(selectedReferrerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load milestone program');
    } finally {
      setIsLoading(false);
    }
  }, [loadOverview, loadDetail, selectedReferrerId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    setSettingsMessage(null);
    try {
      const { error: refreshError } = await supabase.rpc('admin_refresh_referral_milestone_all');
      if (refreshError) throw refreshError;
      await loadOverview();
      if (selectedReferrerId) await loadDetail(selectedReferrerId);
      setSettingsMessage('Referral qualifications re-evaluated.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh qualifications';
      alert(message);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setSettingsMessage(null);
    try {
      const enablingNow = formData.is_enabled && !settings?.is_enabled;
      const { error: saveError } = await supabase.rpc('admin_update_referral_milestone_settings', {
        p_is_enabled: formData.is_enabled,
        p_program_active: formData.program_active,
        p_required_qualified_referrals: formData.required_qualified_referrals,
        p_min_active_days: formData.min_active_days,
        p_reward_amount_ngn: formData.reward_amount_ngn,
        p_reward_amount_usd: formData.reward_amount_usd,
        p_detect_abuse: formData.detect_abuse,
        p_detect_shared_device: formData.detect_shared_device,
        p_max_accounts_per_device: formData.max_accounts_per_device,
        p_program_start_at: enablingNow
          ? new Date().toISOString()
          : (settings?.program_start_at ?? new Date().toISOString()),
        p_auto_approve_payout: formData.auto_approve_payout,
      });
      if (saveError) throw saveError;

      await loadOverview();
      setSettingsMessage(
        formData.is_enabled
          ? 'Settings saved. Use "Re-evaluate all" to process existing referrals.'
          : 'Settings saved.',
      );
      setShowSettings(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      setSettingsMessage(message);
      alert(message);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleApprovePayout = async (referrerId: string) => {
    if (!confirm('Approve and credit this reward to the user\'s Live Balance (withdrawable)?')) return;
    setIsApproving(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_approve_referral_milestone_payout', {
        p_referrer_id: referrerId,
        p_admin_notes: 'Approved by admin — credited to Live Balance',
      });
      if (rpcError) throw rpcError;
      const result = data as { ok?: boolean; error?: string; live_balance_after?: number };
      if (result?.ok === false) {
        alert(result.error ?? 'Could not credit payout');
        return;
      }
      await loadAll();
    } catch (err) {
      console.error(err);
      alert('Failed to approve payout');
    } finally {
      setIsApproving(false);
    }
  };

  const handleRejectPayout = async (referrerId: string) => {
    if (!confirm('Reject this milestone payout? No Live Balance will be credited.')) return;
    try {
      await supabase.rpc('admin_update_referral_milestone_payout_status', {
        p_referrer_id: referrerId,
        p_payout_status: 'rejected',
        p_admin_notes: 'Rejected by admin',
      });
      await loadAll();
    } catch {
      alert('Failed to reject payout');
    }
  };

  const handleSetEligibility = async (referrerId: string, eligible: boolean) => {
    let reason: string | null = null;
    if (!eligible) {
      const input = prompt('Reason for excluding this user from the milestone program (optional):');
      if (input === null) return;
      reason = input.trim() || null;
      if (!confirm('Exclude this user from the ₦5K milestone? They will not receive a cash payout.')) return;
    } else if (!confirm('Restore this user\'s eligibility for the ₦5K milestone program?')) {
      return;
    }

    setIsTogglingEligibility(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_set_referral_milestone_eligibility', {
        p_referrer_id: referrerId,
        p_eligible: eligible,
        p_reason: reason,
      });
      if (rpcError) throw rpcError;
      const result = data as { ok?: boolean; error?: string };
      if (result?.ok === false) {
        alert(result.error ?? 'Could not update milestone eligibility');
        return;
      }
      setSettingsMessage(eligible ? 'User restored to milestone program.' : 'User excluded from milestone program.');
      await loadAll();
    } catch (err) {
      console.error(err);
      alert('Failed to update milestone eligibility');
    } finally {
      setIsTogglingEligibility(false);
    }
  };

  if (isLoading && !settings) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingLogo variant="pulse" size={32} />
        <p className="ml-4 text-gray-700">Loading milestone program...</p>
      </div>
    );
  }

  const target = settings?.required_qualified_referrals ?? 10;
  const minDays = settings?.min_active_days ?? 3;
  const rewardNgn = settings?.reward_amount_ngn ?? 5000;
  const rewardUsd = Number(settings?.reward_amount_usd ?? 4);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Program 2 — Cash milestone.</strong> Invite {target} users active {minDays}+ days each →{' '}
        {formatNgn(rewardNgn)} ({formatUsd(rewardUsd)}). On approve, reward is added to{' '}
        <strong>Live Balance</strong> (withdrawable). <strong>Min active days</strong> is the shared bar for Treat referral “active” and cash milestone “qualified.” Admin-only tracking.
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {settingsMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{settingsMessage}</div>
      )}

      <div className="flex flex-wrap gap-2 justify-between items-center">
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowSettings((v) => !v)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium flex items-center gap-2">
            <Settings className="w-4 h-4" /> Settings
          </button>
          <button type="button" onClick={() => void handleRefreshAll()} disabled={isRefreshing} className="px-4 py-2 rounded-lg bg-[#309605] text-white font-medium flex items-center gap-2 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} /> Re-evaluate all
          </button>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${settings?.is_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {settings?.is_enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {showSettings && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Milestone program settings</h3>
            <SettingsFormPanel formData={formData} setFormData={setFormData} isSaving={isSavingSettings} onSave={() => void handleSaveSettings()} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Target} label="Ready for review" value={stats?.referrers_ready_for_review ?? 0} accent="text-amber-600" />
        <StatCard icon={Users} label="Tracking" value={stats?.referrers_tracking ?? 0} accent="text-blue-600" />
        <StatCard icon={CheckCircle} label="Paid out" value={stats?.referrers_paid ?? 0} accent="text-green-600" />
        <StatCard icon={Banknote} label="Reward" value={formatNgn(rewardNgn)} accent="text-[#309605]" sub={formatUsd(rewardUsd)} />
      </div>

      {!selectedReferrerId ? (
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row flex-wrap gap-3 mb-6">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" placeholder="Search referrer..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void loadOverview()} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg" />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="all">All statuses</option>
                <option value="tracking">Tracking</option>
                <option value="ready_for_review">Ready for review</option>
                <option value="paid">Paid / credited</option>
                <option value="rejected">Rejected</option>
              </select>
              <select value={milestoneFilter} onChange={(e) => setMilestoneFilter(e.target.value as MilestoneFilter)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="all">All progress</option>
                <option value="reached">Milestone reached</option>
                <option value="not_reached">Not yet reached</option>
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="progress_desc">Progress (high → low)</option>
                <option value="progress_asc">Progress (low → high)</option>
                <option value="updated_desc">Recently updated</option>
                <option value="name_asc">Name (A–Z)</option>
              </select>
              <button type="button" onClick={() => void loadOverview()} className="px-4 py-2 bg-gray-100 rounded-lg text-sm font-medium">Apply filters</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{totalRows} referrer(s)</p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Referrer</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Progress</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Qualified</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Pending</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Disqualified</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Live Balance</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.referrer_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="text-sm font-medium">{row.display_name || row.email || 'Unknown'}</div>
                        <div className="text-xs text-gray-500 font-mono">{row.referral_code || '—'}</div>
                        {row.milestone_reached && !row.credited_at && row.milestone_eligible !== false && (
                          <span className="block text-xs text-amber-700 font-medium mt-0.5">Milestone reached</span>
                        )}
                        {row.milestone_eligible === false && (
                          <span className="block text-xs text-red-700 font-medium mt-0.5">Excluded from milestone</span>
                        )}
                      </td>
                      <td className="py-3 px-4"><ProgressBar qualified={row.qualified_count} target={row.target_count} percent={row.progress_percent} /></td>
                      <td className="py-3 px-4 text-sm text-green-700 font-medium">{row.qualified_count}</td>
                      <td className="py-3 px-4 text-sm text-yellow-700">{row.pending_count}</td>
                      <td className="py-3 px-4 text-sm text-red-600">{row.disqualified_count}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${payoutStatusClass(row.credited_at ? 'paid' : row.payout_status)}`}>
                          {row.credited_at ? 'credited' : row.payout_status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-800">{formatUsd(Number(row.current_live_balance_usd ?? 0))}</td>
                      <td className="py-3 px-4">
                        <div className="flex gap-1 flex-wrap">
                          {row.milestone_reached && !row.credited_at && row.payout_status !== 'rejected' && row.milestone_eligible !== false && (
                            <button type="button" disabled={isApproving} onClick={() => void handleApprovePayout(row.referrer_id)} className="px-2 py-1 bg-green-600 text-white rounded-lg text-xs disabled:opacity-50">Approve</button>
                          )}
                          {row.milestone_eligible === false ? (
                            <button type="button" disabled={isTogglingEligibility} onClick={() => void handleSetEligibility(row.referrer_id, true)} className="px-2 py-1 bg-blue-600 text-white rounded-lg text-xs disabled:opacity-50 flex items-center gap-1">
                              <UserCheck className="w-3 h-3" /> Enable
                            </button>
                          ) : !row.credited_at && (
                            <button type="button" disabled={isTogglingEligibility} onClick={() => void handleSetEligibility(row.referrer_id, false)} className="px-2 py-1 bg-red-100 text-red-700 rounded-lg text-xs disabled:opacity-50 flex items-center gap-1">
                              <Ban className="w-3 h-3" /> Disable
                            </button>
                          )}
                          <button type="button" onClick={() => { setSelectedReferrerId(row.referrer_id); void loadDetail(row.referrer_id); }} className="px-2 py-1 bg-[#309605] text-white rounded-lg text-xs">View</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="py-8 text-center text-gray-500">No matches. Adjust filters or re-evaluate.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
              <button type="button" onClick={() => setSelectedReferrerId(null)} className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg"><ArrowLeft className="w-4 h-4" /> Back</button>
              <div className="flex gap-2 flex-wrap">
                {detailPayout?.milestone_eligible === false ? (
                  <button type="button" disabled={isTogglingEligibility} onClick={() => selectedReferrerId && void handleSetEligibility(selectedReferrerId, true)} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50 flex items-center gap-2">
                    <UserCheck className="w-4 h-4" /> Enable milestone
                  </button>
                ) : !detailPayout?.credited_at && (
                  <button type="button" disabled={isTogglingEligibility} onClick={() => selectedReferrerId && void handleSetEligibility(selectedReferrerId, false)} className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm disabled:opacity-50 flex items-center gap-2">
                    <Ban className="w-4 h-4" /> Disable milestone
                  </button>
                )}
                {Boolean(detailPayout?.milestone_reached) && !detailPayout?.credited_at && detailPayout?.payout_status !== 'rejected' && detailPayout?.milestone_eligible !== false && selectedReferrerId && (
                  <>
                    <button type="button" disabled={isApproving} onClick={() => void handleApprovePayout(selectedReferrerId)} className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm disabled:opacity-50">
                      Approve & credit Live Balance
                    </button>
                    <button type="button" onClick={() => void handleRejectPayout(selectedReferrerId)} className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm">Reject</button>
                  </>
                )}
              </div>
            </div>
            <div className={`p-6 rounded-lg mb-6 ${detailPayout?.milestone_eligible === false ? 'bg-red-50 border border-red-200' : 'bg-amber-50'}`}>
              <h3 className="text-xl font-bold mb-2">{(detailReferrer?.display_name as string) || (detailReferrer?.email as string)}</h3>
              <p className="text-sm font-mono text-gray-600 mb-4">{(detailReferrer?.referral_code as string) || '—'}</p>
              {detailPayout?.milestone_eligible === false && (
                <div className="mb-4 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-800">
                  <strong>Excluded from milestone program.</strong>
                  {detailPayout.exclusion_reason ? (
                    <span> Reason: {String(detailPayout.exclusion_reason)}</span>
                  ) : null}
                  {detailPayout.excluded_at ? (
                    <span className="block text-xs text-red-600 mt-1">
                      Excluded {new Date(String(detailPayout.excluded_at)).toLocaleString()}
                    </span>
                  ) : null}
                </div>
              )}
              <p className="text-lg font-semibold text-[#309605]">
                {Number(detailPayout?.qualified_count ?? 0)}/{Number(detailPayout?.target_count ?? target)} qualified → {formatNgn(rewardNgn)} ({formatUsd(rewardUsd)})
              </p>
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-gray-600">Current Live Balance</p>
                  <p className="font-semibold">{formatUsd(Number(detailPayout?.current_live_balance_usd ?? detailReferrer?.current_live_balance_usd ?? 0))}</p>
                </div>
                <div>
                  <p className="text-gray-600">Milestone eligibility</p>
                  <p className={`font-semibold ${detailPayout?.milestone_eligible === false ? 'text-red-700' : 'text-green-700'}`}>
                    {detailPayout?.milestone_eligible === false ? 'Excluded' : 'Eligible'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600">Payout status</p>
                  <p className="font-semibold capitalize">{String(detailPayout?.payout_status ?? 'tracking').replace(/_/g, ' ')}</p>
                </div>
                {detailPayout?.credited_at ? (
                  <>
                    <div>
                      <p className="text-gray-600">Credited</p>
                      <p className="font-semibold text-green-700">{new Date(String(detailPayout.credited_at)).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Balance after credit</p>
                      <p className="font-semibold">{formatUsd(Number(detailPayout.live_balance_after ?? 0))}</p>
                    </div>
                  </>
                ) : (
                  <div>
                    <p className="text-gray-600">Auto-approve</p>
                    <p className="font-semibold">{detailPayout?.auto_approve_payout ? 'On' : 'Off'}</p>
                  </div>
                )}
              </div>
            </div>
            <h4 className="text-lg font-semibold mb-4">Referred users</h4>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm">User</th>
                    <th className="text-left py-3 px-4 text-sm">Active days</th>
                    <th className="text-left py-3 px-4 text-sm">Status</th>
                    <th className="text-left py-3 px-4 text-sm">Notes</th>
                    <th className="text-left py-3 px-4 text-sm">Referred</th>
                  </tr>
                </thead>
                <tbody>
                  {detailQualifications.map((q) => (
                    <tr key={q.referral_id} className="border-b border-gray-100">
                      <td className="py-3 px-4 text-sm">
                        {q.referred_name}
                        {q.flagged_for_abuse && <span className="block text-xs text-red-600 mt-1"><AlertTriangle className="w-3 h-3 inline" /> Treat program flagged</span>}
                      </td>
                      <td className="py-3 px-4 text-sm">{q.active_days} / {q.min_active_days_required}</td>
                      <td className="py-3 px-4"><span className={`px-2 py-1 rounded-full text-xs ${qualStatusClass(q.status)}`}>{q.status}</span></td>
                      <td className="py-3 px-4 text-sm text-gray-600">{q.disqualified_reason || '—'}</td>
                      <td className="py-3 px-4 text-sm">{new Date(q.referral_created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
