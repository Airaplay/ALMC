import { useState, useEffect } from 'react';
import { Card } from './ui/card';
import { BarChart, RefreshCw, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

type TimePeriod = '7d' | '30d' | '90d' | '183d' | '1y';

interface RevenueData {
  date: string;
  revenue: number;
  treatsSold: number;
  treatsSpent: number;
}

interface RevenueBreakdownChartProps {
  className?: string;
}

export const RevenueBreakdownChart = ({ className = '' }: RevenueBreakdownChartProps) => {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('30d');
  const [revenueData, setRevenueData] = useState<RevenueData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const timePeriodOptions = [
    { value: '7d' as TimePeriod, label: '7 Days', days: 7 },
    { value: '30d' as TimePeriod, label: '30 Days', days: 30 },
    { value: '90d' as TimePeriod, label: '90 Days', days: 90 },
    { value: '183d' as TimePeriod, label: '183 Days', days: 183 },
    { value: '1y' as TimePeriod, label: '1 Year', days: 365 }
  ];

  useEffect(() => {
    fetchRevenueData();
  }, [timePeriod]);

  const getDaysFromPeriod = (period: TimePeriod): number => {
    const option = timePeriodOptions.find(opt => opt.value === period);
    return option?.days || 30;
  };

  const fetchRevenueData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const days = getDaysFromPeriod(timePeriod);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data: paymentsData, error: paymentsError } = await supabase
        .from('treat_payments')
        .select('amount_usd, completed_at')
        .eq('status', 'completed')
        .gte('completed_at', startDate.toISOString())
        .order('completed_at', { ascending: true });

      if (paymentsError) throw paymentsError;

      const { data: transactionsData, error: transactionsError } = await supabase
        .from('treat_transactions')
        .select('amount, created_at, transaction_type')
        .in('transaction_type', ['tip_sent', 'spend'])
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      if (transactionsError) throw transactionsError;

      const dataByDate = new Map<string, { revenue: number; treatsSold: number; treatsSpent: number }>();

      for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - (days - i - 1));
        const dateKey = date.toISOString().split('T')[0];
        dataByDate.set(dateKey, { revenue: 0, treatsSold: 0, treatsSpent: 0 });
      }

      (paymentsData || []).forEach((payment) => {
        if (payment.completed_at) {
          const dateKey = new Date(payment.completed_at).toISOString().split('T')[0];
          if (dataByDate.has(dateKey)) {
            const existing = dataByDate.get(dateKey);
            if (existing) {
              existing.revenue += Number(payment.amount_usd) || 0;

              const treatsPurchased = (Number(payment.amount_usd) || 0) * 100;
              existing.treatsSold += treatsPurchased;
            }
          }
        }
      });

      (transactionsData || []).forEach((transaction) => {
        const dateKey = new Date(transaction.created_at).toISOString().split('T')[0];
        if (dataByDate.has(dateKey)) {
          const existing = dataByDate.get(dateKey);
          if (existing) {
            existing.treatsSpent += Number(transaction.amount) || 0;
          }
        }
      });

      const formattedData: RevenueData[] = Array.from(dataByDate.entries()).map(([date, data]) => ({
        date: formatDateForDisplay(date, days),
        revenue: Number(data.revenue.toFixed(2)),
        treatsSold: Math.round(data.treatsSold),
        treatsSpent: Math.round(data.treatsSpent)
      }));

      setRevenueData(formattedData);
    } catch (err) {
      console.error('Error fetching revenue data:', err);
      setError('Failed to load revenue data');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDateForDisplay = (dateString: string, totalDays: number): string => {
    const date = new Date(dateString);

    if (totalDays <= 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } else if (totalDays <= 90) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    }
  };

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(value);
  };

  const formatNumber = (value: number): string => {
    if (value >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M';
    } else if (value >= 1000) {
      return (value / 1000).toFixed(1) + 'K';
    }
    return value.toLocaleString();
  };

  const totalRevenue = revenueData.reduce((sum, d) => sum + d.revenue, 0);
  const totalTreatsSold = revenueData.reduce((sum, d) => sum + d.treatsSold, 0);
  const totalTreatsSpent = revenueData.reduce((sum, d) => sum + d.treatsSpent, 0);

  if (isLoading) {
    return (
      <Card className={`bg-white rounded-lg shadow p-6 ${className}`}>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-[#3ba208] border-t-transparent rounded-full animate-spin"></div>
          <p className="ml-4 text-gray-700">Loading revenue data...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={`bg-white rounded-lg shadow p-6 ${className}`}>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h4 className="text-lg font-semibold text-gray-900 flex items-center">
              <BarChart className="w-5 h-5 mr-2 text-[#3ba208]" />
              Revenue Breakdown
            </h4>
            <p className="text-sm text-gray-500 mt-1">Track revenue and treat circulation over time</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              {timePeriodOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setTimePeriod(option.value)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 ${
                    timePeriod === option.value
                      ? 'bg-[#3ba208] text-white'
                      : 'text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button
              onClick={fetchRevenueData}
              className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors duration-200"
              title="Refresh data"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-100 border border-red-200 rounded-lg">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-700 font-medium mb-1">Total Revenue</p>
            <p className="text-2xl font-bold text-green-900">{formatCurrency(totalRevenue)}</p>
          </div>

          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-700 font-medium mb-1">Treats Sold</p>
            <p className="text-2xl font-bold text-blue-900">{formatNumber(totalTreatsSold)}</p>
          </div>

          <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
            <p className="text-sm text-orange-700 font-medium mb-1">Treats Spent</p>
            <p className="text-2xl font-bold text-orange-900">{formatNumber(totalTreatsSpent)}</p>
            <p className="text-xs text-orange-600 mt-1">
              {totalTreatsSold > 0 ? `${((totalTreatsSpent / totalTreatsSold) * 100).toFixed(1)}% circulation` : 'N/A'}
            </p>
          </div>
        </div>

        {revenueData.length > 0 ? (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart data={revenueData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                  label={{ value: 'Revenue (USD)', angle: -90, position: 'insideLeft', style: { fill: '#6b7280' } }}
                  tickFormatter={formatCurrency}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                  label={{ value: 'Treats', angle: 90, position: 'insideRight', style: { fill: '#6b7280' } }}
                  tickFormatter={formatNumber}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    padding: '12px'
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === 'revenue') return [formatCurrency(value), 'Revenue'];
                    if (name === 'treatsSold') return [formatNumber(value), 'Treats Sold'];
                    if (name === 'treatsSpent') return [formatNumber(value), 'Treats Spent'];
                    return [value, name];
                  }}
                  labelStyle={{ color: '#111827', fontWeight: 'bold', marginBottom: '8px' }}
                />
                <Legend
                  wrapperStyle={{ paddingTop: '20px' }}
                  formatter={(value) => {
                    if (value === 'revenue') return 'Revenue (USD)';
                    if (value === 'treatsSold') return 'Treats Sold';
                    if (value === 'treatsSpent') return 'Treats Spent';
                    return value;
                  }}
                />
                <Bar
                  yAxisId="left"
                  dataKey="revenue"
                  fill="#309605"
                  radius={[4, 4, 0, 0]}
                  name="revenue"
                />
                <Bar
                  yAxisId="right"
                  dataKey="treatsSold"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                  name="treatsSold"
                />
                <Bar
                  yAxisId="right"
                  dataKey="treatsSpent"
                  fill="#f97316"
                  radius={[4, 4, 0, 0]}
                  name="treatsSpent"
                />
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-80 bg-gray-50 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-600">No revenue data available for this period</p>
              <p className="text-gray-500 text-sm">Data will appear as payments are completed</p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
