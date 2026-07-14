import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, RefreshCw, Calendar } from 'lucide-react';

interface FinancialDashboard {
  latest_snapshot: {
    snapshot_date: string;
    total_users: number;
    active_creators: number;
    total_revenue_collected: number;
    total_withdrawals_completed: number;
    total_withdrawals_pending: number;
    total_treats_in_wallets: number;
    total_earned_balance: number;
    total_purchased_balance: number;
    net_financial_position: number;
    reserve_ratio: number;
    alert_level: 'healthy' | 'warning' | 'critical';
  };
  financial_controls: {
    [key: string]: boolean;
  };
  alert_thresholds: Array<{
    threshold_name: string;
    threshold_value: number;
    alert_level: string;
    description: string;
  }>;
  pending_withdrawals: {
    count: number;
    total_amount_usd: number;
  };
}

export const FinancialMonitoringSection = () => {
  const [dashboard, setDashboard] = useState<FinancialDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('admin_get_financial_dashboard');

      if (error) throw error;
      setDashboard(data);
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshSnapshot = async () => {
    try {
      setRefreshing(true);
      const { error } = await supabase.rpc('generate_daily_financial_snapshot');
      if (error) throw error;
      await loadDashboard();
    } catch (error) {
      console.error('Error refreshing snapshot:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const getAlertColor = (level: string) => {
    switch (level) {
      case 'critical':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'warning':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'healthy':
        return 'text-green-600 bg-green-50 border-green-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 text-[#309605] animate-spin mr-3" />
          <span className="text-gray-600">Loading financial dashboard...</span>
        </div>
      </div>
    );
  }

  if (!dashboard || !dashboard.latest_snapshot) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <p className="text-gray-600">No financial data available</p>
      </div>
    );
  }

  const snapshot = dashboard.latest_snapshot;

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 leading-tight">Financial Monitoring</h2>
              <p className="text-sm text-gray-400 mt-0.5">Monitor platform financial health and transaction flows</p>
            </div>
          </div>
          <button
            onClick={refreshSnapshot}
            disabled={refreshing}
            className="flex items-center px-4 py-2 bg-[#309605] text-white rounded-lg hover:bg-[#3ba208] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Data
          </button>
        </div>

        {/* Alert Status */}
        <div className={`border rounded-lg p-4 ${getAlertColor(snapshot.alert_level)}`}>
          <div className="flex items-center">
            <AlertTriangle className="w-5 h-5 mr-3" />
            <div>
              <h3 className="font-semibold uppercase">{snapshot.alert_level} Status</h3>
              <p className="text-sm mt-1">
                Last updated: {new Date(snapshot.snapshot_date).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Net Position */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">Net Position</h3>
            {snapshot.net_financial_position >= 0 ? (
              <TrendingUp className="w-5 h-5 text-green-500" />
            ) : (
              <TrendingDown className="w-5 h-5 text-red-500" />
            )}
          </div>
          <p className={`text-3xl font-bold ${snapshot.net_financial_position >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            ${snapshot.net_financial_position.toFixed(2)}
          </p>
          <p className="text-xs text-gray-500 mt-2">Revenue - Liabilities</p>
        </div>

        {/* Reserve Ratio */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">Reserve Ratio</h3>
            <TrendingUp className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-3xl font-bold text-blue-600">{snapshot.reserve_ratio.toFixed(1)}%</p>
          <p className="text-xs text-gray-500 mt-2">Reserves vs Pending</p>
        </div>

        {/* Total Revenue */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">Total Revenue</h3>
            <DollarSign className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900">${snapshot.total_revenue_collected.toFixed(2)}</p>
          <p className="text-xs text-gray-500 mt-2">All-time collected</p>
        </div>

        {/* Pending Withdrawals */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">Pending Withdrawals</h3>
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
          </div>
          <p className="text-3xl font-bold text-yellow-600">${snapshot.total_withdrawals_pending.toFixed(2)}</p>
          <p className="text-xs text-gray-500 mt-2">{dashboard.pending_withdrawals.count} requests</p>
        </div>
      </div>

      {/* Detailed Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
        {/* Revenue & Liabilities */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue & Liabilities</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-gray-200">
              <span className="text-gray-600">Total Revenue Collected</span>
              <span className="font-semibold text-green-600">${snapshot.total_revenue_collected.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center pb-3 border-b border-gray-200">
              <span className="text-gray-600">Completed Withdrawals</span>
              <span className="font-semibold text-red-600">-${snapshot.total_withdrawals_completed.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center pb-3 border-b border-gray-200">
              <span className="text-gray-600">Pending Withdrawals</span>
              <span className="font-semibold text-yellow-600">-${snapshot.total_withdrawals_pending.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center pt-2">
              <span className="text-gray-900 font-semibold">Available Balance</span>
              <span className={`font-bold text-lg ${snapshot.net_financial_position >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ${snapshot.net_financial_position.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* User Balances */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">User Wallet Balances</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-gray-200">
              <span className="text-gray-600">Total Treats in Wallets</span>
              <span className="font-semibold text-gray-900">{snapshot.total_treats_in_wallets.toFixed(0)}</span>
            </div>
            <div className="flex justify-between items-center pb-3 border-b border-gray-200">
              <span className="text-gray-600">Earned Balance</span>
              <span className="font-semibold text-blue-600">{snapshot.total_earned_balance.toFixed(0)}</span>
            </div>
            <div className="flex justify-between items-center pb-3 border-b border-gray-200">
              <span className="text-gray-600">Purchased Balance</span>
              <span className="font-semibold text-green-600">{snapshot.total_purchased_balance.toFixed(0)}</span>
            </div>
            <div className="flex justify-between items-center pt-2">
              <span className="text-gray-900 font-semibold">Earned:Purchased Ratio</span>
              <span className="font-bold text-lg text-gray-900">
                {snapshot.total_purchased_balance > 0
                  ? (snapshot.total_earned_balance / snapshot.total_purchased_balance).toFixed(1)
                  : 'N/A'}
                :1
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Platform Stats */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Platform Statistics</h3>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-gray-600">Total Users</p>
            <p className="text-2xl font-bold text-gray-900">{snapshot.total_users.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Active Creators</p>
            <p className="text-2xl font-bold text-gray-900">{snapshot.active_creators.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Alert Thresholds */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Alert Thresholds</h3>
        <div className="space-y-3">
          {dashboard.alert_thresholds.map((threshold) => (
            <div key={threshold.threshold_name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900 capitalize">{threshold.threshold_name.replace(/_/g, ' ')}</p>
                <p className="text-sm text-gray-600">{threshold.description}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-900">
                  {threshold.threshold_name.includes('ratio') ? `${threshold.threshold_value}%` : `$${threshold.threshold_value}`}
                </p>
                <p className={`text-xs uppercase font-medium ${
                  threshold.alert_level === 'critical' ? 'text-red-600' : 'text-yellow-600'
                }`}>
                  {threshold.alert_level}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Financial Controls Status */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Financial Controls Status</h3>
        <div className="grid grid-cols-3 xl:grid-cols-4 gap-4">
          {Object.entries(dashboard.financial_controls).map(([name, status]) => (
            <div key={name} className="flex items-center p-3 bg-gray-50 rounded-lg">
              <div className={`w-3 h-3 rounded-full mr-3 ${status ? 'bg-green-500' : 'bg-gray-400'}`} />
              <span className="text-sm text-gray-900 capitalize">{name.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      {snapshot.alert_level === 'critical' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h3 className="font-semibold text-red-900 mb-3">CRITICAL: Immediate Action Required</h3>
          <ul className="space-y-2 text-sm text-red-800">
            <li>• Platform reserves are below safe levels</li>
            <li>• Withdrawals should remain frozen until reserves improve</li>
            <li>• Focus on revenue generation and reducing liabilities</li>
            <li>• Consider promotional credits conversion for earned balances</li>
          </ul>
        </div>
      )}

      {snapshot.alert_level === 'warning' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h3 className="font-semibold text-yellow-900 mb-3">WARNING: Monitoring Required</h3>
          <ul className="space-y-2 text-sm text-yellow-800">
            <li>• Platform reserves are approaching minimum thresholds</li>
            <li>• Monitor withdrawal requests closely</li>
            <li>• Ensure revenue generation initiatives are active</li>
          </ul>
        </div>
      )}
    </div>
  );
};
