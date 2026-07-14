import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  AlertTriangle,
  Check,
  X,
  RefreshCw,
  Power,
  TrendingUp,
  Percent,
  Clock,
  User,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';

interface WithdrawalSettings {
  id: string;
  exchange_rate: number;
  withdrawal_fee_type: 'percentage' | 'fixed';
  withdrawal_fee_value: number;
  withdrawals_enabled: boolean;
  disabled_reason: string | null;
  minimum_withdrawal_usd_listener: number;
  minimum_withdrawal_usd_creator: number;
  created_at: string;
  updated_at: string;
  last_updated_by: string | null;
  admin_email: string | null;
  admin_display_name: string | null;
}

interface AuditLogEntry {
  id: string;
  admin_id: string;
  action: string;
  previous_values: any;
  new_values: any;
  created_at: string;
}

export const WithdrawalSettingsSection = (): JSX.Element => {
  const [settings, setSettings] = useState<WithdrawalSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [exchangeRate, setExchangeRate] = useState<string>('1.0');
  const [feeType, setFeeType] = useState<'percentage' | 'fixed'>('percentage');
  const [feeValue, setFeeValue] = useState<string>('0.0');
  const [withdrawalsEnabled, setWithdrawalsEnabled] = useState(true);
  const [disabledReason, setDisabledReason] = useState('');
  const [minimumListener, setMinimumListener] = useState<string>('10');
  const [minimumCreator, setMinimumCreator] = useState<string>('10');

  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<any>(null);

  // Audit log state
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error } = await supabase.rpc('admin_get_withdrawal_settings');

      if (error) throw error;

      if (data && data.length > 0) {
        const settingsData = data[0];
        setSettings(settingsData);
        setExchangeRate(settingsData.exchange_rate.toString());
        setFeeType(settingsData.withdrawal_fee_type);
        setFeeValue(settingsData.withdrawal_fee_value.toString());
        setWithdrawalsEnabled(settingsData.withdrawals_enabled);
        setDisabledReason(settingsData.disabled_reason || '');
        setMinimumListener(String(settingsData.minimum_withdrawal_usd_listener ?? 10));
        setMinimumCreator(String(settingsData.minimum_withdrawal_usd_creator ?? 10));
      }
    } catch (err: any) {
      console.error('Error fetching withdrawal settings:', err);
      setError(err.message || 'Failed to load withdrawal settings');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAuditLog = async () => {
    try {
      setIsLoadingAudit(true);

      const { data, error } = await supabase
        .from('withdrawal_settings_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      setAuditLog(data || []);
    } catch (err) {
      console.error('Error fetching audit log:', err);
    } finally {
      setIsLoadingAudit(false);
    }
  };

  const validateInputs = (): string | null => {
    const rate = parseFloat(exchangeRate);
    const fee = parseFloat(feeValue);

    if (isNaN(rate) || rate <= 0) {
      return 'Exchange rate must be a positive number';
    }

    if (isNaN(fee) || fee < 0) {
      return 'Withdrawal fee cannot be negative';
    }

    if (feeType === 'percentage' && fee > 100) {
      return 'Percentage fee cannot exceed 100%';
    }

    if (!withdrawalsEnabled && !disabledReason.trim()) {
      return 'Please provide a reason for disabling withdrawals';
    }

    const listenerMin = parseFloat(minimumListener);
    const creatorMin = parseFloat(minimumCreator);

    if (isNaN(listenerMin) || listenerMin <= 0) {
      return 'Listener minimum withdrawal must be greater than 0';
    }

    if (isNaN(creatorMin) || creatorMin <= 0) {
      return 'Creator/Artist minimum withdrawal must be greater than 0';
    }

    return null;
  };

  const calculateFeeExample = (amount: number): { fee: number; net: number } => {
    const feeVal = parseFloat(feeValue);
    let fee = 0;

    if (feeType === 'percentage') {
      fee = (amount * feeVal) / 100;
    } else {
      fee = feeVal;
    }

    return {
      fee: Math.max(0, fee),
      net: Math.max(0, amount - fee),
    };
  };

  const handleSubmit = () => {
    const validationError = validateInputs();
    if (validationError) {
      setError(validationError);
      return;
    }

    setPendingChanges({
      exchange_rate: parseFloat(exchangeRate),
      withdrawal_fee_type: feeType,
      withdrawal_fee_value: parseFloat(feeValue),
      withdrawals_enabled: withdrawalsEnabled,
      disabled_reason: !withdrawalsEnabled ? disabledReason : null,
      minimum_withdrawal_usd_listener: parseFloat(minimumListener),
      minimum_withdrawal_usd_creator: parseFloat(minimumCreator),
    });

    setShowConfirmModal(true);
  };

  const confirmUpdate = async () => {
    if (!pendingChanges) return;

    try {
      setIsSubmitting(true);
      setError(null);
      setSuccessMessage(null);

      const { data, error } = await supabase.rpc('admin_update_withdrawal_settings', {
        p_exchange_rate: pendingChanges.exchange_rate,
        p_withdrawal_fee_type: pendingChanges.withdrawal_fee_type,
        p_withdrawal_fee_value: pendingChanges.withdrawal_fee_value,
        p_withdrawals_enabled: pendingChanges.withdrawals_enabled,
        p_disabled_reason: pendingChanges.disabled_reason,
        p_minimum_withdrawal_usd_listener: pendingChanges.minimum_withdrawal_usd_listener,
        p_minimum_withdrawal_usd_creator: pendingChanges.minimum_withdrawal_usd_creator,
      });

      if (error) throw error;

      const result = data as { success?: boolean; error?: string } | null;
      if (result?.success === false) {
        throw new Error(result.error || 'Failed to update withdrawal settings');
      }

      setShowConfirmModal(false);
      setPendingChanges(null);
      setSuccessMessage('Withdrawal settings updated successfully');

      // Auto-clear success message
      setTimeout(() => setSuccessMessage(null), 5000);

      // Refresh settings
      await fetchSettings();
    } catch (err: any) {
      console.error('Error updating withdrawal settings:', err);
      setError(err.message || 'Failed to update withdrawal settings');
      setShowConfirmModal(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingLogo variant="pulse" size={32} />
        <p className="ml-4 text-gray-700">Loading withdrawal settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-gray-900 flex items-center">
          <DollarSign className="w-5 h-5 mr-2 text-[#309605]" />
          Withdrawal Settings
        </h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setShowAuditLog(!showAuditLog);
              if (!showAuditLog) fetchAuditLog();
            }}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 flex items-center gap-2"
          >
            <Clock className="w-4 h-4" />
            Audit Log
          </button>
          <button
            onClick={fetchSettings}
            className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="p-4 bg-green-100 border border-green-200 rounded-lg flex items-center">
          <Check className="w-5 h-5 text-green-700 mr-3" />
          <p className="text-green-700">{successMessage}</p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-100 border border-red-200 rounded-lg flex items-center">
          <AlertTriangle className="w-5 h-5 text-red-700 mr-3" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Current Settings Summary */}
      {settings && (
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg p-6 border border-gray-200">
          <h4 className="font-semibold text-gray-900 mb-4 flex items-center">
            <AlertCircle className="w-5 h-5 mr-2 text-blue-600" />
            Current Settings
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <div className="bg-white p-4 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-600 text-sm">Status</span>
                <Power className={`w-4 h-4 ${settings.withdrawals_enabled ? 'text-green-600' : 'text-red-600'}`} />
              </div>
              <p className={`text-lg font-bold ${settings.withdrawals_enabled ? 'text-green-600' : 'text-red-600'}`}>
                {settings.withdrawals_enabled ? 'Enabled' : 'Disabled'}
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-600 text-sm">Exchange Rate</span>
                <TrendingUp className="w-4 h-4 text-blue-600" />
              </div>
              <p className="text-lg font-bold text-gray-900">{settings.exchange_rate.toFixed(4)}</p>
            </div>
            <div className="bg-white p-4 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-600 text-sm">Withdrawal Fee</span>
                <Percent className="w-4 h-4 text-orange-600" />
              </div>
              <p className="text-lg font-bold text-gray-900">
                {settings.withdrawal_fee_value}
                {settings.withdrawal_fee_type === 'percentage' ? '%' : ' USD'}
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-600 text-sm">Listener Min.</span>
                <User className="w-4 h-4 text-indigo-600" />
              </div>
              <p className="text-lg font-bold text-gray-900">
                {formatCurrency(settings.minimum_withdrawal_usd_listener ?? 10)}
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-600 text-sm">Creator Min.</span>
                <User className="w-4 h-4 text-teal-600" />
              </div>
              <p className="text-lg font-bold text-gray-900">
                {formatCurrency(settings.minimum_withdrawal_usd_creator ?? 10)}
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-600 text-sm">Last Updated</span>
                <Clock className="w-4 h-4 text-purple-600" />
              </div>
              <p className="text-xs text-gray-600">{formatDate(settings.updated_at)}</p>
              {settings.admin_display_name && (
                <p className="text-xs text-gray-500 mt-1">by {settings.admin_display_name}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="space-y-6">
          {/* Master Toggle */}
          <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h4 className="font-semibold text-gray-900 mb-2 flex items-center">
                  <Power className="w-5 h-5 mr-2 text-gray-700" />
                  Master Withdrawal Control
                </h4>
                <p className="text-sm text-gray-600">
                  Enable or disable all withdrawal requests system-wide
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={withdrawalsEnabled}
                  onChange={(e) => setWithdrawalsEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-14 h-8 bg-red-500 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-green-600"></div>
              </label>
            </div>

            {!withdrawalsEnabled && (
              <div className="mt-4">
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Reason for Disabling <span className="text-red-600">*</span>
                </label>
                <textarea
                  value={disabledReason}
                  onChange={(e) => setDisabledReason(e.target.value)}
                  rows={3}
                  placeholder="e.g., System maintenance, security review, payment processor issues..."
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] resize-none"
                />
                <p className="mt-1 text-xs text-gray-500">
                  This reason will be logged and may be shown to users
                </p>
              </div>
            )}
          </div>

          {/* Minimum withdrawal thresholds by account type */}
          <div className="bg-indigo-50 p-6 rounded-lg border border-indigo-200">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center">
              <User className="w-5 h-5 mr-2 text-indigo-600" />
              Live Balance Withdrawal Thresholds
            </h4>
            <p className="text-sm text-gray-600 mb-4">
              Set separate minimum Live Balance amounts before users can request a bank or USDT withdrawal.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Listener Minimum (USD) <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="number"
                    value={minimumListener}
                    onChange={(e) => setMinimumListener(e.target.value)}
                    min="0.01"
                    step="0.01"
                    className="w-full pl-8 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder="10.00"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Applies to regular listener accounts
                </p>
              </div>
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Creator / Artist Minimum (USD) <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="number"
                    value={minimumCreator}
                    onChange={(e) => setMinimumCreator(e.target.value)}
                    min="0.01"
                    step="0.01"
                    className="w-full pl-8 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder="10.00"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Applies to creator and artist accounts
                </p>
              </div>
            </div>
          </div>

          {/* Exchange Rate Management */}
          <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center">
              <TrendingUp className="w-5 h-5 mr-2 text-blue-600" />
              Exchange Rate Management
            </h4>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Live Balance to USD Exchange Rate <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(e.target.value)}
                    min="0.0001"
                    step="0.0001"
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder="1.0"
                  />
                </div>
                <p className="mt-2 text-sm text-gray-600">
                  Current: 1 Live Balance = ${exchangeRate} USD
                </p>
                <div className="mt-3 p-3 bg-blue-100 rounded-lg">
                  <p className="text-xs text-blue-800">
                    <strong>Example:</strong> If rate is 0.50, user with 100 Live Balance can withdraw $50 USD
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Withdrawal Fee Configuration */}
          <div className="bg-orange-50 p-6 rounded-lg border border-orange-200">
            <h4 className="font-semibold text-gray-900 mb-4 flex items-center">
              <Percent className="w-5 h-5 mr-2 text-orange-600" />
              Withdrawal Fee Configuration
            </h4>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Fee Type <span className="text-red-600">*</span>
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="feeType"
                      value="percentage"
                      checked={feeType === 'percentage'}
                      onChange={() => setFeeType('percentage')}
                      className="w-4 h-4 text-[#309605] focus:ring-[#309605]"
                    />
                    <span className="ml-2 text-gray-700">Percentage (%)</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="feeType"
                      value="fixed"
                      checked={feeType === 'fixed'}
                      onChange={() => setFeeType('fixed')}
                      className="w-4 h-4 text-[#309605] focus:ring-[#309605]"
                    />
                    <span className="ml-2 text-gray-700">Fixed Amount (USD)</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Fee Value <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  {feeType === 'fixed' && (
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                  )}
                  <input
                    type="number"
                    value={feeValue}
                    onChange={(e) => setFeeValue(e.target.value)}
                    min="0"
                    step="0.01"
                    max={feeType === 'percentage' ? '100' : undefined}
                    className={`w-full ${feeType === 'fixed' ? 'pl-8' : 'pl-4'} pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]`}
                    placeholder="0.00"
                  />
                  {feeType === 'percentage' && (
                    <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500">%</span>
                  )}
                </div>
                <p className="mt-2 text-sm text-gray-600">
                  {feeType === 'percentage'
                    ? `Fee will be ${feeValue}% of withdrawal amount`
                    : `Fixed fee of $${feeValue} per withdrawal`}
                </p>
              </div>

              {/* Fee Preview */}
              <div className="bg-orange-100 p-4 rounded-lg">
                <h5 className="font-medium text-gray-900 mb-3">Fee Impact Preview</h5>
                <div className="space-y-2 text-sm">
                  {[10, 50, 100, 500].map((amount) => {
                    const { fee, net } = calculateFeeExample(amount);
                    return (
                      <div key={amount} className="flex justify-between items-center">
                        <span className="text-gray-700">Withdraw {formatCurrency(amount)}:</span>
                        <span className="font-medium text-gray-900">
                          Fee: {formatCurrency(fee)} → Net: {formatCurrency(net)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => {
                if (settings) {
                  setExchangeRate(settings.exchange_rate.toString());
                  setFeeType(settings.withdrawal_fee_type);
                  setFeeValue(settings.withdrawal_fee_value.toString());
                  setWithdrawalsEnabled(settings.withdrawals_enabled);
                  setDisabledReason(settings.disabled_reason || '');
                  setMinimumListener(String(settings.minimum_withdrawal_usd_listener ?? 10));
                  setMinimumCreator(String(settings.minimum_withdrawal_usd_creator ?? 10));
                  setError(null);
                }
              }}
              className="px-6 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all duration-200"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1 px-6 py-2 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-all duration-200"
            >
              {isSubmitting ? 'Saving...' : 'Save Withdrawal Settings'}
            </button>
          </div>
        </div>
      </div>

      {/* Audit Log Section */}
      {showAuditLog && (
        <div className="bg-white rounded-lg shadow p-6">
          <h4 className="font-semibold text-gray-900 mb-4 flex items-center">
            <Clock className="w-5 h-5 mr-2 text-purple-600" />
            Recent Changes (Audit Log)
          </h4>

          {isLoadingAudit ? (
            <div className="flex items-center justify-center py-8">
              <LoadingLogo variant="pulse" size={24} />
              <p className="ml-4 text-gray-700">Loading audit log...</p>
            </div>
          ) : auditLog.length === 0 ? (
            <p className="text-gray-600 text-center py-6">No audit log entries found</p>
          ) : (
            <div className="overflow-x-auto scrollbar-hide">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="p-3 text-gray-700 font-medium text-sm">Date</th>
                    <th className="p-3 text-gray-700 font-medium text-sm">Action</th>
                    <th className="p-3 text-gray-700 font-medium text-sm">Changes</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((entry) => (
                    <tr key={entry.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="p-3 text-gray-700 text-sm">{formatDate(entry.created_at)}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          entry.action === 'create'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {entry.action}
                        </span>
                      </td>
                      <td className="p-3 text-sm text-gray-600">
                        <details className="cursor-pointer">
                          <summary className="font-medium text-gray-900 hover:text-[#309605]">
                            View Details
                          </summary>
                          <div className="mt-2 p-2 bg-gray-50 rounded text-xs">
                            <pre className="whitespace-pre-wrap">
                              {JSON.stringify(entry.new_values, null, 2)}
                            </pre>
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && pendingChanges && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">Confirm Changes</h3>
              <button
                onClick={() => setShowConfirmModal(false)}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="mb-6">
              <p className="text-gray-700 mb-4">
                You are about to update the withdrawal settings. Please review the changes:
              </p>

              <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Withdrawals Status:</span>
                  <span className={`font-medium ${pendingChanges.withdrawals_enabled ? 'text-green-600' : 'text-red-600'}`}>
                    {pendingChanges.withdrawals_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Exchange Rate:</span>
                  <span className="font-medium text-gray-900">{pendingChanges.exchange_rate.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Fee Type:</span>
                  <span className="font-medium text-gray-900 capitalize">{pendingChanges.withdrawal_fee_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Fee Value:</span>
                  <span className="font-medium text-gray-900">
                    {pendingChanges.withdrawal_fee_value}
                    {pendingChanges.withdrawal_fee_type === 'percentage' ? '%' : ' USD'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Listener Minimum:</span>
                  <span className="font-medium text-gray-900">
                    {formatCurrency(pendingChanges.minimum_withdrawal_usd_listener)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Creator Minimum:</span>
                  <span className="font-medium text-gray-900">
                    {formatCurrency(pendingChanges.minimum_withdrawal_usd_creator)}
                  </span>
                </div>
                {pendingChanges.disabled_reason && (
                  <div className="pt-2 border-t border-gray-200">
                    <span className="text-gray-600">Disabled Reason:</span>
                    <p className="text-gray-900 mt-1 text-sm">{pendingChanges.disabled_reason}</p>
                  </div>
                )}
              </div>

              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  <strong>Note:</strong> These changes will take effect immediately and will be logged in the audit trail.
                </p>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all duration-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmUpdate}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Updating...' : 'Confirm Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
