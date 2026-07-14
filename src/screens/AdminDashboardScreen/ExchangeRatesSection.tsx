import { useState, useEffect } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Edit2, Save, X, History, Download, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { withdrawalCurrencyService, ExchangeRate } from '../../lib/withdrawalCurrencyService';
import { useAlert } from '../../contexts/AlertContext';

interface RateHistory {
  id: string;
  country_code: string;
  old_rate: number;
  new_rate: number;
  rate_change_percent: number;
  notes?: string;
  created_at: string;
}

export default function ExchangeRatesSection() {
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [history, setHistory] = useState<RateHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editingRate, setEditingRate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const { showAlert } = useAlert();

  useEffect(() => {
    loadRates();
  }, []);

  const loadRates = async () => {
    setLoading(true);
    try {
      const data = await withdrawalCurrencyService.getAllExchangeRates();
      setRates(data);
    } catch (error) {
      console.error('Error loading rates:', error);
      showAlert('Failed to load exchange rates', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('withdrawal_exchange_rate_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error('Error loading history:', error);
      showAlert('Failed to load rate history', 'error');
    }
  };

  const startEdit = (rate: ExchangeRate) => {
    setEditingRate(rate.id);
    setEditValue(rate.exchange_rate.toString());
    setEditNotes('');
  };

  const cancelEdit = () => {
    setEditingRate(null);
    setEditValue('');
    setEditNotes('');
  };

  const saveEdit = async (rate: ExchangeRate) => {
    const newRate = parseFloat(editValue);

    if (isNaN(newRate) || newRate <= 0) {
      showAlert('Please enter a valid rate greater than 0', 'error');
      return;
    }

    if (newRate === rate.exchange_rate) {
      showAlert('New rate is same as current rate', 'error');
      return;
    }

    try {
      const result = await withdrawalCurrencyService.updateExchangeRate(
        rate.country_code,
        newRate,
        editNotes || `Updated from ${rate.exchange_rate} to ${newRate}`
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to update rate');
      }

      showAlert(`Exchange rate updated for ${rate.country_name}`, 'success');
      cancelEdit();
      loadRates();
    } catch (error: any) {
      console.error('Error updating rate:', error);
      showAlert(error.message || 'Failed to update exchange rate', 'error');
    }
  };

  const syncRatesFromAPI = async () => {
    setSyncing(true);
    try {
      // Call edge function to fetch latest rates
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-exchange-rates`,
        {
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Edge function error:', errorText);

        try {
          const errorData = JSON.parse(errorText);
          throw new Error(errorData.error || 'Failed to fetch rates from API');
        } catch (e: any) {
          if (e.message && !e.message.includes('Unexpected')) {
            throw e;
          }
          throw new Error(`Failed to fetch rates from API (${response.status}): ${errorText.substring(0, 200)}`);
        }
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'API returned error');
      }

      // Map currency codes to country codes
      const currencyToCountry: Record<string, string> = {
        'NGN': 'NG', 'GHS': 'GH', 'KES': 'KE', 'ZAR': 'ZA', 'EGP': 'EG',
        'GBP': 'GB', 'EUR': 'DE',
        'USD': 'US', 'CAD': 'CA',
        'AUD': 'AU', 'NZD': 'NZ',
        'INR': 'IN', 'PKR': 'PK',
        'BRL': 'BR', 'ARS': 'AR', 'MXN': 'MX',
        'JPY': 'JP', 'CNY': 'CN', 'SGD': 'SG',
      };

      let updatedCount = 0;
      let errorCount = 0;

      // Update rates in database
      for (const [currencyCode, rate] of Object.entries(result.rates)) {
        const countryCode = currencyToCountry[currencyCode];
        if (!countryCode) continue;

        try {
          const updateResult = await withdrawalCurrencyService.updateExchangeRate(
            countryCode,
            rate as number,
            `Auto-updated via exchangerate-api.com on ${new Date().toLocaleString()}`
          );

          if (updateResult.success) {
            updatedCount++;
          } else {
            errorCount++;
          }
        } catch (err) {
          console.error(`Error updating ${currencyCode}:`, err);
          errorCount++;
        }
      }

      showAlert(
        `Successfully updated ${updatedCount} exchange rates${errorCount > 0 ? ` (${errorCount} errors)` : ''}`,
        'success'
      );

      // Reload rates
      await loadRates();
    } catch (error: any) {
      console.error('Error syncing rates:', error);
      showAlert(error.message || 'Failed to sync exchange rates', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const getRateChangeIcon = (changePercent: number) => {
    if (changePercent > 0) {
      return <TrendingUp className="w-4 h-4 text-green-500" />;
    } else if (changePercent < 0) {
      return <TrendingDown className="w-4 h-4 text-red-500" />;
    }
    return null;
  };

  const filteredRates = rates.filter(
    (rate) =>
      rate.country_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rate.country_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rate.currency_code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const majorCurrencies = filteredRates.filter((r) =>
    ['NG', 'GH', 'KE', 'ZA', 'GB', 'US', 'CA', 'AU', 'IN', 'BR'].includes(r.country_code)
  );

  const otherCurrencies = filteredRates.filter(
    (r) => !['NG', 'GH', 'KE', 'ZA', 'GB', 'US', 'CA', 'AU', 'IN', 'BR'].includes(r.country_code)
  );

  if (loading) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#309605]"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 leading-tight">Exchange Rates</h2>
              <p className="text-sm text-gray-400 mt-0.5">Configure currency exchange rates for withdrawals</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowHistory(!showHistory);
                if (!showHistory) loadHistory();
              }}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <History className="w-4 h-4" />
              {showHistory ? 'Hide' : 'View'} History
            </button>
            <button
              onClick={syncRatesFromAPI}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className={`w-4 h-4 ${syncing ? 'animate-bounce' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync from API'}
            </button>
            <button
              onClick={loadRates}
              className="flex items-center gap-2 px-4 py-2 bg-[#309605] text-white rounded-lg hover:bg-[#3ba208] transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* API Info Banner */}
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-blue-900 mb-1">
                Exchange Rate API Integration
              </h4>
              <p className="text-sm text-blue-700">
                Click "Sync from API" to fetch the latest exchange rates from exchangerate-api.com.
                Rates are updated automatically based on real-time market data with USD as the base currency.
              </p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search by country, code, or currency..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="text-sm text-blue-600 mb-1">Total Countries</div>
            <div className="text-2xl font-bold text-blue-900">{rates.length}</div>
          </div>
          <div className="bg-green-50 rounded-lg p-4">
            <div className="text-sm text-green-600 mb-1">Active Rates</div>
            <div className="text-2xl font-bold text-green-900">
              {rates.filter((r) => r.is_active).length}
            </div>
          </div>
          <div className="bg-green-50 rounded-lg p-4">
            <div className="text-sm text-[#309605] mb-1">Currencies</div>
            <div className="text-2xl font-bold text-green-900">
              {new Set(rates.map((r) => r.currency_code)).size}
            </div>
          </div>
          <div className="bg-orange-50 rounded-lg p-4">
            <div className="text-sm text-orange-600 mb-1">Last Updated</div>
            <div className="text-sm font-semibold text-orange-900">
              {rates[0]
                ? new Date(rates[0].last_updated_at).toLocaleDateString()
                : 'N/A'}
            </div>
          </div>
        </div>
      </div>

      {/* Rate History */}
      {showHistory && (
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Rate Changes</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Country
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Old Rate
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    New Rate
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Change
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Notes
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {history.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {item.country_code}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.old_rate.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.new_rate.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                          item.rate_change_percent > 0
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {getRateChangeIcon(item.rate_change_percent)}
                        {Math.abs(item.rate_change_percent).toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                      {item.notes || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Major Currencies */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Major Currencies</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Country
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Currency
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Exchange Rate
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Source
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Last Updated
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {majorCurrencies.map((rate) => (
                <tr key={rate.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{rate.country_code}</span>
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {rate.country_name}
                        </div>
                        <div className="text-xs text-gray-500">{rate.country_code}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    <div>
                      <div className="font-medium">
                        {rate.currency_symbol} {rate.currency_code}
                      </div>
                      <div className="text-xs text-gray-500">{rate.currency_name}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {editingRate === rate.id ? (
                      <div className="space-y-2">
                        <input
                          type="number"
                          step="0.01"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                          placeholder="New rate"
                        />
                        <input
                          type="text"
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                          placeholder="Notes (optional)"
                        />
                      </div>
                    ) : (
                      <div className="text-lg font-bold text-gray-900">
                        {rate.exchange_rate.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 4,
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        rate.rate_source === 'manual'
                          ? 'bg-yellow-100 text-yellow-800'
                          : rate.rate_source === 'api'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {rate.rate_source}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {new Date(rate.last_updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {editingRate === rate.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(rate)}
                          className="p-1 text-green-600 hover:bg-green-50 rounded"
                          title="Save"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="p-1 text-red-600 hover:bg-red-50 rounded"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(rate)}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        title="Edit rate"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Other Currencies */}
      {otherCurrencies.length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Other Currencies ({otherCurrencies.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {otherCurrencies.map((rate) => (
              <div
                key={rate.id}
                className="border border-gray-200 rounded-lg p-4 hover:border-[#309605] transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{rate.country_code}</span>
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {rate.country_name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {rate.currency_symbol} {rate.currency_code}
                      </div>
                    </div>
                  </div>
                  {editingRate !== rate.id && (
                    <button
                      onClick={() => startEdit(rate)}
                      className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {editingRate === rate.id ? (
                  <div className="space-y-2">
                    <input
                      type="number"
                      step="0.01"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                      placeholder="New rate"
                    />
                    <input
                      type="text"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                      placeholder="Notes"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(rate)}
                        className="flex-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="flex-1 px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-lg font-bold text-gray-900">
                    {rate.exchange_rate.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
