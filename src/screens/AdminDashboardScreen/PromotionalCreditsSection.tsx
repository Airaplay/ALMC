import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Gift, RefreshCw, AlertCircle, CheckCircle, TrendingUp } from 'lucide-react';

interface PromoStats {
  total_promo_balance: number;
  total_promo_earned: number;
  total_promo_spent: number;
  usage_by_type: {
    [key: string]: number;
  };
  active_users_with_promo: number;
}

export const PromotionalCreditsSection = () => {
  const [stats, setStats] = useState<PromoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('admin_get_promo_stats');

      if (error) throw error;
      setStats(data);
    } catch (error) {
      console.error('Error loading promo stats:', error);
      setMessage({ type: 'error', text: 'Failed to load promotional credit stats' });
    } finally {
      setLoading(false);
    }
  };

  const handleConversion = async () => {
    if (!confirm(
      'This will convert ALL earned balances to promotional credits. ' +
      'This action cannot be undone. Users will be notified. Continue?'
    )) {
      return;
    }

    try {
      setConverting(true);
      setMessage(null);

      const { data, error } = await supabase.rpc('convert_earned_to_promotional');

      if (error) throw error;

      setMessage({
        type: 'success',
        text: data.message || 'Conversion completed successfully'
      });

      await loadStats();
    } catch (error: any) {
      console.error('Error converting balances:', error);
      setMessage({
        type: 'error',
        text: error.message || 'Failed to convert balances'
      });
    } finally {
      setConverting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 text-[#309605] animate-spin mr-3" />
          <span className="text-gray-600">Loading promotional credits data...</span>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <p className="text-gray-600">No promotional credit data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <Gift className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 leading-tight">Promotional Credits</h2>
              <p className="text-sm text-gray-400 mt-0.5">Manage promotional credit allocations and redemptions</p>
            </div>
          </div>
          <button
            onClick={loadStats}
            className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </button>
        </div>

        {message && (
          <div
            className={`p-4 rounded-lg mb-4 ${
              message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Info Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-blue-600 mr-3 mt-0.5" />
            <div>
              <h3 className="font-semibold text-blue-900 mb-1">About Promotional Credits</h3>
              <p className="text-sm text-blue-800">
                Promotional credits are earned through contributions but cannot be withdrawn as cash.
                Users can spend them on promotions, tips, and other platform features. This reduces
                financial liability while maintaining user engagement and rewards.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Active Balance */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">Active Balance</h3>
            <Gift className="w-5 h-5 text-[#309605]" />
          </div>
          <p className="text-3xl font-bold text-[#309605]">
            {stats.total_promo_balance.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-2">Promotional credits in wallets</p>
        </div>

        {/* Total Earned */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">Total Earned</h3>
            <TrendingUp className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-3xl font-bold text-blue-600">
            {stats.total_promo_earned.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-2">All-time promotional credits earned</p>
        </div>

        {/* Total Spent */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">Total Spent</h3>
            <TrendingUp className="w-5 h-5 text-[#309605]" />
          </div>
          <p className="text-3xl font-bold text-[#309605]">
            {stats.total_promo_spent.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-2">Promotional credits spent</p>
        </div>

        {/* Active Users */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">Active Users</h3>
            <CheckCircle className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-3xl font-bold text-green-600">
            {stats.active_users_with_promo.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-2">Users with promotional credits</p>
        </div>
      </div>

      {/* Usage Breakdown */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Usage by Type</h3>
        {stats.usage_by_type && Object.keys(stats.usage_by_type).length > 0 ? (
          <div className="space-y-3">
            {Object.entries(stats.usage_by_type).map(([type, amount]) => {
              const total = stats.total_promo_spent || 1;
              const percentage = (amount / total) * 100;

              return (
                <div key={type} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700 capitalize">
                      {type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">
                      {amount.toLocaleString()} ({percentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-[#309605] h-2 rounded-full transition-all duration-300"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-gray-600 text-sm">No promotional credit usage recorded yet</p>
        )}
      </div>

      {/* Balance Conversion Tool */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Convert Earned Balances</h3>
        <p className="text-gray-600 mb-4">
          Convert all existing earned balances to promotional credits. This is a one-time operation
          that should be run as part of the Option B restructuring.
        </p>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-yellow-600 mr-3 mt-0.5" />
            <div>
              <h4 className="font-semibold text-yellow-900 mb-1">Important</h4>
              <ul className="text-sm text-yellow-800 space-y-1">
                <li>• This will convert ALL earned balances to promotional credits</li>
                <li>• Users will be notified about the conversion</li>
                <li>• This action cannot be undone</li>
                <li>• New contribution rewards will be promotional credits going forward</li>
              </ul>
            </div>
          </div>
        </div>

        <button
          onClick={handleConversion}
          disabled={converting}
          className="w-full px-6 py-3 bg-[#309605] text-white rounded-lg hover:bg-[#3ba208] transition-colors font-medium disabled:opacity-50"
        >
          {converting ? (
            <span className="flex items-center justify-center">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Converting balances...
            </span>
          ) : (
            'Convert Earned Balances to Promotional Credits'
          )}
        </button>
      </div>

      {/* Benefits Summary */}
      <div className="bg-green-50 rounded-lg p-6">
        <h3 className="font-semibold text-green-900 mb-3">Benefits of Promotional Credits</h3>
        <div className="grid grid-cols-2 gap-4 text-sm text-green-800">
          <div>
            <p className="font-medium mb-2">Financial Benefits:</p>
            <ul className="space-y-1">
              <li>• Eliminates cash withdrawal liability</li>
              <li>• Maintains user engagement</li>
              <li>• Predictable platform costs</li>
              <li>• Sustainable reward system</li>
            </ul>
          </div>
          <div>
            <p className="font-medium mb-2">User Benefits:</p>
            <ul className="space-y-1">
              <li>• Still rewards user contributions</li>
              <li>• Can be used for platform features</li>
              <li>• No limits on earning</li>
              <li>• Transparent reward system</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
