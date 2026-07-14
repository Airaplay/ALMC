import { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, Clock, DollarSign, RefreshCw, User, Eye, CheckCheck, XCircle, Activity, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface UncreditedPayment {
  payment_id: string;
  user_id: string;
  display_name: string;
  email: string;
  amount: string;
  currency: string;
  payment_method: string;
  payment_status: string;
  completed_at: string;
  payment_created: string;
  package_name: string;
  treats_amount: string;
  bonus_amount: string;
  total_treats: string;
  hours_since_completion: string;
}

interface StuckPendingPayment {
  payment_id: string;
  user_id: string;
  display_name: string;
  email: string;
  amount: string;
  currency: string;
  payment_method: string;
  payment_status: string;
  completed_at: string | null;
  payment_created: string;
  external_reference: string | null;
  package_name: string;
  treats_amount: string;
  bonus_amount: string;
  total_treats: string;
  hours_since_creation: string;
  hours_since_completion: string | null;
  has_completed_transaction: boolean;
  transaction_attempts: number;
}

interface PaymentAlert {
  id: string;
  alert_type: string;
  severity: string;
  payment_id: string;
  user_id: string;
  title: string;
  description: string;
  metadata: any;
  status: string;
  created_at: string;
  resolved_at?: string;
  resolution_notes?: string;
}

interface TreatTransaction {
  id: string;
  user_id: string;
  display_name: string;
  email: string;
  transaction_type: string;
  amount: string;
  balance_before: string;
  balance_after: string;
  description: string;
  payment_method: string;
  payment_reference: string;
  status: string;
  created_at: string;
  metadata: any;
}

interface WalletConsistency {
  user_id: string;
  is_consistent: boolean;
  wallet: {
    balance: string;
    purchased_balance: string;
    earned_balance: string;
    total_spent: string;
  };
  calculated: {
    balance: string;
    purchased_balance: string;
    earned_balance: string;
    total_spent: string;
  };
  issues: any[];
  checked_at: string;
}

export const PaymentMonitoringSection = (): JSX.Element => {
  const [uncreditedPayments, setUncreditedPayments] = useState<UncreditedPayment[]>([]);
  const [stuckPendingPayments, setStuckPendingPayments] = useState<StuckPendingPayment[]>([]);
  const [paymentAlerts, setPaymentAlerts] = useState<PaymentAlert[]>([]);
  const [transactions, setTransactions] = useState<TreatTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'uncredited' | 'stuck' | 'alerts' | 'transactions'>('uncredited');
  const [reconcilingPayment, setReconcilingPayment] = useState<string | null>(null);
  const [checkingWallet, setCheckingWallet] = useState<string | null>(null);
  const [walletCheck, setWalletCheck] = useState<WalletConsistency | null>(null);
  const [creditingPayment, setCreditingPayment] = useState<string | null>(null);
  const [resolvingAlert, setResolvingAlert] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<TreatTransaction | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'month' | 'year'>('all');
  const [selectedTransactions, setSelectedTransactions] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);

      // Use RPC function to bypass RLS restrictions
      const { data: uncreditedData, error: uncreditedError } = await supabase
        .rpc('get_uncredited_payments');

      if (uncreditedError) {
        console.error('Error loading uncredited payments:', uncreditedError);
        // Fallback to direct view query if function fails
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('uncredited_payments')
          .select('*')
          .order('completed_at', { ascending: false });
        
        if (fallbackError) {
          console.error('Fallback query also failed:', fallbackError);
          setUncreditedPayments([]);
        } else {
          setUncreditedPayments(fallbackData || []);
        }
      } else {
        // Sort by completed_at descending (function already orders, but ensure it)
        const sortedData = (uncreditedData || []).sort((a, b) => {
          const dateA = new Date(a.completed_at).getTime();
          const dateB = new Date(b.completed_at).getTime();
          return dateB - dateA;
        });
        setUncreditedPayments(sortedData);
      }

      const { data: transactionsData, error: transactionsError } = await supabase
        .from('treat_transactions')
        .select(`
          *,
          users!treat_transactions_user_id_fkey (
            display_name,
            email
          )
        `)
        .eq('transaction_type', 'purchase')
        .order('created_at', { ascending: false })
        .limit(100);

      if (transactionsError) {
        console.error('Error loading transactions:', transactionsError);
      } else {
        const formattedTransactions = (transactionsData || []).map((t: any) => ({
          ...t,
          display_name: t.users?.display_name || 'Unknown',
          email: t.users?.email || 'N/A'
        }));
        setTransactions(formattedTransactions);
      }

      // Load stuck pending payments
      const { data: stuckData, error: stuckError } = await supabase
        .from('stuck_pending_payments')
        .select('*')
        .order('payment_created', { ascending: false });

      if (stuckError) {
        console.error('Error loading stuck pending payments:', stuckError);
        setStuckPendingPayments([]);
      } else {
        setStuckPendingPayments(stuckData || []);
      }

      const { data: alertsData, error: alertsError } = await supabase
        .from('payment_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (alertsError) {
        console.error('Error loading payment alerts:', alertsError);
      } else {
        setPaymentAlerts(alertsData || []);
      }
    } catch (error) {
      console.error('Error loading monitoring data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const runMonitoring = async () => {
    try {
      setIsRefreshing(true);

      const { data, error } = await supabase.rpc('monitor_uncredited_payments');

      if (error) {
        console.error('Error running monitoring:', error);
        alert('Error running monitoring check: ' + error.message);
      } else {
        alert(`Monitoring complete:\n• ${data.uncredited_payments_found} uncredited payments found\n• ${data.new_alerts_created} new alerts created`);
        await loadData();
      }
    } catch (error) {
      console.error('Error running monitoring:', error);
      alert('Error running monitoring check');
    } finally {
      setIsRefreshing(false);
    }
  };

  const checkWalletConsistency = async (userId: string) => {
    try {
      setCheckingWallet(userId);

      const { data, error } = await supabase.rpc('check_wallet_consistency', {
        p_user_id: userId
      });

      if (error) {
        console.error('Error checking wallet:', error);
        alert('Error checking wallet consistency: ' + error.message);
      } else {
        setWalletCheck(data);
      }
    } catch (error) {
      console.error('Error checking wallet:', error);
      alert('Error checking wallet consistency');
    } finally {
      setCheckingWallet(null);
    }
  };

  const creditPaymentManually = async (payment: UncreditedPayment) => {
    if (!confirm(`Credit ${payment.total_treats} treats to ${payment.display_name}?\n\nThis will:\n• Add ${payment.total_treats} treats to their wallet\n• Create a transaction record\n• Update purchased balance`)) {
      return;
    }

    try {
      setCreditingPayment(payment.payment_id);

      const { data, error } = await supabase.rpc('admin_credit_payment_manually', {
        p_user_id: payment.user_id,
        p_payment_id: payment.payment_id,
        p_total_treats: Number(payment.total_treats),
        p_treats_amount: Number(payment.treats_amount),
        p_bonus_amount: Number(payment.bonus_amount),
        p_package_name: payment.package_name,
        p_payment_method: payment.payment_method,
        p_amount: Number(payment.amount),
        p_currency: payment.currency
      });

      if (error) {
        throw error;
      }

      if (data && !data.success) {
        alert(`Payment Already Credited!\n\n${data.message}\n\nThis payment has already been processed. No action taken.`);
        await loadData();
        return;
      }

      alert(`Successfully credited ${payment.total_treats} treats to ${payment.display_name}!\n\nPrevious balance: ${data.previous_balance}\nNew balance: ${data.new_balance}`);
      await loadData();
    } catch (error: any) {
      console.error('Error crediting payment:', error);
      alert('Error crediting payment: ' + (error.message || 'Unknown error'));
    } finally {
      setCreditingPayment(null);
    }
  };

  const reconcilePayment = async (paymentId: string) => {
    if (!confirm(`Reconcile this payment?\n\nThis will:\n• Verify payment status with Flutterwave\n• Credit treats if payment was successful\n• Update payment status to completed`)) {
      return;
    }

    try {
      setReconcilingPayment(paymentId);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      // Get Supabase URL from environment
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URL not configured');
      }
      const functionUrl = `${supabaseUrl}/functions/v1/reconcile-payments?payment_id=${paymentId}`;

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Reconciliation failed');
      }

      if (result.results) {
        const { verified, credited, already_credited, failed } = result.results;
        let message = `Reconciliation complete!\n\n`;
        if (credited > 0) {
          message += `✅ ${credited} payment(s) verified and credited\n`;
        }
        if (already_credited > 0) {
          message += `ℹ️ ${already_credited} payment(s) already credited\n`;
        }
        if (verified > credited) {
          message += `⚠️ ${verified - credited} payment(s) verified but not credited (activation failed)\n`;
        }
        if (failed > 0) {
          message += `❌ ${failed} payment(s) failed to reconcile\n`;
        }
        alert(message);
      } else {
        alert(result.message || 'Reconciliation completed');
      }

      await loadData();
    } catch (error: any) {
      console.error('Error reconciling payment:', error);
      alert('Error reconciling payment: ' + (error.message || 'Unknown error'));
    } finally {
      setReconcilingPayment(null);
    }
  };

  const resolveAlert = async (alert: PaymentAlert) => {
    const notes = prompt('Enter resolution notes:');
    if (!notes) return;

    try {
      setResolvingAlert(alert.id);

      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('payment_alerts')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id,
          resolution_notes: notes
        })
        .eq('id', alert.id);

      if (error) throw error;

      alert('Alert resolved successfully');
      await loadData();
    } catch (error: any) {
      console.error('Error resolving alert:', error);
      alert('Error resolving alert: ' + (error.message || 'Unknown error'));
    } finally {
      setResolvingAlert(null);
    }
  };

  const filterTransactionsByDate = (transactions: TreatTransaction[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisYear = new Date(now.getFullYear(), 0, 1);

    return transactions.filter(tx => {
      const txDate = new Date(tx.created_at);

      switch (dateFilter) {
        case 'today':
          return txDate >= today;
        case 'month':
          return txDate >= thisMonth;
        case 'year':
          return txDate >= thisYear;
        default:
          return true;
      }
    });
  };

  const filterTransactionsBySearch = (transactions: TreatTransaction[]) => {
    if (!searchQuery.trim()) return transactions;

    const query = searchQuery.toLowerCase();
    return transactions.filter(tx =>
      tx.display_name.toLowerCase().includes(query) ||
      tx.email.toLowerCase().includes(query) ||
      tx.description.toLowerCase().includes(query) ||
      tx.payment_reference?.toLowerCase().includes(query) ||
      tx.id.toLowerCase().includes(query)
    );
  };

  const getFilteredTransactions = () => {
    let filtered = [...transactions];
    filtered = filterTransactionsByDate(filtered);
    filtered = filterTransactionsBySearch(filtered);
    return filtered;
  };

  const toggleSelectTransaction = (id: string) => {
    const newSelected = new Set(selectedTransactions);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedTransactions(newSelected);
  };

  const toggleSelectAll = () => {
    const filtered = getFilteredTransactions();
    if (selectedTransactions.size === filtered.length && filtered.length > 0) {
      setSelectedTransactions(new Set());
    } else {
      setSelectedTransactions(new Set(filtered.map(tx => tx.id)));
    }
  };

  const deleteSelectedTransactions = async () => {
    if (selectedTransactions.size === 0) {
      alert('No transactions selected');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedTransactions.size} transaction(s)?\n\nThis action cannot be undone.`)) {
      return;
    }

    try {
      setIsDeleting(true);

      const { error } = await supabase
        .from('treat_transactions')
        .delete()
        .in('id', Array.from(selectedTransactions));

      if (error) throw error;

      alert(`Successfully deleted ${selectedTransactions.size} transaction(s)`);
      setSelectedTransactions(new Set());
      await loadData();
    } catch (error: any) {
      console.error('Error deleting transactions:', error);
      alert('Error deleting transactions: ' + (error.message || 'Unknown error'));
    } finally {
      setIsDeleting(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-700 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'low': return 'bg-blue-100 text-blue-700 border-blue-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const formatHours = (hours: string) => {
    const h = parseFloat(hours);
    if (h < 1) return `${Math.round(h * 60)} minutes`;
    if (h < 24) return `${h.toFixed(1)} hours`;
    return `${(h / 24).toFixed(1)} days`;
  };

  if (isLoading) {
    return (
      <div className="space-y-4 min-h-full animate-pulse">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gray-100" />
          <div className="space-y-1.5">
            <div className="h-5 w-44 bg-gray-100 rounded-md" />
            <div className="h-3.5 w-64 bg-gray-100 rounded-md" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-2">
              <div className="h-3.5 w-24 bg-gray-100 rounded" />
              <div className="h-7 w-16 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Activity className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Payment Monitoring</h2>
            <p className="text-sm text-gray-400 mt-0.5">Track and manage payment transactions in real-time</p>
          </div>
        </div>
        <button
          onClick={runMonitoring}
          disabled={isRefreshing}
          className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-[#309605] hover:bg-[#3ba208] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Run Check
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-md bg-red-50 flex items-center justify-center">
              <AlertCircle className="w-3.5 h-3.5 text-red-500" />
            </div>
            <p className="text-xs font-medium text-gray-500">Uncredited</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{uncreditedPayments.length}</p>
          <p className="text-xs text-gray-400 mt-0.5">payments</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-md bg-yellow-50 flex items-center justify-center">
              <Clock className="w-3.5 h-3.5 text-yellow-500" />
            </div>
            <p className="text-xs font-medium text-gray-500">Stuck Pending</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stuckPendingPayments.length}</p>
          <p className="text-xs text-gray-400 mt-0.5">payments</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-md bg-orange-50 flex items-center justify-center">
              <AlertCircle className="w-3.5 h-3.5 text-orange-500" />
            </div>
            <p className="text-xs font-medium text-gray-500">Pending Alerts</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{paymentAlerts.filter(a => a.status === 'pending').length}</p>
          <p className="text-xs text-gray-400 mt-0.5">unresolved</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
              <CheckCircle className="w-3.5 h-3.5 text-green-600" />
            </div>
            <p className="text-xs font-medium text-gray-500">Resolved</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{paymentAlerts.filter(a => a.status === 'resolved').length}</p>
          <p className="text-xs text-gray-400 mt-0.5">alerts</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="border-b border-gray-100">
          <nav className="flex px-2 gap-0.5 overflow-x-auto">
            {([
              { key: 'uncredited', label: 'Uncredited', count: uncreditedPayments.length },
              { key: 'stuck', label: 'Stuck Pending', count: stuckPendingPayments.length },
              { key: 'alerts', label: 'Alerts', count: paymentAlerts.filter(a => a.status === 'pending').length },
              { key: 'transactions', label: 'Transactions', count: transactions.length },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setSelectedTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  selectedTab === tab.key
                    ? 'border-[#309605] text-[#309605]'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200'
                }`}
              >
                {tab.label}
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                  selectedTab === tab.key ? 'bg-green-50 text-[#309605]' : 'bg-gray-100 text-gray-500'
                }`}>{tab.count}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4">
          {selectedTab === 'uncredited' ? (
            <div className="space-y-3">
              {uncreditedPayments.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  </div>
                  <p className="text-sm font-semibold text-gray-800 mb-1">All Payments Credited</p>
                  <p className="text-xs text-gray-500">No uncredited payments found</p>
                </div>
              ) : (
                uncreditedPayments.map((payment) => (
                  <div key={payment.payment_id} className="bg-gray-50 border border-gray-100 rounded-xl p-4 hover:border-red-200 transition-colors">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                          <User className="w-4 h-4 text-red-500" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{payment.display_name}</p>
                          <p className="text-xs text-gray-500">{payment.email}</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-gray-900">{payment.total_treats} Treats</p>
                        <p className="text-xs text-gray-500">{payment.amount} {payment.currency}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                      {[
                        { label: 'Package', value: payment.package_name },
                        { label: 'Method', value: payment.payment_method },
                        { label: 'Completed', value: `${formatHours(payment.hours_since_completion)} ago` },
                        { label: 'Status', value: null },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-white rounded-lg px-3 py-2 border border-gray-100">
                          <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                          {value ? (
                            <p className="text-xs font-medium text-gray-800 capitalize">{value}</p>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                              <XCircle className="w-3 h-3" />
                              Uncredited
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => checkWalletConsistency(payment.user_id)}
                        disabled={checkingWallet === payment.user_id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-100 text-blue-700 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        {checkingWallet === payment.user_id ? 'Checking...' : 'Check Wallet'}
                      </button>
                      <button
                        onClick={() => creditPaymentManually(payment)}
                        disabled={creditingPayment === payment.payment_id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#309605] hover:bg-[#3ba208] text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                      >
                        <DollarSign className="w-3.5 h-3.5" />
                        {creditingPayment === payment.payment_id ? 'Crediting...' : 'Credit Now'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : selectedTab === 'stuck' ? (
            <div className="space-y-3">
              {stuckPendingPayments.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  </div>
                  <p className="text-sm font-semibold text-gray-800 mb-1">No Stuck Payments</p>
                  <p className="text-xs text-gray-500">All pending payments are processing normally</p>
                </div>
              ) : (
                <>
                  <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg">
                    <p className="text-xs text-amber-700">These payments are stuck in pending. They may have been successful on Flutterwave but the webhook was not received. Use Reconcile to verify and credit.</p>
                  </div>
                  {stuckPendingPayments.map((payment) => (
                    <div key={payment.payment_id} className="bg-gray-50 border border-gray-100 rounded-xl p-4 hover:border-yellow-200 transition-colors">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-yellow-50 flex items-center justify-center flex-shrink-0">
                            <Clock className="w-4 h-4 text-yellow-500" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{payment.display_name}</p>
                            <p className="text-xs text-gray-500">{payment.email}</p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-gray-900">{payment.total_treats} Treats</p>
                          <p className="text-xs text-gray-500">{payment.amount} {payment.currency}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                        {[
                          { label: 'Package', value: payment.package_name },
                          { label: 'Method', value: payment.payment_method },
                          { label: 'Stuck For', value: `${formatHours(payment.hours_since_creation)} ago` },
                          { label: 'External Ref', value: payment.external_reference || 'N/A' },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-white rounded-lg px-3 py-2 border border-gray-100">
                            <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                            <p className="text-xs font-medium text-gray-800 capitalize truncate">{value}</p>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => reconcilePayment(payment.payment_id)}
                        disabled={reconcilingPayment === payment.payment_id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#309605] hover:bg-[#3ba208] text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${reconcilingPayment === payment.payment_id ? 'animate-spin' : ''}`} />
                        {reconcilingPayment === payment.payment_id ? 'Reconciling...' : 'Reconcile & Credit'}
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          ) : selectedTab === 'alerts' ? (
            <div className="space-y-3">
              {paymentAlerts.filter(a => a.status === 'pending').length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  </div>
                  <p className="text-sm font-semibold text-gray-800 mb-1">No Pending Alerts</p>
                  <p className="text-xs text-gray-500">All payment alerts have been resolved</p>
                </div>
              ) : (
                paymentAlerts.filter(a => a.status === 'pending').map((alert) => (
                  <div key={alert.id} className="bg-gray-50 border border-gray-100 rounded-xl p-4 hover:border-orange-200 transition-colors">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-start gap-2.5 flex-1">
                        <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertCircle className="w-4 h-4 text-orange-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{alert.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{alert.description}</p>
                        </div>
                      </div>
                      <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border ${getSeverityColor(alert.severity)}`}>
                        {alert.severity}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {[
                        { label: 'Type', value: alert.alert_type.replace('_', ' ') },
                        { label: 'Created', value: new Date(alert.created_at).toLocaleDateString() },
                        { label: 'Status', value: alert.status },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-white rounded-lg px-3 py-2 border border-gray-100">
                          <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                          <p className="text-xs font-medium text-gray-800 capitalize">{value}</p>
                        </div>
                      ))}
                    </div>
                    {alert.metadata && (
                      <div className="bg-white rounded-lg p-3 mb-3 border border-gray-100">
                        <p className="text-xs font-medium text-gray-500 mb-1.5">Details</p>
                        <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-x-auto">
                          {JSON.stringify(alert.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                    <button
                      onClick={() => resolveAlert(alert)}
                      disabled={resolvingAlert === alert.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 hover:bg-green-100 border border-green-100 text-green-700 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      {resolvingAlert === alert.id ? 'Resolving...' : 'Resolve Alert'}
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : selectedTab === 'transactions' ? (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search by name, email, description, or reference..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value as any)}
                    className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                  >
                    <option value="all">All Time</option>
                    <option value="today">Today</option>
                    <option value="month">This Month</option>
                    <option value="year">This Year</option>
                  </select>
                  {selectedTransactions.size > 0 && (
                    <button
                      onClick={deleteSelectedTransactions}
                      disabled={isDeleting}
                      className="flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 border border-red-100 text-red-600 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      Delete ({selectedTransactions.size})
                    </button>
                  )}
                </div>
              </div>

              {transactions.length === 0 ? (
                <div className="text-center py-12">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                    <DollarSign className="w-8 h-8 text-gray-600" />
                  </div>
                  <p className="text-xl font-semibold text-gray-900 mb-2">No Transactions Found</p>
                  <p className="text-gray-600">No purchase transactions to display</p>
                </div>
              ) : getFilteredTransactions().length === 0 ? (
                <div className="text-center py-12">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                    <DollarSign className="w-8 h-8 text-gray-600" />
                  </div>
                  <p className="text-xl font-semibold text-gray-900 mb-2">No Matching Transactions</p>
                  <p className="text-gray-600">Try adjusting your search or filters</p>
                </div>
              ) : (
                <div className="overflow-x-auto scrollbar-hide">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedTransactions.size === getFilteredTransactions().length && getFilteredTransactions().length > 0}
                            onChange={toggleSelectAll}
                            className="w-4 h-4 text-[#309605] border-gray-300 rounded focus:ring-[#309605]"
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Balance Change</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payment Ref</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {getFilteredTransactions().map((tx) => (
                        <tr
                          key={tx.id}
                          className="hover:bg-gray-50 transition-colors"
                        >
                          <td className="px-4 py-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedTransactions.has(tx.id)}
                              onChange={() => toggleSelectTransaction(tx.id)}
                              className="w-4 h-4 text-[#309605] border-gray-300 rounded focus:ring-[#309605]"
                            />
                          </td>
                          <td
                            className="px-4 py-4 whitespace-nowrap cursor-pointer"
                            onClick={() => setSelectedTransaction(tx)}
                          >
                            <div>
                              <div className="text-sm font-medium text-gray-900">{tx.display_name}</div>
                              <div className="text-xs text-gray-500">{tx.email}</div>
                            </div>
                          </td>
                          <td
                            className="px-4 py-4 cursor-pointer"
                            onClick={() => setSelectedTransaction(tx)}
                          >
                            <div className="text-sm text-gray-900 max-w-xs truncate" title={tx.description}>
                              {tx.description}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              via {tx.payment_method || 'N/A'}
                            </div>
                          </td>
                          <td
                            className="px-4 py-4 whitespace-nowrap cursor-pointer"
                            onClick={() => setSelectedTransaction(tx)}
                          >
                            <span className="text-sm font-semibold text-green-600">
                              +{tx.amount} treats
                            </span>
                          </td>
                          <td
                            className="px-4 py-4 whitespace-nowrap cursor-pointer"
                            onClick={() => setSelectedTransaction(tx)}
                          >
                            <div className="text-xs text-gray-600">
                              {tx.balance_before} → {tx.balance_after}
                            </div>
                          </td>
                          <td
                            className="px-4 py-4 whitespace-nowrap cursor-pointer"
                            onClick={() => setSelectedTransaction(tx)}
                          >
                            <div className="text-xs font-mono text-gray-500 max-w-[120px] truncate" title={tx.payment_reference}>
                              {tx.payment_reference || 'N/A'}
                            </div>
                          </td>
                          <td
                            className="px-4 py-4 whitespace-nowrap cursor-pointer"
                            onClick={() => setSelectedTransaction(tx)}
                          >
                            <div className="text-sm text-gray-900">
                              {new Date(tx.created_at).toLocaleDateString()}
                            </div>
                            <div className="text-xs text-gray-500">
                              {new Date(tx.created_at).toLocaleTimeString()}
                            </div>
                          </td>
                          <td
                            className="px-4 py-4 whitespace-nowrap cursor-pointer"
                            onClick={() => setSelectedTransaction(tx)}
                          >
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              tx.status === 'completed'
                                ? 'bg-green-100 text-green-800'
                                : tx.status === 'failed'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {tx.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {walletCheck && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto border border-gray-200 shadow-xl">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-gray-900">Wallet Consistency Check</h3>
                <button
                  onClick={() => setWalletCheck(null)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className={`p-4 rounded-lg mb-4 border ${
                walletCheck.is_consistent
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}>
                <p className="text-gray-900 font-semibold">
                  {walletCheck.is_consistent ? '✓ Wallet is Consistent' : '✗ Wallet Inconsistencies Detected'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Wallet Values</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Balance:</span>
                      <span className="text-gray-900 font-medium">{walletCheck.wallet.balance}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Purchased:</span>
                      <span className="text-gray-900 font-medium">{walletCheck.wallet.purchased_balance}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Earned:</span>
                      <span className="text-gray-900 font-medium">{walletCheck.wallet.earned_balance}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Spent:</span>
                      <span className="text-gray-900 font-medium">{walletCheck.wallet.total_spent}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Calculated Values</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Balance:</span>
                      <span className="text-gray-900 font-medium">{walletCheck.calculated.balance}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Purchased:</span>
                      <span className="text-gray-900 font-medium">{walletCheck.calculated.purchased_balance}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Earned:</span>
                      <span className="text-gray-900 font-medium">{walletCheck.calculated.earned_balance}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Spent:</span>
                      <span className="text-gray-900 font-medium">{walletCheck.calculated.total_spent}</span>
                    </div>
                  </div>
                </div>
              </div>

              {walletCheck.issues && walletCheck.issues.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-red-700 mb-3">Issues Found</h4>
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto scrollbar-hide">
                    {JSON.stringify(walletCheck.issues, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedTransaction && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-3xl w-full max-h-[80vh] overflow-y-auto border border-gray-200 shadow-xl">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-900">Transaction Details</h3>
                <button
                  onClick={() => setSelectedTransaction(null)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className="space-y-6">
                {/* Status Badge */}
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Transaction Status</p>
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                      selectedTransaction.status === 'completed'
                        ? 'bg-green-100 text-green-800'
                        : selectedTransaction.status === 'failed'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {selectedTransaction.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600 mb-1">Amount</p>
                    <p className="text-2xl font-bold text-green-600">+{selectedTransaction.amount} treats</p>
                  </div>
                </div>

                {/* User Information */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">User Information</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Display Name</p>
                      <p className="text-sm text-gray-900 font-medium">{selectedTransaction.display_name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Email</p>
                      <p className="text-sm text-gray-900">{selectedTransaction.email}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">User ID</p>
                      <p className="text-xs text-gray-900 font-mono">{selectedTransaction.user_id}</p>
                    </div>
                  </div>
                </div>

                {/* Transaction Information */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Transaction Information</h4>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Description</p>
                      <p className="text-sm text-gray-900">{selectedTransaction.description}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Transaction Type</p>
                        <p className="text-sm text-gray-900 capitalize">{selectedTransaction.transaction_type.replace('_', ' ')}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Payment Method</p>
                        <p className="text-sm text-gray-900 capitalize">{selectedTransaction.payment_method || 'N/A'}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Payment Reference</p>
                      <p className="text-xs text-gray-900 font-mono break-all">{selectedTransaction.payment_reference || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Transaction ID</p>
                      <p className="text-xs text-gray-900 font-mono break-all">{selectedTransaction.id}</p>
                    </div>
                  </div>
                </div>

                {/* Balance Information */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Balance Changes</h4>
                  <div className="flex items-center justify-center gap-4 p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg">
                    <div className="text-center">
                      <p className="text-xs text-gray-600 mb-1">Before</p>
                      <p className="text-2xl font-bold text-gray-900">{selectedTransaction.balance_before}</p>
                    </div>
                    <div className="text-2xl text-gray-400">→</div>
                    <div className="text-center">
                      <p className="text-xs text-gray-600 mb-1">After</p>
                      <p className="text-2xl font-bold text-green-600">{selectedTransaction.balance_after}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-600 mb-1">Change</p>
                      <p className="text-2xl font-bold text-green-600">+{selectedTransaction.amount}</p>
                    </div>
                  </div>
                </div>

                {/* Timestamp */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Timestamp</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Date</p>
                      <p className="text-sm text-gray-900">{new Date(selectedTransaction.created_at).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Time</p>
                      <p className="text-sm text-gray-900">{new Date(selectedTransaction.created_at).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true
                      })}</p>
                    </div>
                  </div>
                </div>

                {/* Metadata */}
                {selectedTransaction.metadata && Object.keys(selectedTransaction.metadata).length > 0 && (
                  <div className="border-t border-gray-200 pt-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">Additional Metadata</h4>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto scrollbar-hide">
                        {JSON.stringify(selectedTransaction.metadata, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-gray-200 flex justify-end">
                <button
                  onClick={() => setSelectedTransaction(null)}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
