import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, DollarSign, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';

type ViewTab = 'dashboard' | 'accounts' | 'journal';

type TrialBalanceRow = {
  account_code: string;
  account_name: string;
  account_type: string;
  debit_total: number;
  credit_total: number;
  net_balance: number;
};

type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  normal_balance: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type JournalEntryRow = {
  id: string;
  entry_date: string;
  source_type: string;
  source_id: string;
  memo: string | null;
  posted_at: string;
};

type AdmobPostResult = {
  ok?: boolean;
  status?: string;
  error?: string;
  entry_id?: string;
  [key: string]: unknown;
};

export const AccountingSection = (): JSX.Element => {
  const [tab, setTab] = useState<ViewTab>('dashboard');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntryRow[]>([]);

  const [postDate, setPostDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [isPostingAdmob, setIsPostingAdmob] = useState(false);
  const [postResult, setPostResult] = useState<AdmobPostResult | null>(null);

  const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(
      Number(amount || 0)
    );
  const formatBalanceWithSide = (amount: number): string => `${formatCurrency(Math.abs(Number(amount || 0)))} ${Number(amount || 0) >= 0 ? 'Dr' : 'Cr'}`;
  const formatDate = (value: string): string => {
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? value : format(dt, 'yyyy-MM-dd');
  };

  const formatDateTime = (value: string): string => {
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? value : format(dt, 'yyyy-MM-dd HH:mm:ss');
  };

  const refreshAll = async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const [{ data: tb, error: tbErr }, { data: acct, error: acctErr }, { data: je, error: jeErr }] = await Promise.all([
        supabase.rpc('admin_get_trial_balance'),
        supabase.from('accounting_accounts').select('*').order('code', { ascending: true }).limit(200),
        supabase.from('accounting_journal_entries').select('id, entry_date, source_type, source_id, memo, posted_at').order('posted_at', { ascending: false }).limit(100),
      ]);

      if (tbErr) throw tbErr;
      if (acctErr) throw acctErr;
      if (jeErr) throw jeErr;

      setTrialBalance((tb || []) as TrialBalanceRow[]);
      setAccounts((acct || []) as AccountRow[]);
      setJournalEntries((je || []) as JournalEntryRow[]);
    } catch (err) {
      console.error('Error loading accounting:', err);
      setError(err instanceof Error ? err.message : 'Failed to load accounting');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const cash = trialBalance.find(r => r.account_code === '1000');
    const creatorPayable = trialBalance.find(r => r.account_code === '2000');
    const platformAdRev = trialBalance.find(r => r.account_code === '4000');
    const treatRev = trialBalance.find(r => r.account_code === '4010');
    return {
      cashNet: cash?.net_balance ?? 0,
      creatorPayableNet: creatorPayable?.net_balance ?? 0,
      platformAdRevNet: platformAdRev?.net_balance ?? 0,
      treatRevNet: treatRev?.net_balance ?? 0,
    };
  }, [trialBalance]);

  const trialBalanceTotals = useMemo(() => {
    const debitTotal = trialBalance.reduce((sum, row) => sum + Number(row.debit_total || 0), 0);
    const creditTotal = trialBalance.reduce((sum, row) => sum + Number(row.credit_total || 0), 0);
    const imbalance = debitTotal - creditTotal;
    return {
      debitTotal,
      creditTotal,
      imbalance,
      isBalanced: Math.abs(imbalance) < 0.005,
    };
  }, [trialBalance]);

  const handlePostAdmobDay = async () => {
    if (!postDate) {
      setError('Please select a valid posting date.');
      return;
    }
    if (!confirm(`Post AdMob cash journal entry for ${postDate}? This is cash-basis and idempotent (won't double-post).`)) return;

    setIsPostingAdmob(true);
    setError(null);
    setSuccess(null);
    setPostResult(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_post_admob_daily_cash', { p_revenue_date: postDate });
      if (rpcErr) throw rpcErr;
      setPostResult(data);
      if (data?.ok) {
        setSuccess(`AdMob posting: ${data.status}`);
      } else {
        setError(data?.error || 'AdMob posting failed');
      }
      await refreshAll();
    } catch (err) {
      console.error('Error posting AdMob day:', err);
      setError(err instanceof Error ? err.message : 'Failed to post AdMob day');
    } finally {
      setIsPostingAdmob(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-900 text-white flex items-center justify-center">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Accounting</h2>
            <p className="text-sm text-gray-500">USD Functional Currency • Cash Basis • Double-Entry Ledger</p>
          </div>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
          title="Refresh"
        >
          <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-100 border border-red-200 rounded-lg">
          <p className="text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-100 border border-green-200 rounded-lg">
          <p className="text-green-700">{success}</p>
        </div>
      )}

      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-1 w-fit">
        {([
          { id: 'dashboard', label: 'Dashboard' },
          { id: 'accounts', label: 'Accounts' },
          { id: 'journal', label: 'Journal' },
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

      {tab === 'dashboard' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow p-5 border border-gray-100">
              <p className="text-xs text-gray-500">Cash (Account 1000, Asset)</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{formatBalanceWithSide(totals.cashNet)}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-5 border border-gray-100">
              <p className="text-xs text-gray-500">Creator Payable (Account 2000, Liability)</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{formatBalanceWithSide(totals.creatorPayableNet)}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-5 border border-gray-100">
              <p className="text-xs text-gray-500">Platform Ad Revenue (Account 4000, Revenue)</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{formatBalanceWithSide(totals.platformAdRevNet)}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-5 border border-gray-100">
              <p className="text-xs text-gray-500">Treat Revenue (Account 4010, Revenue)</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{formatBalanceWithSide(totals.treatRevNet)}</p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-600" />
                <div>
              <p className="font-semibold text-gray-900">Post AdMob Daily Cash Journal Entry</p>
                  <p className="text-xs text-gray-500">Posts a balanced cash-basis journal entry from locked daily input, allocating amounts between Creator Payable and Platform Revenue.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={postDate}
                  onChange={(e) => setPostDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <button
                  type="button"
                  onClick={handlePostAdmobDay}
                  disabled={isPostingAdmob}
                  className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg text-sm disabled:opacity-50"
                >
                  {isPostingAdmob ? 'Posting…' : 'Post Day'}
                </button>
              </div>
            </div>

            {postResult && (
              <details className="mt-4">
                <summary className="text-sm text-gray-600 cursor-pointer">Show Last Posting Result</summary>
                <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-56">
{JSON.stringify(postResult, null, 2)}
                </pre>
              </details>
            )}
          </div>

          <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <p className="font-semibold text-gray-900">Trial Balance</p>
              <div
                className={`inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-full border ${
                  trialBalanceTotals.isBalanced
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'bg-red-50 text-red-700 border-red-200'
                }`}
              >
                {!trialBalanceTotals.isBalanced && <AlertTriangle className="w-3.5 h-3.5" />}
                <span>
                  {trialBalanceTotals.isBalanced
                    ? 'Debits Equal Credits'
                    : `Out of balance by ${formatCurrency(trialBalanceTotals.imbalance)}`}
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="p-2 text-xs text-gray-700 font-medium">Code</th>
                    <th className="p-2 text-xs text-gray-700 font-medium">Account</th>
                    <th className="p-2 text-xs text-gray-700 font-medium">Type</th>
                    <th className="p-2 text-xs text-gray-700 font-medium text-right">Debits</th>
                    <th className="p-2 text-xs text-gray-700 font-medium text-right">Credits</th>
                    <th className="p-2 text-xs text-gray-700 font-medium text-right">Net (Dr/Cr)</th>
                  </tr>
                </thead>
                <tbody>
                  {trialBalance.map((r) => (
                    <tr key={r.account_code} className="border-b border-gray-200">
                      <td className="p-2 text-sm text-gray-700 font-mono">{r.account_code}</td>
                      <td className="p-2 text-sm text-gray-900">{r.account_name}</td>
                      <td className="p-2 text-sm text-gray-600 capitalize">{r.account_type}</td>
                      <td className="p-2 text-sm text-gray-700 text-right">{formatCurrency(Number(r.debit_total || 0))}</td>
                      <td className="p-2 text-sm text-gray-700 text-right">{formatCurrency(Number(r.credit_total || 0))}</td>
                      <td className="p-2 text-sm text-gray-900 text-right font-medium">
                        {formatBalanceWithSide(Number(r.net_balance || 0))}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 border-t-2 border-gray-300">
                    <td className="p-2 text-sm text-gray-900 font-semibold" colSpan={3}>Totals</td>
                    <td className="p-2 text-sm text-gray-900 text-right font-semibold">{formatCurrency(trialBalanceTotals.debitTotal)}</td>
                    <td className="p-2 text-sm text-gray-900 text-right font-semibold">{formatCurrency(trialBalanceTotals.creditTotal)}</td>
                    <td className="p-2 text-sm text-gray-900 text-right font-semibold">
                      {formatBalanceWithSide(trialBalanceTotals.imbalance)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'accounts' && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
          <p className="font-semibold text-gray-900 mb-3">Chart of Accounts</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-2 text-xs text-gray-700 font-medium">Code</th>
                  <th className="p-2 text-xs text-gray-700 font-medium">Name</th>
                  <th className="p-2 text-xs text-gray-700 font-medium">Type</th>
                  <th className="p-2 text-xs text-gray-700 font-medium">Normal Balance (Dr/Cr)</th>
                  <th className="p-2 text-xs text-gray-700 font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map(a => (
                  <tr key={a.id} className="border-b border-gray-200">
                    <td className="p-2 text-sm font-mono text-gray-700">{a.code}</td>
                    <td className="p-2 text-sm text-gray-900">{a.name}</td>
                    <td className="p-2 text-sm text-gray-600 capitalize">{a.type}</td>
                    <td className="p-2 text-sm text-gray-600 capitalize">{a.normal_balance}</td>
                    <td className="p-2 text-sm text-gray-700">{a.is_active ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'journal' && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
          <p className="font-semibold text-gray-900 mb-3">Journal Entries (Most Recent 100)</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-2 text-xs text-gray-700 font-medium">Date</th>
                  <th className="p-2 text-xs text-gray-700 font-medium">Source</th>
                  <th className="p-2 text-xs text-gray-700 font-medium">Source ID</th>
                  <th className="p-2 text-xs text-gray-700 font-medium">Memo</th>
                  <th className="p-2 text-xs text-gray-700 font-medium">Posted</th>
                </tr>
              </thead>
              <tbody>
                {journalEntries.map(e => (
                  <tr key={e.id} className="border-b border-gray-200">
                    <td className="p-2 text-sm text-gray-700 font-medium">{formatDate(e.entry_date)}</td>
                    <td className="p-2 text-sm text-gray-700">{e.source_type}</td>
                    <td className="p-2 text-sm text-gray-700 font-mono">{e.source_id}</td>
                    <td className="p-2 text-sm text-gray-700">{e.memo || '—'}</td>
                    <td className="p-2 text-sm text-gray-500">{formatDateTime(e.posted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Note: Posting is idempotent per source (`source_type` + `source_id`), so each locked date should be posted once.
          </p>
        </div>
      )}
    </div>
  );
};

