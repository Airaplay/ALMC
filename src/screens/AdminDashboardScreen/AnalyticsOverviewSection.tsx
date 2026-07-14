import { useState, useEffect } from 'react';
import { Users, Music, Play, DollarSign, TrendingUp, AlertTriangle, ArrowUpRight, Coins } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
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
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

const CHART_COLORS = ['#309605', '#60a5fa', '#f472b6', '#facc15', '#fb923c', '#a3e635'];

export const AnalyticsOverviewSection = (): JSX.Element => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalContent: 0,
    totalPlays: 0,
    grossRevenueUSD: 0,
    totalWithdrawnUSD: 0,
    netRevenueUSD: 0,
    platformShareRevenueUSD: 0,
    totalUserBalanceUSD: 0,
    totalTreatEarnings: 0,
    totalTreatRevenueUSD: 0,
    externalRevenueUSD: 0,
    admobGrossUSD: 0,
    admobNetUSD: 0,
    treatWalletBalance: 0,
    curatorEarnings: 0,
    newUsersToday: 0,
    newContentToday: 0,
    playsToday: 0,
    liveBalanceIntegrityOk: true,
    liveBalanceOverpaymentUSD: 0,
  });
  const [userGrowth, setUserGrowth] = useState<any[]>([]);
  const [contentTypeDistribution, setContentTypeDistribution] = useState<any[]>([]);
  const [recentPlays, setRecentPlays] = useState<any[]>([]);
  const [topContent, setTopContent] = useState<any[]>([]);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');

  useEffect(() => {
    fetchAnalyticsData();
  }, [timeRange]);

  const fetchAnalyticsData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayStr = today.toISOString();

      let startDate = new Date(today);
      if (timeRange === '7d') startDate.setDate(startDate.getDate() - 7);
      else if (timeRange === '30d') startDate.setDate(startDate.getDate() - 30);
      else startDate.setDate(startDate.getDate() - 90);
      const startDateStr = startDate.toISOString();

      const [
        { count: totalUsers },
        { count: newUsersToday },
        { count: totalContent },
        { count: newContentToday },
        { data: overviewTotals },
        { count: songPlaysToday },
        { count: videoPlaysToday },
      ] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true }),
        supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', todayStr),
        supabase.from('content_uploads').select('*', { count: 'exact', head: true }),
        supabase.from('content_uploads').select('*', { count: 'exact', head: true }).gte('created_at', todayStr),
        supabase.rpc('admin_get_analytics_overview_totals'),
        supabase.from('listening_history').select('*', { count: 'exact', head: true }).gte('listened_at', todayStr),
        supabase.from('video_playback_history').select('*', { count: 'exact', head: true }).gte('watched_at', todayStr),
      ]);

      if (overviewTotals?.error) throw new Error(overviewTotals.error);

      const songPlays = Number(overviewTotals?.song_plays || 0);
      const videoPlays = Number(overviewTotals?.video_plays || 0);

      const usdEarnings = overviewTotals?.usd_earnings || {};
      const totalUserBalanceUSD = Number(usdEarnings.net_usd || 0);
      const totalWithdrawnUSD = Number(usdEarnings.withdrawn_usd || 0);
      const admobGrossUSD = Number(overviewTotals?.admob_total_revenue_usd || 0);
      const treatRevenueUSD = Number(overviewTotals?.total_treat_revenue_usd || 0);
      const externalRevenueUSD = Number(overviewTotals?.external_revenue_gross_usd || 0);
      const grossRevenueUSD = Number(
        overviewTotals?.platform_revenue_gross_usd ?? (admobGrossUSD + treatRevenueUSD + externalRevenueUSD)
      );
      const platformShareComponents = overviewTotals?.platform_share_components || {};
      const netRevenueUSD = Number(
        overviewTotals?.platform_revenue_net_usd
        ?? (
          Number(platformShareComponents.admob_platform_share_usd || 0)
          + Number(platformShareComponents.external_platform_share_usd || 0)
        )
      );
      const platformShareRevenueUSD = Number(overviewTotals?.platform_share_revenue_usd || 0);
      const liveBalanceIntegrity = usdEarnings.live_balance_integrity || {};
      const liveBalanceIntegrityOk = liveBalanceIntegrity.ok !== false;
      const liveBalanceOverpaymentUSD = Number(liveBalanceIntegrity.overpayment_usd || 0);

      setStats({
        totalUsers: totalUsers || 0,
        totalContent: totalContent || 0,
        totalPlays: songPlays + videoPlays,
        grossRevenueUSD,
        totalWithdrawnUSD,
        netRevenueUSD,
        platformShareRevenueUSD,
        totalUserBalanceUSD,
        totalTreatEarnings: Number(overviewTotals?.total_treat_earnings || 0),
        totalTreatRevenueUSD: treatRevenueUSD,
        externalRevenueUSD,
        admobGrossUSD,
        admobNetUSD: Number(overviewTotals?.admob_net_revenue_usd || 0),
        treatWalletBalance: Number(overviewTotals?.treat_wallet_balance || 0),
        curatorEarnings: Number(overviewTotals?.curator_earnings || 0),
        newUsersToday: newUsersToday || 0,
        newContentToday: newContentToday || 0,
        playsToday: (songPlaysToday || 0) + (videoPlaysToday || 0),
        liveBalanceIntegrityOk,
        liveBalanceOverpaymentUSD,
      });

      await Promise.all([
        fetchUserGrowthData(startDateStr),
        fetchContentTypeDistribution(),
        fetchRecentPlaysData(startDateStr),
        fetchTopContent(),
      ]);
    } catch (err) {
      console.error('Error fetching analytics data:', err);
      setError('Failed to load analytics data');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUserGrowthData = async (startDateStr: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('created_at')
        .gte('created_at', startDateStr)
        .order('created_at');
      if (error) throw error;

      const usersByDate = data?.reduce((acc: Record<string, number>, user) => {
        const date = format(new Date(user.created_at), 'yyyy-MM-dd');
        acc[date] = (acc[date] || 0) + 1;
        return acc;
      }, {}) || {};

      const dateRange = [];
      let currentDate = new Date(startDateStr);
      const endDate = new Date();
      while (currentDate <= endDate) {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        dateRange.push({ date: dateStr, count: usersByDate[dateStr] || 0, label: format(currentDate, 'MMM dd') });
        currentDate.setDate(currentDate.getDate() + 1);
      }
      setUserGrowth(dateRange);
    } catch (err) {
      console.error('Error fetching user growth data:', err);
    }
  };

  const fetchContentTypeDistribution = async () => {
    try {
      const { data, error } = await supabase
        .from('content_uploads')
        .select('content_type')
        .eq('status', 'approved');
      if (error) throw error;

      const counts: Record<string, number> = {};
      data?.forEach(item => { counts[item.content_type] = (counts[item.content_type] || 0) + 1; });
      setContentTypeDistribution(Object.entries(counts).map(([type, count]) => ({ name: formatContentType(type), value: count })));
    } catch (err) {
      console.error('Error fetching content type distribution:', err);
    }
  };

  const fetchRecentPlaysData = async (startDateStr: string) => {
    try {
      const [{ data: songPlays }, { data: videoPlays }] = await Promise.all([
        supabase.from('listening_history').select('listened_at').gte('listened_at', startDateStr).order('listened_at'),
        supabase.from('video_playback_history').select('watched_at').gte('watched_at', startDateStr).order('watched_at'),
      ]);

      const playsByDate = songPlays?.reduce((acc: Record<string, number>, play) => {
        const date = format(new Date(play.listened_at), 'yyyy-MM-dd');
        acc[date] = (acc[date] || 0) + 1;
        return acc;
      }, {}) || {};

      videoPlays?.forEach(play => {
        const date = format(new Date(play.watched_at), 'yyyy-MM-dd');
        playsByDate[date] = (playsByDate[date] || 0) + 1;
      });

      const dateRange = [];
      let currentDate = new Date(startDateStr);
      const endDate = new Date();
      while (currentDate <= endDate) {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        dateRange.push({ date: dateStr, plays: playsByDate[dateStr] || 0, label: format(currentDate, 'MMM dd') });
        currentDate.setDate(currentDate.getDate() + 1);
      }
      setRecentPlays(dateRange);
    } catch (err) {
      console.error('Error fetching recent plays data:', err);
    }
  };

  const fetchTopContent = async () => {
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('id, title, play_count, artists:artist_id(name)')
        .order('play_count', { ascending: false })
        .limit(5);
      if (error) throw error;

      setTopContent(data?.map((song: any) => {
        const artistData = Array.isArray(song.artists) ? song.artists[0] : song.artists;
        return { id: song.id, title: song.title, artist: artistData?.name || 'Unknown Artist', plays: song.play_count || 0 };
      }) || []);
    } catch (err) {
      console.error('Error fetching top content:', err);
    }
  };

  const formatContentType = (type: string): string => {
    const map: Record<string, string> = { single: 'Singles', album: 'Albums', video: 'Videos', short_clip: 'Short Clips' };
    return map[type] || type.charAt(0).toUpperCase() + type.slice(1);
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-48 bg-gray-100 rounded-lg animate-pulse" />
          <div className="h-9 w-52 bg-gray-100 rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-5 border border-gray-100 animate-pulse">
              <div className="h-4 w-24 bg-gray-100 rounded mb-4" />
              <div className="h-7 w-16 bg-gray-100 rounded mb-2" />
              <div className="h-3 w-20 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-white rounded-xl border border-red-100 text-center">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="text-red-600 font-medium mb-1">Failed to load analytics</p>
        <p className="text-gray-500 text-sm mb-4">{error}</p>
        <button
          onClick={fetchAnalyticsData}
          className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-sm font-medium transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  const StatCard = ({
    title,
    value,
    sub,
    icon: Icon,
    iconBg,
    iconColor,
    accent,
    badge,
  }: {
    title: string;
    value: string;
    sub: string;
    icon: any;
    iconBg: string;
    iconColor: string;
    accent?: boolean;
    badge?: { text: string; positive?: boolean; alert?: boolean };
  }) => (
    <div className={`bg-white rounded-xl p-5 border ${accent ? 'border-[#b0e6d4]' : badge?.alert ? 'border-red-300' : 'border-gray-100'} shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-gray-500 leading-tight">{title}</p>
        <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
      </div>
      <p className={`text-2xl font-bold tracking-tight mb-1 ${accent ? 'text-[#309605]' : badge?.alert ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      <div className="flex flex-col gap-1">
        {badge ? (
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold w-fit ${
              badge.alert
                ? 'balance-mismatch-blink text-red-600 bg-red-50 border border-red-200 rounded-md px-2 py-0.5'
                : badge.positive !== false
                  ? 'text-[#309605]'
                  : 'text-gray-500'
            }`}
          >
            {badge.alert ? <AlertTriangle className="w-3 h-3" /> : badge.positive !== false ? <ArrowUpRight className="w-3 h-3" /> : null}
            {badge.text}
          </span>
        ) : null}
        {(badge?.alert || !badge) && (
          <span className={`text-xs ${badge?.alert ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{sub}</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Analytics Overview</h2>
          <p className="text-sm text-gray-400 mt-0.5">Platform performance at a glance</p>
        </div>
        <div className="flex items-center bg-white border border-gray-200 rounded-lg p-1 shadow-sm flex-shrink-0">
          {(['7d', '30d', '90d'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                timeRange === r
                  ? 'bg-[#309605] text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {r === '7d' ? '7D' : r === '30d' ? '30D' : '90D'}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Row 1 — Core KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          title="Total Users"
          value={formatNumber(stats.totalUsers)}
          sub="Registered accounts"
          icon={Users}
          iconBg="bg-blue-50"
          iconColor="text-blue-500"
          badge={{ text: `+${stats.newUsersToday} today`, positive: true }}
        />
        <StatCard
          title="Total Content"
          value={formatNumber(stats.totalContent)}
          sub="Uploads"
          icon={Music}
          iconBg="bg-[#e6f7f1]"
          iconColor="text-[#309605]"
          badge={{ text: `+${stats.newContentToday} today`, positive: true }}
        />
        <StatCard
          title="Total Plays"
          value={formatNumber(stats.totalPlays)}
          sub="All time"
          icon={Play}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-500"
          badge={{ text: `+${stats.playsToday} today`, positive: true }}
        />
        <StatCard
          title="Gross USD Revenue"
          value={formatCurrency(stats.grossRevenueUSD)}
          sub="AdMob + Treat purchases + External revenue"
          icon={DollarSign}
          iconBg="bg-amber-50"
          iconColor="text-amber-500"
        />
      </div>

      {/* Stats Row 2 — Financial Detail */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Net USD Revenue"
          value={formatCurrency(stats.netRevenueUSD)}
          sub="Airaplay earned after buffers, fees, and user payout splits"
          icon={DollarSign}
          iconBg="bg-[#e6f7f1]"
          iconColor="text-[#309605]"
          accent
          badge={{ text: 'After all deductions', positive: true }}
        />
        <StatCard
          title="Platform Revenue"
          value={formatCurrency(stats.platformShareRevenueUSD)}
          sub="Platform share/retained only"
          icon={DollarSign}
          iconBg="bg-teal-50"
          iconColor="text-teal-600"
        />
        <StatCard
          title="Total User Balance"
          value={formatCurrency(stats.totalUserBalanceUSD)}
          sub={
            stats.liveBalanceIntegrityOk
              ? "Sum of all users' USD live balances"
              : `Integrity warning: ${formatCurrency(stats.liveBalanceOverpaymentUSD)} above auditable credits`
          }
          icon={Users}
          iconBg="bg-blue-50"
          iconColor="text-blue-500"
          badge={
            stats.liveBalanceIntegrityOk
              ? undefined
              : { text: 'Balance mismatch', positive: false, alert: true }
          }
        />
        <StatCard
          title="Total Withdrawn"
          value={formatCurrency(stats.totalWithdrawnUSD)}
          sub="Paid out to users"
          icon={TrendingUp}
          iconBg="bg-red-50"
          iconColor="text-red-400"
        />
        <StatCard
          title="Treat Revenue (USD)"
          value={formatCurrency(stats.totalTreatRevenueUSD)}
          sub="From Treat purchases"
          icon={DollarSign}
          iconBg="bg-sky-50"
          iconColor="text-sky-500"
        />
        <StatCard
          title="AdMob Revenue (USD)"
          value={formatCurrency(stats.admobGrossUSD)}
          sub={`Gross sync • Usable after buffer: ${formatCurrency(stats.admobNetUSD)}`}
          icon={DollarSign}
          iconBg="bg-violet-50"
          iconColor="text-violet-500"
        />
        <StatCard
          title="External Revenue (USD)"
          value={formatCurrency(stats.externalRevenueUSD)}
          sub="Sponsorships and partner income"
          icon={DollarSign}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-500"
        />
        <StatCard
          title="Treat Balance"
          value={formatNumber(stats.treatWalletBalance)}
          sub="Current wallet balance"
          icon={Coins}
          iconBg="bg-orange-50"
          iconColor="text-orange-500"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* User Growth */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <Users className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">User Growth</h3>
              <p className="text-xs text-gray-400">New registrations over time</p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={userGrowth} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#9CA3AF', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#9CA3AF', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)', fontSize: 12 }}
                  cursor={{ fill: '#F9FAFB' }}
                />
                <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Plays */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-lg bg-[#e6f7f1] flex items-center justify-center">
              <Play className="w-4 h-4 text-[#309605]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Recent Plays</h3>
              <p className="text-xs text-gray-400">Daily play activity</p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={recentPlays} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#9CA3AF', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#9CA3AF', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)', fontSize: 12 }}
                  cursor={{ stroke: '#E5E7EB' }}
                />
                <Line
                  type="monotone"
                  dataKey="plays"
                  stroke="#309605"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ fill: '#309605', r: 4, stroke: '#fff', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Content Distribution */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-lg bg-[#e6f7f1] flex items-center justify-center">
              <Music className="w-4 h-4 text-[#309605]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Content Distribution</h3>
              <p className="text-xs text-gray-400">Breakdown by content type</p>
            </div>
          </div>
          <div className="h-64">
            {contentTypeDistribution.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-gray-400 text-sm">No content data available</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={contentTypeDistribution}
                    cx="50%"
                    cy="45%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {contentTypeDistribution.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: 12 }}
                    formatter={(value: any) => [`${value} uploads`, '']}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Top Content */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Top Content</h3>
              <p className="text-xs text-gray-400">Most played tracks</p>
            </div>
          </div>
          {topContent.length === 0 ? (
            <div className="h-64 flex items-center justify-center">
              <p className="text-gray-400 text-sm">No content data available</p>
            </div>
          ) : (
            <div className="space-y-2">
              {topContent.map((item, index) => (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    index === 0 ? 'bg-amber-50 text-amber-600' :
                    index === 1 ? 'bg-gray-100 text-gray-500' :
                    index === 2 ? 'bg-orange-50 text-orange-500' :
                    'bg-gray-50 text-gray-400'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                    <p className="text-xs text-gray-400 truncate">{item.artist}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Play className="w-3.5 h-3.5 text-[#309605]" />
                    <span className="text-sm font-semibold text-gray-700">{formatNumber(item.plays)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
