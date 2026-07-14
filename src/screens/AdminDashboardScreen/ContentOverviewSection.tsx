import { useState, useEffect } from 'react';
import { Music, TrendingUp, CheckCircle, Clock, XCircle, Users, Globe, BarChart2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { LoadingLogo } from '../../components/LoadingLogo';

interface ContentStats {
  totalContent: number;
  approved: number;
  pending: number;
  rejected: number;
  flagged: number;
  singles: number;
  albums: number;
  videos: number;
  shortClips: number;
}

interface TopContent {
  id: string;
  title: string;
  content_type: string;
  play_count: number;
  metadata?: any;
}

interface TopArtist {
  user_id: string;
  display_name: string;
  avatar_url: string;
  total_plays: number;
  content_count: number;
}

interface UploadTrend {
  date: string;
  count: number;
}

interface CountryData {
  country: string;
  count: number;
}

export const ContentOverviewSection = (): JSX.Element => {
  const [stats, setStats] = useState<ContentStats>({
    totalContent: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
    flagged: 0,
    singles: 0,
    albums: 0,
    videos: 0,
    shortClips: 0,
  });
  const [topContent, setTopContent] = useState<TopContent[]>([]);
  const [topArtists, setTopArtists] = useState<TopArtist[]>([]);
  const [uploadTrends, setUploadTrends] = useState<UploadTrend[]>([]);
  const [countryData, setCountryData] = useState<CountryData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'week' | 'month'>('week');

  useEffect(() => {
    fetchOverviewData();
  }, [timeRange]);

  const fetchOverviewData = async () => {
    setIsLoading(true);
    try {
      await Promise.all([
        fetchContentStats(),
        fetchTopContent(),
        fetchTopArtists(),
        fetchUploadTrends(),
        fetchCountryData(),
      ]);
    } catch (error) {
      console.error('Error fetching overview data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchContentStats = async () => {
    const { data: allContent } = await supabase
      .from('content_uploads')
      .select('content_type, status');

    if (allContent) {
      const stats: ContentStats = {
        totalContent: allContent.length,
        approved: allContent.filter(c => c.status === 'approved').length,
        pending: allContent.filter(c => c.status === 'pending').length,
        rejected: allContent.filter(c => c.status === 'rejected').length,
        flagged: 0,
        singles: allContent.filter(c => c.content_type === 'single').length,
        albums: allContent.filter(c => c.content_type === 'album').length,
        videos: allContent.filter(c => c.content_type === 'video').length,
        shortClips: allContent.filter(c => c.content_type === 'short_clip').length,
      };
      setStats(stats);
    }
  };

  const fetchTopContent = async () => {
    const { data } = await supabase
      .from('content_uploads')
      .select('id, title, content_type, play_count, metadata')
      .eq('status', 'approved')
      .order('play_count', { ascending: false })
      .limit(5);

    if (data) {
      setTopContent(data);
    }
  };

  const fetchTopArtists = async () => {
    const { data } = await supabase
      .from('content_uploads')
      .select('user_id, users!inner(display_name, avatar_url), play_count')
      .eq('status', 'approved');

    if (data) {
      const artistMap = new Map<string, TopArtist>();

      data.forEach((item: any) => {
        const userId = item.user_id;
        const userData = item.users;
        if (artistMap.has(userId)) {
          const existing = artistMap.get(userId)!;
          existing.total_plays += item.play_count || 0;
          existing.content_count += 1;
        } else {
          artistMap.set(userId, {
            user_id: userId,
            display_name: userData.display_name || 'Unknown Artist',
            avatar_url: userData.avatar_url || '',
            total_plays: item.play_count || 0,
            content_count: 1,
          });
        }
      });

      const sortedArtists = Array.from(artistMap.values())
        .sort((a, b) => b.total_plays - a.total_plays)
        .slice(0, 5);

      setTopArtists(sortedArtists);
    }
  };

  const fetchUploadTrends = async () => {
    const daysToFetch = timeRange === 'week' ? 7 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysToFetch);

    const { data } = await supabase
      .from('content_uploads')
      .select('created_at')
      .gte('created_at', startDate.toISOString());

    if (data) {
      const trendMap = new Map<string, number>();

      for (let i = 0; i < daysToFetch; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        trendMap.set(dateStr, 0);
      }

      data.forEach(item => {
        const dateStr = item.created_at.split('T')[0];
        trendMap.set(dateStr, (trendMap.get(dateStr) || 0) + 1);
      });

      const trends = Array.from(trendMap.entries())
        .map(([date, count]) => ({
          date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          count,
        }))
        .reverse();

      setUploadTrends(trends);
    }
  };

  const fetchCountryData = async () => {
    const { data } = await supabase
      .from('content_uploads')
      .select('user_id, users!inner(country)');

    if (data) {
      const countryMap = new Map<string, number>();

      data.forEach((item: any) => {
        const userData = item.users;
        const country = userData.country || 'Unknown';
        countryMap.set(country, (countryMap.get(country) || 0) + 1);
      });

      const countries = Array.from(countryMap.entries())
        .map(([country, count]) => ({ country, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      setCountryData(countries);
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const contentTypeData = [
    { name: 'Singles', value: stats.singles, color: '#309605' },
    { name: 'Albums', value: stats.albums, color: '#3ba208' },
    { name: 'Videos', value: stats.videos, color: '#3ba208' },
    { name: 'Short Clips', value: stats.shortClips, color: '#3ba208' },
  ];

  const statusData = [
    { name: 'Approved', value: stats.approved, color: '#309605' },
    { name: 'Pending', value: stats.pending, color: '#d9f3ea' },
    { name: 'Rejected', value: stats.rejected, color: '#ff6b6b' },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingLogo variant="pulse" size={32} />
        <p className="ml-4 text-gray-700">Loading overview...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
            <BarChart2 className="w-4 h-4 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Content Overview</h2>
            <p className="text-sm text-gray-400 mt-0.5">Platform content statistics and performance at a glance</p>
          </div>
        </div>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as 'week' | 'month')}
          className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
        >
          <option value="week">Last 7 Days</option>
          <option value="month">Last 30 Days</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Content</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{formatNumber(stats.totalContent)}</p>
            </div>
            <div className="w-12 h-12 bg-[#e6f7f1] rounded-lg flex items-center justify-center">
              <Music className="w-6 h-6 text-[#309605]" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Approved</p>
              <p className="text-3xl font-bold text-[#309605] mt-1">{formatNumber(stats.approved)}</p>
            </div>
            <div className="w-12 h-12 bg-[#e6f7f1] rounded-lg flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-[#309605]" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Pending Review</p>
              <p className="text-3xl font-bold text-yellow-600 mt-1">{formatNumber(stats.pending)}</p>
            </div>
            <div className="w-12 h-12 bg-yellow-50 rounded-lg flex items-center justify-center">
              <Clock className="w-6 h-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Rejected</p>
              <p className="text-3xl font-bold text-red-600 mt-1">{formatNumber(stats.rejected)}</p>
            </div>
            <div className="w-12 h-12 bg-red-50 rounded-lg flex items-center justify-center">
              <XCircle className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Content by Type</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={contentTypeData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {contentTypeData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Content by Status</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={statusData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {statusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Upload Trends</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={uploadTrends}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="count" stroke="#309605" strokeWidth={2} name="Uploads" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center mb-4">
            <TrendingUp className="w-5 h-5 text-[#309605] mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Top Content</h3>
          </div>
          <div className="space-y-3">
            {topContent.length > 0 ? (
              topContent.map((item, index) => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center flex-1">
                    <span className="text-sm font-bold text-gray-500 mr-3">{index + 1}</span>
                    <div className="w-10 h-10 rounded bg-gray-200 flex items-center justify-center mr-3 overflow-hidden">
                      {item.metadata?.cover_url || item.metadata?.thumbnail_url ? (
                        <img
                          src={item.metadata?.cover_url || item.metadata?.thumbnail_url}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Music className="w-5 h-5 text-gray-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                      <p className="text-xs text-gray-600">{item.content_type}</p>
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <p className="text-sm font-semibold text-[#309605]">{formatNumber(item.play_count || 0)}</p>
                    <p className="text-xs text-gray-600">plays</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-600 text-center py-4">No content data available</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center mb-4">
            <Users className="w-5 h-5 text-[#309605] mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Top Artists</h3>
          </div>
          <div className="space-y-3">
            {topArtists.length > 0 ? (
              topArtists.map((artist, index) => (
                <div key={artist.user_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center flex-1">
                    <span className="text-sm font-bold text-gray-500 mr-3">{index + 1}</span>
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center mr-3 overflow-hidden">
                      {artist.avatar_url ? (
                        <img
                          src={artist.avatar_url}
                          alt={artist.display_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-semibold text-gray-700">
                          {artist.display_name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{artist.display_name}</p>
                      <p className="text-xs text-gray-600">{artist.content_count} uploads</p>
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <p className="text-sm font-semibold text-[#309605]">{formatNumber(artist.total_plays)}</p>
                    <p className="text-xs text-gray-600">plays</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-600 text-center py-4">No artist data available</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center mb-4">
          <Globe className="w-5 h-5 text-[#309605] mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Uploads by Country</h3>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={countryData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="country" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="count" fill="#309605" name="Uploads" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
