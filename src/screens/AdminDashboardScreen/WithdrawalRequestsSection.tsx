import { useState, useEffect } from 'react';
import {
  DollarSign,
  Check,
  X,
  RefreshCw,
  Download,
  CheckSquare,
  Square,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';

interface WithdrawalRequest {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string;
  amount: number;
  transaction_id: string | null;
  user_country: string | null;
  exchange_rate_applied: number | null;
  service_fee_type: string | null;
  service_fee_value: number | null;
  gross_amount: number | null;
  fee_amount: number | null;
  net_amount: number | null;
  amount_usd: number | null;
  amount_local: number | null;
  currency_code: string | null;
  currency_symbol: string | null;
  currency_name: string | null;
  balance_before: number | null;
  balance_after: number | null;
  wallet_address: string;
  method_type: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_holder_name: string | null;
  swift_code: string | null;
  country: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  requested_date: string;
  processed_date: string | null;
  admin_notes: string | null;
  payment_reference: string | null;
  payment_completed_date: string | null;
}

export const WithdrawalRequestsSection = (): JSX.Element => {
  const [withdrawalRequests, setWithdrawalRequests] = useState<WithdrawalRequest[]>([]);
  const [isLoadingWithdrawals, setIsLoadingWithdrawals] = useState(true);
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null);
  const [withdrawalStatusFilter, setWithdrawalStatusFilter] = useState<string>('pending');
  const [processingWithdrawal, setProcessingWithdrawal] = useState<string | null>(null);
  const [withdrawalActionSuccess, setWithdrawalActionSuccess] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState<string>('');
  const [showNotesModal, setShowNotesModal] = useState<boolean>(false);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalRequest | null>(null);
  const [withdrawalAction, setWithdrawalAction] = useState<'approve' | 'reject' | 'complete' | null>(null);
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [selectedWithdrawals, setSelectedWithdrawals] = useState<Set<string>>(new Set());
  const [showBulkNotesModal, setShowBulkNotesModal] = useState<boolean>(false);
  const [bulkAction, setBulkAction] = useState<'approve' | 'reject' | 'complete' | null>(null);
  const [bulkAdminNotes, setBulkAdminNotes] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  const [anomalies, setAnomalies] = useState<Map<string, {type: string, severity: string, difference: number}>>(new Map());

  const runEmailQueueNowBestEffort = async (): Promise<void> => {
    try {
      await supabase.functions.invoke('process-email-queue', {
        method: 'POST',
        body: { ignore_scheduled_for: true },
      });
    } catch {
      // Never block admin actions on email delivery; failures are visible in Email Logs.
    }
  };

  const formatRpcError = (err: any): string => {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    // Supabase/PostgREST errors commonly have: message, details, hint, code
    const msg = err.message || err.error_description || err.error || 'Request failed';
    const details = err.details || err.hint || err.code;
    return details ? `${msg} (${details})` : msg;
  };

  const ensureRpcJsonOk = (data: any): void => {
    // Many admin RPCs return jsonb like { success: true } or { error: "..." }.
    // Some Supabase client versions may return arrays, so handle both.
    const payload = Array.isArray(data) ? data[0] : data;
    if (payload && typeof payload === 'object' && 'error' in payload && payload.error) {
      throw new Error(String(payload.error));
    }
    if (payload && typeof payload === 'object' && 'success' in payload && payload.success === false) {
      throw new Error(payload.message ? String(payload.message) : 'Operation failed');
    }
  };

  useEffect(() => {
    fetchWithdrawalRequests();
  }, []);

  useEffect(() => {
    fetchWithdrawalRequests();
  }, [withdrawalStatusFilter]);

  const fetchWithdrawalRequests = async () => {
    try {
      setIsLoadingWithdrawals(true);
      setWithdrawalError(null);

      const { data, error } = await supabase.rpc('admin_get_withdrawal_requests', {
        p_status: withdrawalStatusFilter === 'all' ? null : withdrawalStatusFilter
      });

      if (error) {
        console.error('Supabase RPC error:', error);
        throw error;
      }

      setWithdrawalRequests(data || []);

      // Fetch anomalies for fraud detection
      fetchAnomalies();
    } catch (err: any) {
      console.error('Error fetching withdrawal requests:', err);
      const errorMessage = err?.message || 'Failed to load withdrawal requests';
      setWithdrawalError(errorMessage);
    } finally {
      setIsLoadingWithdrawals(false);
    }
  };

  const fetchAnomalies = async () => {
    try {
      const { data, error } = await supabase.rpc('admin_detect_withdrawal_anomalies', {
        p_status: withdrawalStatusFilter === 'all' ? null : withdrawalStatusFilter
      });

      if (error) {
        console.error('Error fetching anomalies:', error);
        return;
      }

      const anomalyMap = new Map();
      data?.forEach((anomaly: any) => {
        anomalyMap.set(anomaly.withdrawal_id, {
          type: anomaly.anomaly_type,
          severity: anomaly.anomaly_severity,
          difference: anomaly.balance_difference
        });
      });
      setAnomalies(anomalyMap);
    } catch (err) {
      console.error('Error fetching anomalies:', err);
    }
  };

  const handleApproveWithdrawal = async (withdrawal: WithdrawalRequest) => {
    setSelectedWithdrawal(withdrawal);
    setWithdrawalAction('approve');
    setAdminNotes('');
    setShowNotesModal(true);
  };

  const handleRejectWithdrawal = async (withdrawal: WithdrawalRequest) => {
    setSelectedWithdrawal(withdrawal);
    setWithdrawalAction('reject');
    setAdminNotes('');
    setShowNotesModal(true);
  };

  const handleCompletePayment = async (withdrawal: WithdrawalRequest) => {
    // Check for duplicate withdrawals
    try {
      const { data, error } = await supabase.rpc('admin_check_duplicate_withdrawals', {
        p_user_id: withdrawal.user_id,
        p_days_back: 30
      });

      if (!error && data && data.length > 1) {
        setDuplicateWarning(
          `WARNING: This user has ${data.length - 1} other approved/completed withdrawal(s) in the last 30 days. Please verify before proceeding.`
        );
      } else {
        setDuplicateWarning(null);
      }
    } catch (err) {
      console.error('Error checking duplicates:', err);
    }

    setSelectedWithdrawal(withdrawal);
    setWithdrawalAction('complete');
    setAdminNotes('');
    setPaymentReference('');
    setShowNotesModal(true);
  };

  const confirmWithdrawalAction = async () => {
    if (!selectedWithdrawal || !withdrawalAction) return;

    // Validate payment reference for complete action
    if (withdrawalAction === 'complete' && !paymentReference.trim()) {
      setWithdrawalError('Payment reference is required (e.g., bank transfer ID, transaction hash)');
      return;
    }

    try {
      setProcessingWithdrawal(selectedWithdrawal.id);
      setWithdrawalError(null);
      setWithdrawalActionSuccess(null);

      let result: { data: any; error: any } | null = null;
      if (withdrawalAction === 'approve') {
        result = await supabase.rpc('admin_approve_withdrawal', {
          request_id: selectedWithdrawal.id,
          admin_notes: adminNotes
        });
        // Back-compat: some deployments used request_uuid/notes parameter names.
        if (result.error && /request_uuid|notes|function admin_approve_withdrawal/i.test(result.error.message ?? '')) {
          result = await supabase.rpc('admin_approve_withdrawal', {
            request_uuid: selectedWithdrawal.id,
            notes: adminNotes,
          } as any);
        }
      } else if (withdrawalAction === 'complete') {
        result = await supabase.rpc('admin_complete_withdrawal_payment', {
          p_withdrawal_id: selectedWithdrawal.id,
          p_payment_reference: paymentReference.trim(),
          p_admin_notes: adminNotes
        });
      } else {
        result = await supabase.rpc('admin_reject_withdrawal', {
          request_id: selectedWithdrawal.id,
          admin_notes: adminNotes
        });
      }

      if (result?.error) throw result.error;
      ensureRpcJsonOk(result?.data);

      setShowNotesModal(false);
      setSelectedWithdrawal(null);
      setWithdrawalAction(null);
      setAdminNotes('');
      setPaymentReference('');
      setDuplicateWarning(null);

      // Show detailed success message
      const payload = Array.isArray(result?.data) ? result?.data?.[0] : result?.data;
      if (withdrawalAction === 'approve' && payload?.details) {
        setWithdrawalActionSuccess(String(payload.details));
      } else if (withdrawalAction === 'complete' && payload?.payment_reference) {
        setWithdrawalActionSuccess(
          `Payment completed successfully! Reference: ${String(payload.payment_reference)}`
        );
      } else {
        setWithdrawalActionSuccess(
          `Withdrawal request ${withdrawalAction === 'approve' ? 'approved' : withdrawalAction === 'complete' ? 'completed' : 'rejected'} successfully`
        );
      }

      setTimeout(() => {
        setWithdrawalActionSuccess(null);
      }, 5000);

      fetchWithdrawalRequests();
      // Ensure user email is delivered immediately (approved/paid triggers queue rows).
      void runEmailQueueNowBestEffort();
    } catch (err) {
      console.error(`Error ${withdrawalAction}ing withdrawal:`, err);
      setWithdrawalError(formatRpcError(err));
    } finally {
      setProcessingWithdrawal(null);
    }
  };

  const toggleWithdrawalSelection = (withdrawalId: string) => {
    const newSelection = new Set(selectedWithdrawals);
    if (newSelection.has(withdrawalId)) {
      newSelection.delete(withdrawalId);
    } else {
      newSelection.add(withdrawalId);
    }
    setSelectedWithdrawals(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedWithdrawals.size === withdrawalRequests.length) {
      setSelectedWithdrawals(new Set());
    } else {
      setSelectedWithdrawals(new Set(withdrawalRequests.map(w => w.id)));
    }
  };

  const handleBulkApprove = () => {
    if (selectedWithdrawals.size === 0) {
      setWithdrawalError('Please select at least one withdrawal to approve');
      return;
    }
    setBulkAction('approve');
    setBulkAdminNotes('');
    setShowBulkNotesModal(true);
  };

  const handleBulkReject = () => {
    if (selectedWithdrawals.size === 0) {
      setWithdrawalError('Please select at least one withdrawal to reject');
      return;
    }
    setBulkAction('reject');
    setBulkAdminNotes('');
    setShowBulkNotesModal(true);
  };

  const handleBulkComplete = () => {
    if (selectedWithdrawals.size === 0) {
      setWithdrawalError('Please select at least one withdrawal to mark as paid');
      return;
    }
    setBulkAction('complete');
    setBulkAdminNotes('');
    setShowBulkNotesModal(true);
  };

  const createBulkPaymentReference = (withdrawalId: string, index: number): string => {
    const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const shortId = withdrawalId.replace(/-/g, '').slice(0, 8).toUpperCase();
    return `BULK-${ts}-${index + 1}-${shortId}`;
  };

  const confirmBulkAction = async () => {
    if (!bulkAction || selectedWithdrawals.size === 0) return;

    try {
      setProcessingWithdrawal('bulk');
      setWithdrawalError(null);
      setWithdrawalActionSuccess(null);

      const withdrawalIds = Array.from(selectedWithdrawals);

      let result;
      if (bulkAction === 'approve') {
        result = await supabase.rpc('admin_bulk_approve_withdrawals', {
          p_withdrawal_ids: withdrawalIds,
          p_admin_notes: bulkAdminNotes || null
        });
      } else if (bulkAction === 'reject') {
        result = await supabase.rpc('admin_bulk_reject_withdrawals', {
          p_withdrawal_ids: withdrawalIds,
          p_admin_notes: bulkAdminNotes || null
        });
      } else {
        // Bulk "Mark as Paid": process one-by-one and auto-generate payment references.
        let successCount = 0;
        const failures: string[] = [];
        for (let i = 0; i < withdrawalIds.length; i += 1) {
          const id = withdrawalIds[i];
          const autoReference = createBulkPaymentReference(id, i);
          const completeRes = await supabase.rpc('admin_complete_withdrawal_payment', {
            p_withdrawal_id: id,
            p_payment_reference: autoReference,
            p_admin_notes: bulkAdminNotes || null
          });
          if (completeRes.error) {
            failures.push(`${id.slice(0, 8)}: ${formatRpcError(completeRes.error)}`);
          } else {
            successCount += 1;
          }
        }

        if (successCount === 0) {
          throw new Error(failures.join(' | ') || 'Failed to mark selected withdrawals as paid');
        }

        setShowBulkNotesModal(false);
        setBulkAction(null);
        setBulkAdminNotes('');
        setSelectedWithdrawals(new Set());

        setWithdrawalActionSuccess(
          failures.length > 0
            ? `Marked ${successCount}/${withdrawalIds.length} as paid. Some failed: ${failures.slice(0, 2).join(' | ')}`
            : `Marked ${successCount} withdrawal request${successCount > 1 ? 's' : ''} as paid successfully`
        );

        setTimeout(() => {
          setWithdrawalActionSuccess(null);
        }, 6000);

        fetchWithdrawalRequests();
        // Ensure receipt emails deliver immediately after bulk paid.
        void runEmailQueueNowBestEffort();
        return;
      }

      if (result.error) throw result.error;

      const data = result.data?.[0];

      setShowBulkNotesModal(false);
      setBulkAction(null);
      setBulkAdminNotes('');
      setSelectedWithdrawals(new Set());

      setWithdrawalActionSuccess(
        data?.message || `Bulk ${bulkAction} completed successfully`
      );

      setTimeout(() => {
        setWithdrawalActionSuccess(null);
      }, 5000);

      fetchWithdrawalRequests();
      // Ensure approval emails deliver immediately after bulk approve/reject.
      void runEmailQueueNowBestEffort();
    } catch (err) {
      console.error(`Error in bulk ${bulkAction}:`, err);
      setWithdrawalError(`Failed to ${bulkAction} selected withdrawal requests: ${formatRpcError(err)}`);
    } finally {
      setProcessingWithdrawal(null);
    }
  };

  const exportToCSV = async () => {
    try {
      setIsExporting(true);
      setWithdrawalError(null);

      const { data, error } = await supabase.rpc('admin_export_approved_withdrawals');

      if (error) throw error;

      if (!data || data.length === 0) {
        setWithdrawalError('No approved withdrawals to export');
        return;
      }

      // Convert to CSV
      const headers = [
        'Transaction ID',
        'Request Date',
        'User Name',
        'User Email',
        'User Country',
        'Method Type',
        'Bank Name',
        'Account Holder',
        'Account Number',
        'SWIFT/BIC',
        'Country',
        'Wallet Address',
        'Gross Amount (USD)',
        'Fee Amount (USD)',
        'Net Amount (USD)',
        'Currency Code',
        'Local Amount',
        'Exchange Rate',
        'Admin Notes'
      ];

      const rows = data.map((row: any) => [
        row.transaction_id || '',
        new Date(row.request_date).toLocaleString(),
        row.user_name || '',
        row.user_email || '',
        row.user_country || '',
        row.method_type || '',
        row.bank_name || '',
        row.account_holder_name || '',
        row.account_number || '',
        row.swift_code || '',
        row.country || '',
        row.wallet_address || '',
        row.gross_amount_usd || '0',
        row.fee_amount_usd || '0',
        row.net_amount_usd || '0',
        row.currency_code || 'USD',
        row.amount_local || '',
        row.exchange_rate || '1',
        row.admin_notes || ''
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map((row: any[]) =>
          row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        )
      ].join('\n');

      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `approved_withdrawals_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setWithdrawalActionSuccess(`Exported ${data.length} approved withdrawal(s) for bank processing`);
      setTimeout(() => {
        setWithdrawalActionSuccess(null);
      }, 5000);
    } catch (err) {
      console.error('Error exporting withdrawals:', err);
      setWithdrawalError('Failed to export withdrawals');
    } finally {
      setIsExporting(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-gray-900 flex items-center">
          <DollarSign className="w-5 h-5 mr-2 text-yellow-600" />
          Withdrawal Requests
        </h3>

        <div className="flex items-center gap-4">
          <select
            value={withdrawalStatusFilter}
            onChange={(e) => setWithdrawalStatusFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#309605]"
          >
            <option value="pending">Pending (Need Approval)</option>
            <option value="approved">Approved (Need Payment)</option>
            <option value="completed">Completed (Paid)</option>
            <option value="rejected">Rejected</option>
            <option value="all">All Requests</option>
          </select>

          <button
            onClick={fetchWithdrawalRequests}
            className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {(withdrawalStatusFilter === 'pending' || withdrawalStatusFilter === 'approved') && withdrawalRequests.length > 0 && (
        <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-4">
            <span className="text-gray-700 font-medium">
              {selectedWithdrawals.size > 0
                ? `${selectedWithdrawals.size} selected`
                : 'No withdrawals selected'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleBulkApprove}
              disabled={withdrawalStatusFilter !== 'pending' || selectedWithdrawals.size === 0 || processingWithdrawal === 'bulk'}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              Approve Selected
            </button>
            <button
              onClick={handleBulkReject}
              disabled={withdrawalStatusFilter !== 'pending' || selectedWithdrawals.size === 0 || processingWithdrawal === 'bulk'}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Reject Selected
            </button>
            <button
              onClick={handleBulkComplete}
              disabled={withdrawalStatusFilter !== 'approved' || selectedWithdrawals.size === 0 || processingWithdrawal === 'bulk'}
              className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              Mark Paid Selected
            </button>
          </div>
        </div>
      )}

      {/* Export Button for Approved Withdrawals */}
      {withdrawalStatusFilter === 'approved' && withdrawalRequests.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={exportToCSV}
            disabled={isExporting}
            className="px-4 py-2 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {isExporting ? 'Exporting...' : 'Export for Bank Processing'}
          </button>
        </div>
      )}

      {withdrawalActionSuccess && (
        <div className="p-4 bg-green-100 border border-green-200 rounded-lg">
          <p className="text-green-700">{withdrawalActionSuccess}</p>
        </div>
      )}

      {withdrawalError && (
        <div className="p-4 bg-red-100 border border-red-200 rounded-lg">
          <p className="text-red-700">{withdrawalError}</p>
        </div>
      )}

      {isLoadingWithdrawals ? (
        <div className="flex items-center justify-center py-12">
          <LoadingLogo variant="pulse" size={32} />
          <p className="ml-4 text-gray-700">Loading withdrawal requests...</p>
        </div>
      ) : withdrawalRequests.length === 0 ? (
        <div className="p-6 bg-gray-100 rounded-lg text-center">
          <p className="text-gray-700">
            No {withdrawalStatusFilter === 'all' ? '' : withdrawalStatusFilter} withdrawal requests found.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                {(withdrawalStatusFilter === 'pending' || withdrawalStatusFilter === 'approved') && (
                  <th className="p-4 text-gray-700 font-medium w-12">
                    <button
                      onClick={toggleSelectAll}
                      className="p-1 hover:bg-gray-200 rounded"
                      title={selectedWithdrawals.size === withdrawalRequests.length ? 'Deselect All' : 'Select All'}
                    >
                      {selectedWithdrawals.size === withdrawalRequests.length ? (
                        <CheckSquare className="w-5 h-5 text-[#309605]" />
                      ) : (
                        <Square className="w-5 h-5 text-gray-600" />
                      )}
                    </button>
                  </th>
                )}
                <th className="p-4 text-gray-700 font-medium">Transaction ID</th>
                <th className="p-4 text-gray-700 font-medium">User</th>
                <th className="p-4 text-gray-700 font-medium">Country</th>
                <th className="p-4 text-gray-700 font-medium">Amount Details</th>
                <th className="p-4 text-gray-700 font-medium">Method</th>
                <th className="p-4 text-gray-700 font-medium">Destination</th>
                <th className="p-4 text-gray-700 font-medium">Date</th>
                <th className="p-4 text-gray-700 font-medium">Status</th>
                <th className="p-4 text-gray-700 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {withdrawalRequests.map((request) => {
                const anomaly = anomalies.get(request.id);
                const hasAnomaly = anomaly !== undefined;
                return (
                <tr
                  key={request.id}
                  className={`border-b border-gray-200 hover:bg-gray-50 ${
                    hasAnomaly ? 'bg-yellow-50' : ''
                  }`}
                >
                  {(withdrawalStatusFilter === 'pending' || withdrawalStatusFilter === 'approved') && (
                    <td className="p-4">
                      <button
                        onClick={() => toggleWithdrawalSelection(request.id)}
                        className="p-1 hover:bg-gray-200 rounded"
                      >
                        {selectedWithdrawals.has(request.id) ? (
                          <CheckSquare className="w-5 h-5 text-[#309605]" />
                        ) : (
                          <Square className="w-5 h-5 text-gray-600" />
                        )}
                      </button>
                    </td>
                  )}
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-xs text-gray-700 font-semibold">
                        {request.transaction_id || 'N/A'}
                      </div>
                      {hasAnomaly && (
                        <div
                          className="flex items-center gap-1 text-xs"
                          title={`Balance mismatch detected: ${anomaly.type} (${anomaly.severity} severity, $${anomaly.difference.toFixed(2)} difference)`}
                        >
                          <AlertTriangle className={`w-4 h-4 ${
                            anomaly.severity === 'critical' ? 'text-red-600' :
                            anomaly.severity === 'high' ? 'text-orange-600' :
                            anomaly.severity === 'medium' ? 'text-yellow-600' :
                            'text-blue-600'
                          }`} />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <div>
                      <p className="font-medium text-gray-900">{request.user_display_name || 'Unnamed User'}</p>
                      <p className="text-gray-600 text-sm">{request.user_email}</p>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="text-sm">
                      <p className="font-medium text-gray-900">{request.user_country || 'N/A'}</p>
                      {request.currency_code && (
                        <p className="text-gray-600 text-xs">{request.currency_symbol} {request.currency_code}</p>
                      )}
                      {request.exchange_rate_applied && request.exchange_rate_applied !== 1 && (
                        <p className="text-blue-600 text-xs font-medium">
                          Rate: {request.exchange_rate_applied.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-600">Gross (USD):</span>
                        <span className="font-medium text-gray-900">${(request.gross_amount || request.amount).toFixed(2)}</span>
                      </div>
                      {request.fee_amount && request.fee_amount > 0 && (
                        <>
                          <div className="flex justify-between gap-2">
                            <span className="text-gray-600">Fee:</span>
                            <span className="font-medium text-red-600">-${request.fee_amount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between gap-2 pt-1 border-t border-gray-200">
                            <span className="text-gray-900 font-semibold">Net (USD):</span>
                            <span className="font-bold text-green-600">${(request.net_amount || request.amount).toFixed(2)}</span>
                          </div>
                        </>
                      )}
                      {request.currency_code && request.currency_code !== 'USD' && request.amount_local && (
                        <div className="flex justify-between gap-2 pt-1 border-t border-gray-200 bg-blue-50 -mx-2 px-2 py-1 rounded">
                          <span className="text-blue-900 font-semibold">Local ({request.currency_code}):</span>
                          <span className="font-bold text-blue-700">
                            {request.currency_symbol}{request.amount_local.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between gap-2 text-xs text-gray-500">
                        <span>Balance Before:</span>
                        <span>{request.balance_before !== null ? `$${request.balance_before.toFixed(2)}` : 'N/A'}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-xs text-gray-500">
                        <span>Balance After:</span>
                        <span>{request.balance_after !== null ? `$${request.balance_after.toFixed(2)}` : 'N/A'}</span>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      request.method_type === 'usdt_wallet'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {request.method_type === 'usdt_wallet' ? 'USDT Wallet' : request.method_type === 'bank_account' ? 'Bank Account' : 'Legacy'}
                    </span>
                  </td>
                  <td className="p-4">
                    {request.method_type === 'usdt_wallet' ? (
                      <div className="text-gray-700 font-mono text-sm">
                        {request.wallet_address && request.wallet_address.length > 16
                          ? `${request.wallet_address.substring(0, 8)}...${request.wallet_address.substring(request.wallet_address.length - 8)}`
                          : request.wallet_address || 'N/A'}
                      </div>
                    ) : request.method_type === 'bank_account' ? (
                      <div className="text-sm">
                        <p className="font-medium text-gray-900">{request.bank_name || 'N/A'}</p>
                        <p className="text-gray-600">{request.account_holder_name || 'N/A'}</p>
                        <p className="text-gray-600 font-mono text-xs">Acc: {request.account_number || 'N/A'}</p>
                        {request.swift_code && <p className="text-gray-600 text-xs">SWIFT: {request.swift_code}</p>}
                        {request.country && <p className="text-gray-600 text-xs">{request.country}</p>}
                      </div>
                    ) : (
                      <div className="text-gray-700 font-mono text-sm">
                        {request.wallet_address && request.wallet_address.length > 16
                          ? `${request.wallet_address.substring(0, 8)}...${request.wallet_address.substring(request.wallet_address.length - 8)}`
                          : request.wallet_address || 'N/A'}
                      </div>
                    )}
                  </td>
                  <td className="p-4 text-gray-700 text-sm">{formatDate(request.requested_date)}</td>
                  <td className="p-4">
                    <div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        request.status === 'pending'
                          ? 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                          : request.status === 'approved'
                          ? 'bg-blue-100 text-blue-700 border border-blue-200'
                          : request.status === 'completed'
                          ? 'bg-green-100 text-green-700 border border-green-200'
                          : 'bg-red-100 text-red-700 border border-red-200'
                      }`}>
                        {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                      </span>
                      {request.payment_reference && (
                        <p className="text-xs text-gray-600 mt-1 font-mono">Ref: {request.payment_reference}</p>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    {request.status === 'pending' ? (
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleApproveWithdrawal(request)}
                          disabled={processingWithdrawal === request.id}
                          className="p-2 bg-green-100 hover:bg-green-200 rounded-lg text-green-700 disabled:opacity-50"
                          title="Approve"
                        >
                          <Check className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleRejectWithdrawal(request)}
                          disabled={processingWithdrawal === request.id}
                          className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700 disabled:opacity-50"
                          title="Reject"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    ) : request.status === 'approved' ? (
                      <button
                        onClick={() => handleCompletePayment(request)}
                        disabled={processingWithdrawal === request.id}
                        className="px-3 py-2 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] rounded-lg text-white text-sm font-medium disabled:opacity-50"
                        title="Mark as Paid"
                      >
                        Mark as Paid
                      </button>
                    ) : (
                      <div className="text-sm text-gray-500">
                        {request.payment_completed_date && (
                          <div>
                            <p className="font-medium text-gray-700">Paid: {formatDate(request.payment_completed_date)}</p>
                          </div>
                        )}
                        {request.processed_date && !request.payment_completed_date && (
                          <p>Processed: {formatDate(request.processed_date)}</p>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes Modal for Withdrawal Actions */}
      {showNotesModal && selectedWithdrawal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                {withdrawalAction === 'approve' ? 'Approve' : withdrawalAction === 'complete' ? 'Mark as Paid' : 'Reject'} Withdrawal
              </h3>
              <button
                onClick={() => {
                  setShowNotesModal(false);
                  setDuplicateWarning(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {duplicateWarning && (
              <div className="mb-4 p-4 bg-yellow-50 border border-yellow-300 rounded-lg">
                <p className="text-yellow-800 font-medium">{duplicateWarning}</p>
              </div>
            )}

            <div className="mb-4">
              <div className="p-4 bg-gray-100 rounded-lg mb-4">
                <div className="flex justify-between mb-2">
                  <span className="text-gray-700">User:</span>
                  <span className="font-medium text-gray-900">{selectedWithdrawal.user_display_name || selectedWithdrawal.user_email}</span>
                </div>
                {selectedWithdrawal.transaction_id && (
                  <div className="flex justify-between mb-2">
                    <span className="text-gray-700">Transaction ID:</span>
                    <span className="font-medium text-gray-900 font-mono text-sm">{selectedWithdrawal.transaction_id}</span>
                  </div>
                )}
                {selectedWithdrawal.user_country && (
                  <div className="flex justify-between mb-2">
                    <span className="text-gray-700">Country:</span>
                    <span className="font-medium text-gray-900">{selectedWithdrawal.user_country}</span>
                  </div>
                )}
                <div className="flex justify-between mb-2">
                  <span className="text-gray-700">Gross Amount:</span>
                  <span className="font-medium text-gray-900">{formatCurrency(selectedWithdrawal.gross_amount || selectedWithdrawal.amount)}</span>
                </div>
                {selectedWithdrawal.fee_amount && selectedWithdrawal.fee_amount > 0 && (
                  <>
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-700">Service Fee:</span>
                      <span className="font-medium text-red-600">-{formatCurrency(selectedWithdrawal.fee_amount)}</span>
                    </div>
                    <div className="flex justify-between mb-2 pt-2 border-t border-gray-200">
                      <span className="text-gray-900 font-bold">Net Amount:</span>
                      <span className="font-bold text-green-600 text-lg">{formatCurrency(selectedWithdrawal.net_amount || selectedWithdrawal.amount)}</span>
                    </div>
                  </>
                )}
                {selectedWithdrawal.exchange_rate_applied && selectedWithdrawal.exchange_rate_applied !== 1 && (
                  <div className="flex justify-between mb-2 text-sm text-gray-600">
                    <span>Exchange Rate:</span>
                    <span>{selectedWithdrawal.exchange_rate_applied}</span>
                  </div>
                )}
                <div className="flex justify-between mb-2">
                  <span className="text-gray-700">Method:</span>
                  <span className="font-medium text-gray-900">
                    {selectedWithdrawal.method_type === 'usdt_wallet' ? 'USDT Wallet' : selectedWithdrawal.method_type === 'bank_account' ? 'Bank Account' : 'Legacy'}
                  </span>
                </div>
                {selectedWithdrawal.method_type === 'usdt_wallet' ? (
                  <div className="flex justify-between">
                    <span className="text-gray-700">Wallet:</span>
                    <span className="font-medium text-gray-900 font-mono text-sm">
                      {selectedWithdrawal.wallet_address && selectedWithdrawal.wallet_address.length > 16
                        ? `${selectedWithdrawal.wallet_address.substring(0, 8)}...${selectedWithdrawal.wallet_address.substring(selectedWithdrawal.wallet_address.length - 8)}`
                        : selectedWithdrawal.wallet_address || 'N/A'}
                    </span>
                  </div>
                ) : selectedWithdrawal.method_type === 'bank_account' ? (
                  <div className="border-t border-gray-300 pt-2 mt-2">
                    <div className="mb-2">
                      <span className="text-gray-700 text-sm font-medium">Bank Details:</span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Bank:</span>
                        <span className="font-medium text-gray-900">{selectedWithdrawal.bank_name || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Account Holder:</span>
                        <span className="font-medium text-gray-900">{selectedWithdrawal.account_holder_name || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Account Number:</span>
                        <span className="font-medium text-gray-900 font-mono">{selectedWithdrawal.account_number || 'N/A'}</span>
                      </div>
                      {selectedWithdrawal.swift_code && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">SWIFT/BIC:</span>
                          <span className="font-medium text-gray-900">{selectedWithdrawal.swift_code}</span>
                        </div>
                      )}
                      {selectedWithdrawal.country && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Country:</span>
                          <span className="font-medium text-gray-900">{selectedWithdrawal.country}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-gray-700">Wallet:</span>
                    <span className="font-medium text-gray-900 font-mono text-sm">
                      {selectedWithdrawal.wallet_address && selectedWithdrawal.wallet_address.length > 16
                        ? `${selectedWithdrawal.wallet_address.substring(0, 8)}...${selectedWithdrawal.wallet_address.substring(selectedWithdrawal.wallet_address.length - 8)}`
                        : selectedWithdrawal.wallet_address || 'N/A'}
                    </span>
                  </div>
                )}
              </div>

              {withdrawalAction === 'complete' && (
                <div className="mb-4">
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Payment Reference <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder="e.g., Bank transfer reference, transaction ID, payment confirmation number"
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    Enter the payment reference from your bank or payment system. This is required to track the actual payment.
                  </p>
                </div>
              )}

              <label className="block text-gray-700 text-sm font-medium mb-2">
                Admin Notes (Optional)
              </label>
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] resize-none"
                placeholder="Add notes about this withdrawal action..."
              />
            </div>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowNotesModal(false);
                  setDuplicateWarning(null);
                }}
                className="flex-1 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmWithdrawalAction}
                disabled={processingWithdrawal !== null || (withdrawalAction === 'complete' && !paymentReference.trim())}
                className={`flex-1 px-4 py-2 rounded-lg text-white transition-all duration-200 ${
                  withdrawalAction === 'approve'
                    ? 'bg-green-600 hover:bg-green-700'
                    : withdrawalAction === 'complete'
                    ? 'bg-[#309605] hover:bg-[#3ba208]'
                    : 'bg-red-600 hover:bg-red-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {processingWithdrawal ? 'Processing...' : withdrawalAction === 'approve' ? 'Approve' : withdrawalAction === 'complete' ? 'Confirm Payment' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Action Confirmation Modal */}
      {showBulkNotesModal && bulkAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                Bulk {bulkAction === 'approve' ? 'Approve' : bulkAction === 'complete' ? 'Mark as Paid' : 'Reject'} {selectedWithdrawals.size} Withdrawal{selectedWithdrawals.size > 1 ? 's' : ''}
              </h3>
              <button
                onClick={() => {
                  setShowBulkNotesModal(false);
                  setBulkAction(null);
                  setBulkAdminNotes('');
                }}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-blue-900 font-medium">
                You are about to {bulkAction === 'complete' ? 'mark as paid' : bulkAction} {selectedWithdrawals.size} withdrawal request{selectedWithdrawals.size > 1 ? 's' : ''}.
              </p>
              <p className="text-blue-700 text-sm mt-2">
                {bulkAction === 'complete'
                  ? 'Each payment reference will be auto-generated per withdrawal. If any fail, processing continues for the rest.'
                  : 'Each withdrawal will be processed individually. If any fail, the operation will continue with the remaining withdrawals.'}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-medium mb-2">
                Admin Notes (Optional - Applied to All)
              </label>
              <textarea
                value={bulkAdminNotes}
                onChange={(e) => setBulkAdminNotes(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] resize-none"
                placeholder={`Add notes that will be applied to all ${selectedWithdrawals.size} selected withdrawals...`}
              />
            </div>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowBulkNotesModal(false);
                  setBulkAction(null);
                  setBulkAdminNotes('');
                }}
                className="flex-1 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmBulkAction}
                disabled={processingWithdrawal === 'bulk'}
                className={`flex-1 px-4 py-2 rounded-lg text-white transition-all duration-200 ${
                  bulkAction === 'approve'
                    ? 'bg-green-600 hover:bg-green-700'
                    : bulkAction === 'complete'
                    ? 'bg-[#309605] hover:bg-[#3ba208]'
                    : 'bg-red-600 hover:bg-red-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {processingWithdrawal === 'bulk' ? 'Processing...' : `${bulkAction === 'approve' ? 'Approve' : bulkAction === 'complete' ? 'Mark Paid' : 'Reject'} ${selectedWithdrawals.size} Withdrawal${selectedWithdrawals.size > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
