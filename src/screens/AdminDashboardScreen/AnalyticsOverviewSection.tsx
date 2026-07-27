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
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

const CHART_COLORS = ['#84cc16', '#a5b4fc', '#f9a8d4', '#fde68a', '#fdba74', '#bef264'];

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
          <div className="h-8 w-52 bg-zinc-200/60 rounded-2xl animate-pulse" />
          <div className="h-10 w-56 bg-zinc-200/60 rounded-full animate-pulse" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="admin-card p-5 animate-pulse">
              <div className="h-4 w-24 bg-zinc-100 rounded-full mb-4" />
              <div className="h-8 w-20 bg-zinc-100 rounded-full mb-2" />
              <div className="h-3 w-28 bg-zinc-100 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-card p-6 text-center border-red-100">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="text-red-600 font-medium mb-1">Failed to load analytics</p>
        <p className="text-zinc-500 text-sm mb-4">{error}</p>
        <button
          onClick={fetchAnalyticsData}
          className="px-5 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-full text-sm font-medium transition-colors"
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
    <div
      className={`p-5 transition-shadow ${
        accent
          ? 'admin-card-accent'
          : badge?.alert
            ? 'admin-card border-red-200'
            : 'admin-card hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <p className={`text-xs font-medium leading-tight ${accent ? 'text-zinc-400' : 'text-zinc-500'}`}>{title}</p>
        <div className={`w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 ${accent ? 'bg-white/10' : iconBg}`}>
          <Icon className={`w-4 h-4 ${accent ? 'text-[#d9f99d]' : iconColor}`} strokeWidth={1.75} />
        </div>
      </div>
      <p className={`text-2xl font-bold tracking-tight mb-1 tabular-nums ${accent ? 'text-white' : badge?.alert ? 'text-red-600' : 'text-zinc-900'}`}>
        {value}
      </p>
      <div className="flex flex-col gap-1">
        {badge ? (
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold w-fit ${
              badge.alert
                ? 'balance-mismatch-blink text-red-600 bg-red-50 border border-red-200 rounded-full px-2.5 py-0.5'
                : accent
                  ? 'text-[#d9f99d]'
                  : badge.positive !== false
                    ? 'text-lime-700'
                    : 'text-zinc-500'
            }`}
          >
            {badge.alert ? <AlertTriangle className="w-3 h-3" /> : badge.positive !== false ? <ArrowUpRight className="w-3 h-3" /> : null}
            {badge.text}
          </span>
        ) : null}
        {(badge?.alert || !badge) && (
          <span className={`text-xs ${badge?.alert ? 'text-red-600 font-medium' : accent ? 'text-zinc-400' : 'text-zinc-400'}`}>{sub}</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 leading-tight tracking-tight">Analytics Overview</h2>
          <p className="text-sm text-zinc-400 mt-1">Platform performance at a glance</p>
        </div>
        <div className="flex items-center bg-white border border-zinc-900/[0.06] rounded-full p-1 shadow-sm flex-shrink-0">
          {(['7d', '30d', '90d'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                timeRange === r
                  ? 'bg-zinc-900 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50'
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
          iconBg="bg-violet-50"
          iconColor="text-violet-500"
          badge={{ text: `+${stats.newUsersToday} today`, positive: true }}
        />
        <StatCard
          title="Total Content"
          value={formatNumber(stats.totalContent)}
          sub="Uploads"
          icon={Music}
          iconBg="bg-[#eef8c9]"
          iconColor="text-lime-700"
          badge={{ text: `+${stats.newContentToday} today`, positive: true }}
        />
        <StatCard
          title="Total Plays"
          value={formatNumber(stats.totalPlays)}
          sub="All time"
          icon={Play}
          iconBg="bg-sky-50"
          iconColor="text-sky-500"
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
          iconBg="bg-[#eef8c9]"
          iconColor="text-lime-700"
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
          iconBg="bg-violet-50"
          iconColor="text-violet-500"
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
          iconBg="bg-rose-50"
          iconColor="text-rose-400"
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
        <div className="admin-card p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-9 h-9 rounded-2xl bg-violet-50 flex items-center justify-center">
              <Users className="w-4 h-4 text-violet-500" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">User Growth</h3>
              <p className="text-xs text-zinc-400">New registrations over time</p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={userGrowth} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F5" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#A1A1AA', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#A1A1AA', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid rgba(24,24,27,0.06)', borderRadius: '16px', boxShadow: '0 8px 24px rgba(24,24,27,0.06)', fontSize: 12 }}
                  cursor={{ fill: '#FAFAF9' }}
                />
                <Bar dataKey="count" fill="#18181b" radius={[8, 8, 8, 8]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Plays */}
        <div className="admin-card p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-9 h-9 rounded-2xl bg-[#eef8c9] flex items-center justify-center">
              <Play className="w-4 h-4 text-lime-700" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Recent Plays</h3>
              <p className="text-xs text-zinc-400">Daily play activity</p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={recentPlays} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="playsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#84cc16" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#84cc16" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F5" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#A1A1AA', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#A1A1AA', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid rgba(24,24,27,0.06)', borderRadius: '16px', boxShadow: '0 8px 24px rgba(24,24,27,0.06)', fontSize: 12 }}
                  cursor={{ stroke: '#E4E4E7' }}
                />
                <Area
                  type="monotone"
                  dataKey="plays"
                  stroke="#65a30d"
                  strokeWidth={2.5}
                  fill="url(#playsFill)"
                  activeDot={{ fill: '#18181b', r: 4, stroke: '#fff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Content Distribution */}
        <div className="admin-card p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-9 h-9 rounded-2xl bg-[#eef8c9] flex items-center justify-center">
              <Music className="w-4 h-4 text-lime-700" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Content Distribution</h3>
              <p className="text-xs text-zinc-400">Breakdown by content type</p>
            </div>
          </div>
          <div className="h-64">
            {contentTypeDistribution.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-zinc-400 text-sm">No content data available</p>
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
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid rgba(24,24,27,0.06)', borderRadius: '16px', fontSize: 12 }}
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
        <div className="admin-card p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-9 h-9 rounded-2xl bg-amber-50 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-amber-500" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Top Content</h3>
              <p className="text-xs text-zinc-400">Most played tracks</p>
            </div>
          </div>
          {topContent.length === 0 ? (
            <div className="h-64 flex items-center justify-center">
              <p className="text-zinc-400 text-sm">No content data available</p>
            </div>
          ) : (
            <div className="space-y-2">
              {topContent.map((item, index) => (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-2xl hover:bg-zinc-50 transition-colors">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    index === 0 ? 'bg-[#d9f99d] text-zinc-900' :
                    index === 1 ? 'bg-zinc-100 text-zinc-600' :
                    index === 2 ? 'bg-amber-50 text-amber-600' :
                    'bg-zinc-50 text-zinc-400'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 truncate">{item.title}</p>
                    <p className="text-xs text-zinc-400 truncate">{item.artist}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Play className="w-3.5 h-3.5 text-lime-700" strokeWidth={1.75} />
                    <span className="text-sm font-semibold text-zinc-700 tabular-nums">{formatNumber(item.plays)}</span>
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
