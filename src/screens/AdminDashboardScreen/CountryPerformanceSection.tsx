import React, { useState, useEffect } from 'react';
import { Search, Download, Globe, Users, TrendingUp, Play, Eye, DollarSign, Wallet, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { LoadingLogo } from '../../components/LoadingLogo';

interface CountryPerformanceData {
  country_code: string;
  country_name: string;
  total_users: number;
  active_users_period: number;
  listener_count: number;
  creator_count: number;
  male_count: number;
  female_count: number;
  other_count: number;
  new_users_period: number;
  total_plays: number;
  total_views: number;
  avg_plays_per_user: number;
  avg_views_per_user: number;
  ad_revenue_total: number;
  ad_revenue_creators: number;
  ad_revenue_listeners: number;
  ad_revenue_platform: number;
  treat_purchase_revenue: number;
  treat_spent_amount: number;
  curator_earnings_total: number;
  gross_earnings_usd: number;
  current_balance_usd: number;
  withdrawn_usd: number;
  plays_growth_percent: number;
  users_growth_percent: number;
}

interface GlobalStats {
  totalCountries: number;
  totalUsers: number;
  totalPlays: number;
  totalRevenue: number;
  topCountry: string;
  fastestGrowingCountry: string;
}

export const CountryPerformanceSection = (): JSX.Element => {
  const [countryData, setCountryData] = useState<CountryPerformanceData[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [sortBy, setSortBy] = useState<string>('total_users');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<'overview' | 'detailed'>('overview');

  useEffect(() => {
    fetchCountryPerformance();
  }, [timeRange]);

  const getDateRange = () => {
    const endDate = new Date();
    let startDate = new Date();

    switch (timeRange) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case 'all':
        return { startDate: null, endDate: null };
    }

    return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
  };

  const fetchCountryPerformance = async () => {
    try {
      setIsLoading(true);

      const { startDate, endDate } = getDateRange();

      const { data, error } = await supabase.rpc('get_country_performance_analytics', {
        p_start_date: startDate,
        p_end_date: endDate
      });

      if (error) throw error;

      const formattedData: CountryPerformanceData[] = data || [];
      setCountryData(formattedData);

      // Calculate global stats
      if (formattedData.length > 0) {
        const totalRevenue = formattedData.reduce((sum, c) =>
          sum + Number(c.ad_revenue_total) + Number(c.treat_purchase_revenue), 0
        );

        const topRevenueCountry = [...formattedData].sort((a, b) =>
          (Number(b.ad_revenue_total) + Number(b.treat_purchase_revenue)) -
          (Number(a.ad_revenue_total) + Number(a.treat_purchase_revenue))
        )[0];

        const fastestGrowing = [...formattedData].sort((a, b) =>
          Number(b.users_growth_percent) - Number(a.users_growth_percent)
        )[0];

        setGlobalStats({
          totalCountries: formattedData.length,
          totalUsers: formattedData.reduce((sum, c) => sum + Number(c.total_users), 0),
          totalPlays: formattedData.reduce((sum, c) => sum + Number(c.total_plays) + Number(c.total_views), 0),
          totalRevenue,
          topCountry: topRevenueCountry?.country_code || 'N/A',
          fastestGrowingCountry: fastestGrowing?.country_code || 'N/A'
        });
      }

    } catch (err) {
      console.error('Error fetching country performance:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredData = countryData
    .filter(country =>
      country.country_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      country.country_code.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      const aVal = Number(a[sortBy as keyof CountryPerformanceData]);
      const bVal = Number(b[sortBy as keyof CountryPerformanceData]);
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const exportToCSV = () => {
    const headers = [
      'Country Code',
      'Total Users',
      'Active Users',
      'Listeners',
      'Creators',
      'Total Plays',
      'Total Views',
      'Ad Revenue',
      'Treat Revenue',
      'Gross Earnings',
      'Withdrawn',
      'Current Balance',
      'User Growth %',
      'Plays Growth %'
    ];

    const rows = filteredData.map(country => [
      country.country_code,
      country.total_users,
      country.active_users_period,
      country.listener_count,
      country.creator_count,
      country.total_plays,
      country.total_views,
      Number(country.ad_revenue_total).toFixed(2),
      Number(country.treat_purchase_revenue).toFixed(2),
      Number(country.gross_earnings_usd).toFixed(2),
      Number(country.withdrawn_usd).toFixed(2),
      Number(country.current_balance_usd).toFixed(2),
      Number(country.users_growth_percent).toFixed(2),
      Number(country.plays_growth_percent).toFixed(2)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `country_performance_${timeRange}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Prepare chart data
  const topCountriesByUsers = [...filteredData].slice(0, 10);
  const topCountriesByRevenue = [...filteredData]
    .sort((a, b) =>
      (Number(b.ad_revenue_total) + Number(b.treat_purchase_revenue)) -
      (Number(a.ad_revenue_total) + Number(a.treat_purchase_revenue))
    )
    .slice(0, 10);

  const topCountriesByEngagement = [...filteredData]
    .sort((a, b) => (Number(b.total_plays) + Number(b.total_views)) - (Number(a.total_plays) + Number(a.total_views)))
    .slice(0, 10);

  const revenueBreakdownData = filteredData.slice(0, 5).map(country => ({
    country: country.country_code,
    'Ad Revenue': Number(country.ad_revenue_total),
    'Treat Revenue': Number(country.treat_purchase_revenue),
    'Curator Earnings': Number(country.curator_earnings_total)
  }));

  const genderDistribution = filteredData.reduce((acc, country) => {
    acc[0].value += Number(country.male_count);
    acc[1].value += Number(country.female_count);
    acc[2].value += Number(country.other_count);
    return acc;
  }, [
    { name: 'Male', value: 0, color: '#3b82f6' },
    { name: 'Female', value: 0, color: '#ec4899' },
    { name: 'Other', value: 0, color: '#8b5cf6' }
  ]);

  const COLORS = ['#00ad74', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingLogo variant="pulse" size={32} />
        <p className="ml-4 text-gray-700">Loading country performance data...</p>
      </div>
    );
  }

  const TOOLTIP_STYLE = {
    backgroundColor: '#fff',
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
    fontSize: 12,
  };

  const AXIS_TICK = { fill: '#9CA3AF', fontSize: 11 };

  const ChartCard = ({ icon, iconBg, iconColor, title, subtitle, children }: {
    icon: React.ReactNode;
    iconBg: string;
    iconColor: string;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
  }) => (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center gap-2.5 mb-5">
        <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
          <span className={iconColor}>{icon}</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900 leading-tight">{title}</h3>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Country Performance</h2>
          <p className="text-sm text-gray-400 mt-0.5">Marketing insights, financial tracking, and content strategy by country</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
            {(['7d', '30d', '90d', 'all'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range as any)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  timeRange === range
                    ? 'bg-[#309605] text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {range === 'all' ? 'All Time' : range.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={exportToCSV}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg transition-colors text-xs font-medium shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI Stats Row */}
      {globalStats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            { label: 'Active Countries', value: globalStats.totalCountries, icon: <Globe className="w-4 h-4" />, iconBg: 'bg-blue-50', iconColor: 'text-blue-500' },
            { label: 'Total Users', value: formatNumber(globalStats.totalUsers), icon: <Users className="w-4 h-4" />, iconBg: 'bg-[#e6f7f1]', iconColor: 'text-[#309605]' },
            { label: 'Total Engagement', value: formatNumber(globalStats.totalPlays), icon: <Play className="w-4 h-4" />, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-500' },
            { label: 'Total Revenue', value: formatCurrency(globalStats.totalRevenue), icon: <DollarSign className="w-4 h-4" />, iconBg: 'bg-amber-50', iconColor: 'text-amber-500' },
            { label: 'Top Revenue', value: globalStats.topCountry, icon: <TrendingUp className="w-4 h-4" />, iconBg: 'bg-orange-50', iconColor: 'text-orange-500' },
            { label: 'Fastest Growth', value: globalStats.fastestGrowingCountry, icon: <ArrowUpRight className="w-4 h-4" />, iconBg: 'bg-rose-50', iconColor: 'text-rose-500' },
          ].map((stat, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-start justify-between mb-2">
                <p className="text-xs font-medium text-gray-500 leading-tight">{stat.label}</p>
                <div className={`w-8 h-8 rounded-lg ${stat.iconBg} flex items-center justify-center flex-shrink-0`}>
                  <span className={stat.iconColor}>{stat.icon}</span>
                </div>
              </div>
              <p className="text-xl font-bold text-gray-900 tracking-tight">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* View Toggle */}
      <div className="flex items-center bg-white border border-gray-200 rounded-lg p-1 shadow-sm w-fit">
        {(['overview', 'detailed'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              viewMode === mode
                ? 'bg-[#309605] text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {mode === 'overview' ? 'Overview Charts' : 'Detailed Table'}
          </button>
        ))}
      </div>

      {/* Overview Charts */}
      {viewMode === 'overview' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <ChartCard
            icon={<Users className="w-4 h-4" />}
            iconBg="bg-blue-50"
            iconColor="text-blue-500"
            title="Top 10 Countries by Users"
            subtitle="Total vs active users"
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCountriesByUsers} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="country_code" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#F9FAFB' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="total_users" fill="#00ad74" name="Total Users" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="active_users_period" fill="#3b82f6" name="Active Users" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard
            icon={<DollarSign className="w-4 h-4" />}
            iconBg="bg-amber-50"
            iconColor="text-amber-500"
            title="Top 10 Countries by Revenue"
            subtitle="Ad and Treat revenue stacked"
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCountriesByRevenue} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="country_code" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#F9FAFB' }} formatter={(value) => formatCurrency(value as number)} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="ad_revenue_total" fill="#10b981" name="Ad Revenue" stackId="a" />
                  <Bar dataKey="treat_purchase_revenue" fill="#f59e0b" name="Treat Revenue" stackId="a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard
            icon={<Play className="w-4 h-4" />}
            iconBg="bg-[#e6f7f1]"
            iconColor="text-[#309605]"
            title="Top 10 Countries by Engagement"
            subtitle="Plays and views combined"
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCountriesByEngagement} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="country_code" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#F9FAFB' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="total_plays" fill="#a78bfa" name="Plays" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="total_views" fill="#f472b6" name="Views" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard
            icon={<Wallet className="w-4 h-4" />}
            iconBg="bg-[#e6f7f1]"
            iconColor="text-[#309605]"
            title="Revenue Sources — Top 5 Countries"
            subtitle="Ad, Treat, and Curator breakdown"
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueBreakdownData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="country" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#F9FAFB' }} formatter={(value) => formatCurrency(value as number)} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Ad Revenue" fill="#00ad74" stackId="a" />
                  <Bar dataKey="Treat Revenue" fill="#3b82f6" stackId="a" />
                  <Bar dataKey="Curator Earnings" fill="#f59e0b" stackId="a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard
            icon={<Users className="w-4 h-4" />}
            iconBg="bg-rose-50"
            iconColor="text-rose-500"
            title="Gender Distribution"
            subtitle="Across all countries"
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={genderDistribution}
                    cx="50%"
                    cy="45%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {genderDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard
            icon={<TrendingUp className="w-4 h-4" />}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-500"
            title="Listeners vs Creators"
            subtitle="Top 10 countries breakdown"
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCountriesByUsers} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="country_code" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#F9FAFB' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="listener_count" fill="#3b82f6" name="Listeners" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="creator_count" fill="#10b981" name="Creators" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      )}

      {/* Detailed Table View */}
      {viewMode === 'detailed' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search by country..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-transparent transition-all"
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#309605]"
              >
                <option value="total_users">Sort: Total Users</option>
                <option value="active_users_period">Sort: Active Users</option>
                <option value="total_plays">Sort: Total Plays</option>
                <option value="total_views">Sort: Total Views</option>
                <option value="ad_revenue_total">Sort: Ad Revenue</option>
                <option value="treat_purchase_revenue">Sort: Treat Revenue</option>
                <option value="gross_earnings_usd">Sort: Gross Earnings</option>
                <option value="users_growth_percent">Sort: User Growth %</option>
              </select>
              <button
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors font-medium"
              >
                {sortOrder === 'desc' ? '↓ Desc' : '↑ Asc'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Country</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Users</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Active</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">L / C</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Plays</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Views</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Ad Revenue</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Treat Rev.</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Gross Earn.</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Withdrawn</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Balance</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Growth</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-10 text-center text-sm text-gray-400">
                      No country data available
                    </td>
                  </tr>
                ) : (
                  filteredData.map((country, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-gray-900">{country.country_code}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatNumber(Number(country.total_users))}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatNumber(Number(country.active_users_period))}</td>
                      <td className="px-4 py-3 text-right text-gray-500 text-xs">
                        {formatNumber(Number(country.listener_count))} / {formatNumber(Number(country.creator_count))}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatNumber(Number(country.total_plays))}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatNumber(Number(country.total_views))}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(Number(country.ad_revenue_total))}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(Number(country.treat_purchase_revenue))}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(Number(country.gross_earnings_usd))}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(Number(country.withdrawn_usd))}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(Number(country.current_balance_usd))}</td>
                      <td className="px-4 py-3 text-right">
                        {Number(country.users_growth_percent) > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-600">
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            {Number(country.users_growth_percent).toFixed(1)}%
                          </span>
                        ) : Number(country.users_growth_percent) < 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-red-500">
                            <ArrowDownRight className="w-3.5 h-3.5" />
                            {Number(country.users_growth_percent).toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">0%</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
