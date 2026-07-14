import { useState, useEffect } from 'react';
import { Search, Download, Globe, Users, Headphones, Mic2, Play, Eye } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { LoadingLogo } from '../../components/LoadingLogo';

interface CountryData {
  country: string;
  country_name: string;
  total_users: number;
  listener_count: number;
  creator_count: number;
  male_count: number;
  female_count: number;
  other_count: number;
  total_plays: number;
  total_views: number;
  total_revenue: number;
  avg_artist_earnings: number;
  listener_rewards: number;
}

interface GlobalStats {
  totalUsers: number;
  totalListeners: number;
  totalCreators: number;
  totalPlayCount: number;
  totalViewCount: number;
  activeCountries: number;
}

export const CountryAnalyticsSection = (): JSX.Element => {
  const [countryData, setCountryData] = useState<CountryData[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [userTypeFilter, setUserTypeFilter] = useState<string>('all');
  const [genderFilter, setGenderFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('total_users');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    fetchCountryAnalytics();
  }, []);

  const fetchCountryAnalytics = async () => {
    try {
      setIsLoading(true);

      const { data: countriesData, error: countriesError } = await supabase
        .from('users')
        .select('country, role, gender, total_earnings');

      if (countriesError) throw countriesError;

      const { data: playsData, error: playsError } = await supabase
        .from('listening_history')
        .select('user_id');

      if (playsError) throw playsError;

      const { data: viewsData, error: viewsError } = await supabase
        .from('video_playback_history')
        .select('user_id');

      if (viewsError) throw viewsError;

      const countryMap = new Map<string, CountryData>();

      countriesData?.forEach(user => {
        const country = user.country || 'Unknown';
        if (!countryMap.has(country)) {
          countryMap.set(country, {
            country,
            country_name: country,
            total_users: 0,
            listener_count: 0,
            creator_count: 0,
            male_count: 0,
            female_count: 0,
            other_count: 0,
            total_plays: 0,
            total_views: 0,
            total_revenue: 0,
            avg_artist_earnings: 0,
            listener_rewards: 0
          });
        }

        const countryStats = countryMap.get(country)!;
        countryStats.total_users++;

        if (user.role === 'listener') countryStats.listener_count++;
        if (user.role === 'creator') {
          countryStats.creator_count++;
          countryStats.total_revenue += user.total_earnings || 0;
        }

        if (user.gender === 'male') countryStats.male_count++;
        else if (user.gender === 'female') countryStats.female_count++;
        else countryStats.other_count++;
      });

      const userPlaysMap = new Map<string, number>();
      playsData?.forEach(play => {
        const userId = play.user_id;
        userPlaysMap.set(userId, (userPlaysMap.get(userId) || 0) + 1);
      });

      const userViewsMap = new Map<string, number>();
      viewsData?.forEach(view => {
        const userId = view.user_id;
        userViewsMap.set(userId, (userViewsMap.get(userId) || 0) + 1);
      });

      const { data: usersWithCountry } = await supabase
        .from('users')
        .select('id, country');

      usersWithCountry?.forEach(user => {
        const country = user.country || 'Unknown';
        const countryStats = countryMap.get(country);
        if (countryStats) {
          countryStats.total_plays += userPlaysMap.get(user.id) || 0;
          countryStats.total_views += userViewsMap.get(user.id) || 0;
        }
      });

      countryMap.forEach((stats) => {
        if (stats.creator_count > 0) {
          stats.avg_artist_earnings = stats.total_revenue / stats.creator_count;
        }
        stats.listener_rewards = stats.total_plays * 0.001;
      });

      const sortedCountries = Array.from(countryMap.values()).sort((a, b) => b.total_users - a.total_users);
      setCountryData(sortedCountries);

      const globalStatsCalc: GlobalStats = {
        totalUsers: countriesData?.length || 0,
        totalListeners: countriesData?.filter(u => u.role === 'listener').length || 0,
        totalCreators: countriesData?.filter(u => u.role === 'creator').length || 0,
        totalPlayCount: playsData?.length || 0,
        totalViewCount: viewsData?.length || 0,
        activeCountries: countryMap.size
      };
      setGlobalStats(globalStatsCalc);

    } catch (err) {
      console.error('Error fetching country analytics:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredData = countryData
    .filter(country => {
      const matchesSearch = country.country_name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesUserType =
        userTypeFilter === 'all' ||
        (userTypeFilter === 'listeners' && country.listener_count > 0) ||
        (userTypeFilter === 'creators' && country.creator_count > 0);
      const matchesGender =
        genderFilter === 'all' ||
        (genderFilter === 'male' && country.male_count > 0) ||
        (genderFilter === 'female' && country.female_count > 0) ||
        (genderFilter === 'other' && country.other_count > 0);

      return matchesSearch && matchesUserType && matchesGender;
    })
    .sort((a, b) => {
      const aVal = a[sortBy as keyof CountryData] as number;
      const bVal = b[sortBy as keyof CountryData] as number;
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat('en-US').format(num);
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
      'Country',
      'Total Users',
      'Listeners',
      'Creators',
      'Male',
      'Female',
      'Other',
      'Total Plays',
      'Total Views',
      'Total Revenue',
      'Avg Artist Earnings',
      'Listener Rewards'
    ];

    const rows = filteredData.map(country => [
      country.country_name,
      country.total_users,
      country.listener_count,
      country.creator_count,
      country.male_count,
      country.female_count,
      country.other_count,
      country.total_plays,
      country.total_views,
      country.total_revenue.toFixed(2),
      country.avg_artist_earnings.toFixed(2),
      country.listener_rewards.toFixed(2)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `country_analytics_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const topCountriesByPlays = [...filteredData]
    .sort((a, b) => b.total_plays - a.total_plays)
    .slice(0, 10);

  const topCountriesByViews = [...filteredData]
    .sort((a, b) => b.total_views - a.total_views)
    .slice(0, 10);

  const topCountriesByRevenue = [...filteredData]
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, 10);

  const genderDataForChart = filteredData.reduce((acc, country) => {
    acc[0].value += country.male_count;
    acc[1].value += country.female_count;
    acc[2].value += country.other_count;
    return acc;
  }, [
    { name: 'Male', value: 0, color: '#3b82f6' },
    { name: 'Female', value: 0, color: '#ec4899' },
    { name: 'Other', value: 0, color: '#8b5cf6' }
  ]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingLogo variant="pulse" size={32} />
        <p className="ml-4 text-gray-700">Loading country analytics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Globe className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Country Analytics</h2>
            <p className="text-sm text-gray-400 mt-0.5">Geographic breakdown of platform usage and content performance</p>
          </div>
        </div>
        <button
          onClick={exportToCSV}
          className="flex items-center px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg transition-colors"
        >
          <Download className="w-4 h-4 mr-2" />
          Export to CSV
        </button>
      </div>

      {globalStats && (
        <div className="grid grid-cols-6 gap-4">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Users</p>
                <p className="text-2xl font-bold text-gray-900">{formatNumber(globalStats.totalUsers)}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Listeners</p>
                <p className="text-2xl font-bold text-gray-900">{formatNumber(globalStats.totalListeners)}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <Headphones className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Creators</p>
                <p className="text-2xl font-bold text-gray-900">{formatNumber(globalStats.totalCreators)}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <Mic2 className="w-6 h-6 text-[#309605]" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Play Count</p>
                <p className="text-2xl font-bold text-gray-900">{formatNumber(globalStats.totalPlayCount)}</p>
              </div>
              <div className="w-12 h-12 bg-[#309605] bg-opacity-20 rounded-lg flex items-center justify-center">
                <Play className="w-6 h-6 text-[#309605]" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total View Count</p>
                <p className="text-2xl font-bold text-gray-900">{formatNumber(globalStats.totalViewCount)}</p>
              </div>
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <Eye className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Active Countries</p>
                <p className="text-2xl font-bold text-gray-900">{formatNumber(globalStats.activeCountries)}</p>
              </div>
              <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center">
                <Globe className="w-6 h-6 text-indigo-600" />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Countries by Plays</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topCountriesByPlays}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="country_name" angle={-45} textAnchor="end" height={100} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="total_plays" fill="#309605" name="Plays" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Countries by Views</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topCountriesByViews}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="country_name" angle={-45} textAnchor="end" height={100} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="total_views" fill="#f59e0b" name="Views" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Gender Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={genderDataForChart}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {genderDataForChart.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue by Country</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topCountriesByRevenue}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="country_name" angle={-45} textAnchor="end" height={100} />
              <YAxis />
              <Tooltip formatter={(value) => formatCurrency(value as number)} />
              <Legend />
              <Bar dataKey="total_revenue" fill="#10b981" name="Revenue" />
              <Bar dataKey="avg_artist_earnings" fill="#3b82f6" name="Avg Artist" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Country Overview</h3>

          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" size={18} />
              <input
                type="text"
                placeholder="Search country..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
              />
            </div>

            <select
              value={userTypeFilter}
              onChange={(e) => setUserTypeFilter(e.target.value)}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
            >
              <option value="all">All User Types</option>
              <option value="listeners">Listeners</option>
              <option value="creators">Creators</option>
            </select>

            <select
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value)}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
            >
              <option value="all">All Genders</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
            >
              <option value="total_users">Total Users</option>
              <option value="listener_count">Listeners</option>
              <option value="creator_count">Creators</option>
              <option value="total_plays">Plays</option>
              <option value="total_views">Views</option>
              <option value="total_revenue">Revenue</option>
            </select>

            <button
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#309605]"
            >
              {sortOrder === 'desc' ? '↓' : '↑'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="p-4 text-sm font-medium text-gray-700">Country</th>
                <th className="p-4 text-sm font-medium text-gray-700">Total Users</th>
                <th className="p-4 text-sm font-medium text-gray-700">Listeners</th>
                <th className="p-4 text-sm font-medium text-gray-700">Creators</th>
                <th className="p-4 text-sm font-medium text-gray-700">Gender (M/F/O)</th>
                <th className="p-4 text-sm font-medium text-gray-700">Plays</th>
                <th className="p-4 text-sm font-medium text-gray-700">Views</th>
                <th className="p-4 text-sm font-medium text-gray-700">Revenue</th>
                <th className="p-4 text-sm font-medium text-gray-700">Avg Artist</th>
                <th className="p-4 text-sm font-medium text-gray-700">Rewards</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-gray-500">
                    No data available
                  </td>
                </tr>
              ) : (
                filteredData.map((country, index) => (
                  <tr key={index} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="p-4 font-medium text-gray-900">{country.country_name}</td>
                    <td className="p-4 text-gray-700">{formatNumber(country.total_users)}</td>
                    <td className="p-4 text-gray-700">{formatNumber(country.listener_count)}</td>
                    <td className="p-4 text-gray-700">{formatNumber(country.creator_count)}</td>
                    <td className="p-4 text-gray-700">
                      {country.male_count} / {country.female_count} / {country.other_count}
                    </td>
                    <td className="p-4 text-gray-700">{formatNumber(country.total_plays)}</td>
                    <td className="p-4 text-gray-700">{formatNumber(country.total_views)}</td>
                    <td className="p-4 text-gray-700">{formatCurrency(country.total_revenue)}</td>
                    <td className="p-4 text-gray-700">{formatCurrency(country.avg_artist_earnings)}</td>
                    <td className="p-4 text-gray-700">{formatCurrency(country.listener_rewards)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
