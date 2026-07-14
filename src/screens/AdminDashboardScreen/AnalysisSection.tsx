import { useState, useEffect } from "react";
import {
  Play,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Clock,
  RefreshCw,
  Globe,
  UserCheck,
  BarChart as BarChartIcon,
  Eye,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { subDays } from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Cell,
} from 'recharts';

export const AnalysisSection = (): JSX.Element => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [adTypeData, setAdTypeData] = useState<any[]>([]);
  const [contentTypeData, setContentTypeData] = useState<any[]>([]);
  const [countryData, setCountryData] = useState<any[]>([]);
  const [dailyImpressions, setDailyImpressions] = useState<any[]>([]);
  const [completionRate, setCompletionRate] = useState<number>(0);
  const [totalImpressions, setTotalImpressions] = useState<number>(0);
  const [totalCompletedViews, setTotalCompletedViews] = useState<number>(0);
  const [avgDuration, setAvgDuration] = useState<number>(0);

  const COLORS = ['#309605', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

  useEffect(() => {
    fetchAdAnalytics();
  }, [timeRange]);

  const fetchAdAnalytics = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const endDate = new Date();
      let startDate;
      switch (timeRange) {
        case '7d': startDate = subDays(endDate, 7); break;
        case '90d': startDate = subDays(endDate, 90); break;
        default: startDate = subDays(endDate, 30);
      }

      const { data, error: fetchError } = await supabase.rpc('admin_get_ad_analytics', {
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        content_type_filter: null,
        ad_type_filter: null,
        country_filter: null
      });

      if (fetchError) throw fetchError;
      if (data && typeof data === 'object' && 'error' in data) {
        throw new Error(data.error as string || 'Access denied or error occurred');
      }

      if (data) {
        setTotalImpressions(data.total_impressions || 0);
        setTotalCompletedViews(data.completed_views || 0);
        setCompletionRate(data.completion_rate || 0);
        setAvgDuration(data.avg_duration_viewed || 0);
        setAdTypeData(Array.isArray(data.impressions_by_type) ? data.impressions_by_type : []);
        setContentTypeData(Array.isArray(data.impressions_by_content) ? data.impressions_by_content : []);
        setCountryData(Array.isArray(data.impressions_by_country) ? data.impressions_by_country : []);
        if (Array.isArray(data.daily_impressions)) {
          setDailyImpressions(data.daily_impressions.map((item: any) => ({
            date: typeof item.date === 'string' ? item.date : (item.date ? new Date(item.date).toISOString() : ''),
            count: item.count || 0
          })));
        } else {
          setDailyImpressions([]);
        }
      }
    } catch (err) {
      let errorMessage = 'Failed to load ad analytics data';
      if (err instanceof Error) errorMessage = err.message;
      else if (typeof err === 'object' && err !== null) {
        if ('message' in err) errorMessage = String((err as any).message);
        else if ('error' in err) errorMessage = String((err as any).error);
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  };

  const chartTooltipStyle = {
    contentStyle: { backgroundColor: '#fff', borderColor: '#e5e7eb', borderRadius: '0.5rem', fontSize: '12px' },
    itemStyle: { color: '#111827' },
    labelStyle: { color: '#6b7280', fontWeight: '600', marginBottom: '4px' },
  };

  if (isLoading) {
    return (
      <div className="space-y-4 min-h-full animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-8 bg-gray-100 rounded w-64" />
          <div className="h-8 bg-gray-100 rounded w-48" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
        </div>
        <div className="h-72 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 min-h-full">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <BarChartIcon className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Ad Performance Analytics</h2>
            <p className="text-sm text-gray-400 mt-0.5">Detailed analytics and performance metrics for ad campaigns</p>
          </div>
        </div>
        <div className="p-5 bg-white rounded-xl border border-gray-100 shadow-sm text-center">
          <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center mx-auto mb-3">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <p className="text-sm text-red-700 mb-3">{error}</p>
          <button onClick={fetchAdAnalytics}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <BarChartIcon className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Ad Performance Analytics</h2>
            <p className="text-sm text-gray-400 mt-0.5">Detailed analytics and performance metrics for ad campaigns</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-gray-50 border border-gray-200 rounded-lg p-0.5">
            {(['7d', '30d', '90d'] as const).map((range) => (
              <button key={range} onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  timeRange === range ? 'bg-white text-gray-900 shadow-sm border border-gray-100' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {range === '7d' ? '7D' : range === '30d' ? '30D' : '90D'}
              </button>
            ))}
          </div>
          <button onClick={fetchAdAnalytics}
            className="p-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg text-gray-500 transition-colors"
            title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Impressions', value: formatNumber(totalImpressions), sub: 'Ad views', icon: <Eye className="w-4 h-4 text-blue-600" />, bg: 'bg-blue-50', trend: null },
          { label: 'Completed Views', value: formatNumber(totalCompletedViews), sub: `${completionRate}% completion`, icon: <UserCheck className="w-4 h-4 text-[#309605]" />, bg: 'bg-green-50', trend: completionRate },
          { label: 'Avg. View Duration', value: formatDuration(avgDuration), sub: 'Per impression', icon: <Clock className="w-4 h-4 text-orange-600" />, bg: 'bg-orange-50', trend: null },
          { label: 'Top Country', value: countryData.length > 0 ? countryData[0].country : '—', sub: countryData.length > 0 ? `${formatNumber(countryData[0].count)} impressions` : 'No data', icon: <Globe className="w-4 h-4 text-yellow-600" />, bg: 'bg-yellow-50', trend: null },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500">{stat.label}</p>
              <div className={`w-7 h-7 rounded-lg ${stat.bg} flex items-center justify-center`}>{stat.icon}</div>
            </div>
            <p className="text-xl font-bold text-gray-900 truncate">{stat.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Daily Impressions Chart */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
            <Play className="w-3.5 h-3.5 text-[#309605]" />
          </div>
          <p className="text-sm font-semibold text-gray-900">Daily Impressions</p>
        </div>
        {dailyImpressions.length === 0 ? (
          <div className="h-52 flex items-center justify-center">
            <p className="text-sm text-gray-400">No data available for the selected time range.</p>
          </div>
        ) : (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyImpressions} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickFormatter={(value) => {
                    try { const d = new Date(value); return `${d.getMonth() + 1}/${d.getDate()}`; } catch { return ''; }
                  }}
                  tickMargin={8} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                <Tooltip {...chartTooltipStyle}
                  labelFormatter={(value) => { try { return new Date(value).toLocaleDateString(); } catch { return ''; } }} />
                <Line type="monotone" dataKey="count" stroke="#309605" strokeWidth={2}
                  dot={false} activeDot={{ fill: '#309605', r: 4, stroke: '#fff', strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Ad Types & Content Types side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ad Types */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-md bg-blue-50 flex items-center justify-center">
              <DollarSign className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <p className="text-sm font-semibold text-gray-900">Ad Types Performance</p>
          </div>
          {adTypeData.length === 0 ? (
            <div className="h-40 flex items-center justify-center">
              <p className="text-sm text-gray-400">No ad type data for the selected range.</p>
            </div>
          ) : (
            <>
              <div className="h-40 mb-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={adTypeData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="ad_type" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                    <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                    <Tooltip {...chartTooltipStyle} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {adTypeData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5">
                {adTypeData.map((type, index) => (
                  <div key={type.ad_type} className="flex items-center justify-between py-1.5 px-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                      <p className="text-xs font-medium text-gray-800 capitalize">{type.ad_type}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-gray-400">{formatNumber(type.count)}</p>
                      <span className="text-xs font-semibold text-gray-700 w-8 text-right">
                        {totalImpressions > 0 ? Math.round((type.count / totalImpressions) * 100) : 0}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Content Types */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5 text-[#309605]" />
            </div>
            <p className="text-sm font-semibold text-gray-900">Content Type Distribution</p>
          </div>
          {contentTypeData.length === 0 ? (
            <div className="h-40 flex items-center justify-center">
              <p className="text-sm text-gray-400">No content type data for the selected range.</p>
            </div>
          ) : (
            <>
              <div className="h-40 mb-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={contentTypeData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                    <YAxis dataKey="content_type" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} width={60} />
                    <Tooltip {...chartTooltipStyle} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {contentTypeData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5">
                {contentTypeData.map((type, index) => (
                  <div key={type.content_type} className="flex items-center justify-between py-1.5 px-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                      <p className="text-xs font-medium text-gray-800 capitalize">{type.content_type}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-gray-400">{formatNumber(type.count)}</p>
                      <span className="text-xs font-semibold text-gray-700 w-8 text-right">
                        {totalImpressions > 0 ? Math.round((type.content_type / totalImpressions) * 100) : 0}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Geographic Distribution */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-md bg-yellow-50 flex items-center justify-center">
            <Globe className="w-3.5 h-3.5 text-yellow-600" />
          </div>
          <p className="text-sm font-semibold text-gray-900">Geographic Distribution</p>
        </div>
        {countryData.length === 0 ? (
          <div className="h-40 flex items-center justify-center">
            <p className="text-sm text-gray-400">No geographic data for the selected range.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={countryData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                  <YAxis dataKey="country" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} width={80} />
                  <Tooltip {...chartTooltipStyle} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {countryData.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5">
              {countryData.slice(0, 6).map((country, index) => (
                <div key={country.country} className="flex items-center justify-between py-1.5 px-2 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-300 w-5">#{index + 1}</span>
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    <p className="text-xs font-medium text-gray-800">{country.country}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-gray-400">{formatNumber(country.count)}</p>
                    <span className="text-xs font-semibold text-gray-700 w-8 text-right">
                      {totalImpressions > 0 ? Math.round((country.count / totalImpressions) * 100) : 0}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Insights */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-md bg-blue-50 flex items-center justify-center">
              <BarChartIcon className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <p className="text-sm font-semibold text-gray-900">Performance Insights</p>
          </div>
          <ul className="space-y-2.5">
            {[
              completionRate > 70
                ? 'Ad completion rate is excellent. Consider increasing ad frequency.'
                : completionRate > 50
                ? 'Ad completion rate is good. Optimize content for better engagement.'
                : 'Ad completion rate is below average. Consider shorter, more relevant ads.',
              adTypeData.length > 0 ? `${adTypeData[0].ad_type} ads are your best performing format.` : 'No ad type data available yet.',
              countryData.length > 0 ? `${countryData[0].country} shows the highest engagement.` : 'No geographic data available yet.',
            ].map((insight, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-blue-600 text-xs font-bold">{i + 1}</span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{insight}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
              <DollarSign className="w-3.5 h-3.5 text-[#309605]" />
            </div>
            <p className="text-sm font-semibold text-gray-900">Revenue Optimization</p>
          </div>
          <ul className="space-y-2.5">
            {[
              avgDuration > 15
                ? 'Average view duration is strong. Consider longer, higher-paying ad formats.'
                : 'Average view duration is short. Focus on more engaging, shorter ad formats.',
              contentTypeData.length > 0 ? `${contentTypeData[0].content_type} content shows highest ad engagement. Encourage more of this content type.` : 'No content type data available yet.',
            ].map((insight, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-green-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i === 0 ? <Play className="w-3 h-3 text-[#309605]" /> : <TrendingUp className="w-3 h-3 text-[#309605]" />}
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{insight}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
