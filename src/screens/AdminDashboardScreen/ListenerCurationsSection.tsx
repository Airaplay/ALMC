import { useState, useEffect } from 'react';
import { Music, TrendingUp, DollarSign, Eye, EyeOff, Star, Ban, Check, X, Clock, Search, ListMusic, User, Play, Settings, RefreshCw, AlertCircle, Award, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAlert } from '../../contexts/AlertContext';
import { formatDistanceToNow } from 'date-fns';

interface CuratorSettings {
  global_enabled: boolean;
  min_songs: number;
  min_song_plays: number;
  revenue_percentage: number;
  monetization_enabled: boolean;
}

interface TopPlaylist {
  playlist_id: string;
  playlist_title: string;
  curator_id: string;
  curator_name: string;
  total_plays: number;
  unique_listeners: number;
  total_earnings: number;
  avg_session_duration: number;
  engagement_score: number;
  curation_status: string;
  is_featured: boolean;
  is_monetization_blocked: boolean;
  song_count: number;
  created_at: string;
}

interface PendingPlaylist {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  song_count: number;
  play_count: number;
  curation_status: 'none' | 'pending' | 'approved' | 'rejected';
  user_id: string;
  curator_name: string | null;
  curator_avatar: string | null;
  curator_email: string | null;
  created_at: string;
}

export function ListenerCurationsSection() {
  const { showAlert } = useAlert();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'analytics' | 'settings'>('pending');

  const [settings, setSettings] = useState<CuratorSettings>({
    global_enabled: true,
    min_songs: 10,
    min_song_plays: 0,
    revenue_percentage: 5,
    monetization_enabled: true
  });
  const [tempSettings, setTempSettings] = useState<CuratorSettings>(settings);
  const [editingSettings, setEditingSettings] = useState(false);

  const [pendingPlaylists, setPendingPlaylists] = useState<PendingPlaylist[]>([]);
  const [filteredPending, setFilteredPending] = useState<PendingPlaylist[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [topPlaylists, setTopPlaylists] = useState<TopPlaylist[]>([]);
  const [sortBy, setSortBy] = useState<'plays' | 'earnings' | 'engagement'>('plays');

  const [showSongsModal, setShowSongsModal] = useState(false);
  const [playlistSongs, setPlaylistSongs] = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0
  });

  useEffect(() => {
    loadSettings();
    loadPendingPlaylists();
    loadTopPlaylists();
  }, []);

  useEffect(() => {
    filterPendingPlaylists();
  }, [pendingPlaylists, statusFilter, searchQuery]);

  useEffect(() => {
    if (activeTab === 'analytics') {
      loadTopPlaylists();
    }
  }, [sortBy, activeTab]);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('curator_settings')
        .select('setting_key, setting_value');

      if (error) throw error;

      const settingsMap: Record<string, any> = {};
      data?.forEach((item) => {
        settingsMap[item.setting_key] = item.setting_value;
      });

      const loadedSettings = {
        global_enabled: settingsMap.curator_global_status?.enabled ?? true,
        min_songs: settingsMap.curator_eligibility?.min_songs ?? 10,
        min_song_plays: settingsMap.curator_eligibility?.min_song_plays ?? 0,
        revenue_percentage: settingsMap.curator_revenue_split?.percentage ?? 5,
        monetization_enabled: settingsMap.curator_revenue_split?.enabled ?? true
      };

      setSettings(loadedSettings);
      setTempSettings(loadedSettings);
    } catch (error) {
      console.error('Error loading curator settings:', error);
      showAlert('Failed to load curator settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadPendingPlaylists = async () => {
    try {
      const { data, error } = await supabase
        .from('playlists')
        .select(`
          *,
          curator:user_id (
            id,
            display_name,
            avatar_url,
            email
          )
        `)
        .eq('is_public', true)
        .in('curation_status', ['pending', 'approved', 'rejected'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formatted = (data || []).map((p: any) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        cover_image_url: p.cover_image_url,
        song_count: p.song_count || 0,
        play_count: p.play_count || 0,
        curation_status: p.curation_status,
        user_id: p.user_id,
        curator_name: p.curator?.display_name || null,
        curator_avatar: p.curator?.avatar_url || null,
        curator_email: p.curator?.email || null,
        created_at: p.created_at
      }));

      setPendingPlaylists(formatted);

      setStats({
        total: formatted.length,
        pending: formatted.filter(p => p.curation_status === 'pending').length,
        approved: formatted.filter(p => p.curation_status === 'approved').length,
        rejected: formatted.filter(p => p.curation_status === 'rejected').length
      });
    } catch (error) {
      console.error('Error loading pending playlists:', error);
      showAlert('Failed to load pending playlists', 'error');
    }
  };

  const filterPendingPlaylists = () => {
    let filtered = [...pendingPlaylists];

    if (statusFilter !== 'all') {
      filtered = filtered.filter(p => p.curation_status === statusFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(query) ||
        (p.curator_name && p.curator_name.toLowerCase().includes(query)) ||
        (p.curator_email && p.curator_email.toLowerCase().includes(query))
      );
    }

    setFilteredPending(filtered);
  };

  const loadTopPlaylists = async () => {
    try {
      const { data, error } = await supabase.rpc('admin_get_top_curated_playlists', {
        p_sort_by: sortBy,
        p_limit: 50
      });

      if (error) throw error;
      setTopPlaylists(data || []);
    } catch (error) {
      console.error('Error loading top playlists:', error);
      showAlert('Failed to load playlists', 'error');
    }
  };

  const saveSettings = async () => {
    try {
      setLoading(true);

      const updates = [
        {
          setting_key: 'curator_global_status',
          setting_value: {
            enabled: tempSettings.global_enabled,
            description: 'Global enable/disable for Listener Curations system'
          }
        },
        {
          setting_key: 'curator_eligibility',
          setting_value: {
            min_songs: tempSettings.min_songs,
            min_song_plays: tempSettings.min_song_plays,
            description: 'Minimum requirements for playlist curation eligibility'
          }
        },
        {
          setting_key: 'curator_revenue_split',
          setting_value: {
            enabled: tempSettings.monetization_enabled,
            percentage: tempSettings.revenue_percentage,
            description: 'Percentage of community pool shared with curators'
          }
        }
      ];

      for (const update of updates) {
        const { error } = await supabase
          .from('curator_settings')
          .upsert({
            setting_key: update.setting_key,
            setting_value: update.setting_value,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'setting_key'
          });

        if (error) throw error;
      }

      setSettings(tempSettings);
      setEditingSettings(false);
      showAlert('Settings updated successfully', 'success');
    } catch (error) {
      console.error('Error saving settings:', error);
      showAlert('Failed to save settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (playlistId: string) => {
    try {
      setActionLoading(true);
      const { data, error } = await supabase.rpc('admin_review_playlist_curation', {
        playlist_uuid: playlistId,
        approval_status: 'approved',
        featured_pos: null
      });

      if (error) throw error;

      if (data?.success) {
        showAlert('Playlist approved successfully', 'success');
        await loadPendingPlaylists();
      } else {
        showAlert(data?.message || 'Failed to approve playlist', 'error');
      }
    } catch (error: any) {
      console.error('Error approving playlist:', error);
      showAlert('Error approving playlist', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (playlistId: string) => {
    try {
      setActionLoading(true);
      const { data, error } = await supabase.rpc('admin_review_playlist_curation', {
        playlist_uuid: playlistId,
        approval_status: 'rejected'
      });

      if (error) throw error;

      if (data?.success) {
        showAlert('Playlist rejected', 'success');
        await loadPendingPlaylists();
      } else {
        showAlert(data?.message || 'Failed to reject playlist', 'error');
      }
    } catch (error: any) {
      console.error('Error rejecting playlist:', error);
      showAlert('Error rejecting playlist', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const toggleFeature = async (playlistId: string, currentlyFeatured: boolean) => {
    try {
      const { data, error } = await supabase.rpc('admin_feature_playlist', {
        p_playlist_id: playlistId,
        p_action: currentlyFeatured ? 'unfeature' : 'feature',
        p_admin_notes: currentlyFeatured ? 'Unfeatured by admin' : 'Featured by admin',
        p_featured_order: 0
      });

      if (error) throw error;

      if (data.success) {
        showAlert(data.message, 'success');
        loadTopPlaylists();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (error) {
      console.error('Error toggling feature:', error);
      showAlert('Failed to toggle feature status', 'error');
    }
  };

  const toggleMonetization = async (type: 'playlist' | 'user', targetId: string, currentlyBlocked: boolean) => {
    try {
      const { data, error } = await supabase.rpc('admin_block_curator_monetization', {
        p_block_type: type,
        p_target_id: targetId,
        p_action: currentlyBlocked ? 'unblock' : 'block',
        p_block_reason: currentlyBlocked ? null : 'Blocked by admin'
      });

      if (error) throw error;

      if (data.success) {
        showAlert(data.message, 'success');
        loadTopPlaylists();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (error) {
      console.error('Error toggling monetization:', error);
      showAlert('Failed to toggle monetization', 'error');
    }
  };

  const viewPlaylistSongs = async (playlistId: string) => {
    try {
      const { data, error } = await supabase
        .from('playlist_songs')
        .select(`
          added_at,
          song:song_id (
            id,
            title,
            duration_seconds,
            cover_image_url,
            artist:artist_id (
              name
            )
          )
        `)
        .eq('playlist_id', playlistId)
        .order('added_at', { ascending: true });

      if (error) throw error;

      const formattedSongs = (data || []).map((item: any) => ({
        id: item.song?.id,
        title: item.song?.title || 'Unknown',
        artist_name: item.song?.artist?.name || 'Unknown',
        duration_seconds: item.song?.duration_seconds || 0,
        cover_image_url: item.song?.cover_image_url,
        added_at: item.added_at
      }));

      setPlaylistSongs(formattedSongs);
      setShowSongsModal(true);
    } catch (error) {
      console.error('Error fetching playlist songs:', error);
      showAlert('Failed to load playlist songs', 'error');
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading && pendingPlaylists.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#309605] border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading curator data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
            <Music className="w-4 h-4 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Listener Curations</h2>
            <p className="text-sm text-gray-400 mt-0.5">Manage listener-curated playlists and their visibility</p>
          </div>
        </div>
        <div>
          <button
            onClick={() => {
              loadSettings();
              loadPendingPlaylists();
              loadTopPlaylists();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="bg-[#1a1a1a] rounded-xl border border-gray-800 p-1 flex gap-1">
        <button
          onClick={() => setActiveTab('pending')}
          className={`flex-1 px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
            activeTab === 'pending'
              ? 'bg-[#309605] text-white shadow-lg shadow-[#309605]/20'
              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
          }`}
        >
          <Clock className="w-4 h-4" />
          Pending Reviews
          {stats.pending > 0 && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              activeTab === 'pending' ? 'bg-white/20' : 'bg-yellow-500/20 text-yellow-500'
            }`}>
              {stats.pending}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex-1 px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
            activeTab === 'analytics'
              ? 'bg-[#309605] text-white shadow-lg shadow-[#309605]/20'
              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          Analytics
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex-1 px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
            activeTab === 'settings'
              ? 'bg-[#309605] text-white shadow-lg shadow-[#309605]/20'
              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
          }`}
        >
          <Settings className="w-4 h-4" />
          Settings
        </button>
      </div>

      {/* Pending Reviews Tab */}
      {activeTab === 'pending' && (
        <div className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 border border-blue-500/20 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <ListMusic className="w-6 h-6 text-blue-400" />
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-white">{stats.total}</p>
                  <p className="text-blue-300 text-sm font-medium">Total</p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-yellow-500/10 to-yellow-600/10 border border-yellow-500/20 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-12 h-12 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-yellow-400" />
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-white">{stats.pending}</p>
                  <p className="text-yellow-300 text-sm font-medium">Pending</p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-green-500/10 to-green-600/10 border border-green-500/20 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <Check className="w-6 h-6 text-green-400" />
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-white">{stats.approved}</p>
                  <p className="text-green-300 text-sm font-medium">Approved</p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-red-500/10 to-red-600/10 border border-red-500/20 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center">
                  <X className="w-6 h-6 text-red-400" />
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-white">{stats.rejected}</p>
                  <p className="text-red-300 text-sm font-medium">Rejected</p>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search by playlist name, curator..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-12 pl-12 pr-4 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#309605] focus:ring-2 focus:ring-[#309605]/20 transition-all"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-5 h-12 rounded-lg font-medium transition-all ${
                    statusFilter === 'all'
                      ? 'bg-[#309605] text-white shadow-lg shadow-[#309605]/20'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setStatusFilter('pending')}
                  className={`px-5 h-12 rounded-lg font-medium transition-all ${
                    statusFilter === 'pending'
                      ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/20'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
                  }`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setStatusFilter('approved')}
                  className={`px-5 h-12 rounded-lg font-medium transition-all ${
                    statusFilter === 'approved'
                      ? 'bg-green-500 text-white shadow-lg shadow-green-500/20'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
                  }`}
                >
                  Approved
                </button>
                <button
                  onClick={() => setStatusFilter('rejected')}
                  className={`px-5 h-12 rounded-lg font-medium transition-all ${
                    statusFilter === 'rejected'
                      ? 'bg-red-500 text-white shadow-lg shadow-red-500/20'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
                  }`}
                >
                  Rejected
                </button>
              </div>
            </div>
          </div>

          {/* Playlists Table */}
          <div className="bg-[#1a1a1a] rounded-xl overflow-hidden border border-gray-800">
            {filteredPending.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-4">
                  <ListMusic className="w-8 h-8 text-gray-600" />
                </div>
                <p className="text-gray-400 text-lg font-medium">No playlists found</p>
                <p className="text-gray-500 text-sm mt-1">Try adjusting your filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-900/50 border-b border-gray-800">
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Playlist</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Curator</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Songs</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Plays</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Submitted</th>
                      <th className="px-6 py-4 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {filteredPending.map((playlist) => (
                      <tr key={playlist.id} className="hover:bg-gray-900/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-lg overflow-hidden bg-gray-900 flex-shrink-0 ring-1 ring-gray-800 group-hover:ring-gray-700 transition-all">
                              {playlist.cover_image_url ? (
                                <img src={playlist.cover_image_url} alt={playlist.title} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <ListMusic className="w-6 h-6 text-gray-600" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 max-w-xs">
                              <p className="text-sm font-semibold text-white truncate">{playlist.title}</p>
                              {playlist.description && (
                                <p className="text-xs text-gray-400 truncate mt-0.5">{playlist.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            {playlist.curator_avatar ? (
                              <img src={playlist.curator_avatar} alt={playlist.curator_name || ''} className="w-9 h-9 rounded-full ring-2 ring-gray-800" />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-gray-900 flex items-center justify-center ring-2 ring-gray-800">
                                <User className="w-4 h-4 text-gray-600" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white truncate">{playlist.curator_name || 'Unknown'}</p>
                              <p className="text-xs text-gray-500 truncate">{playlist.curator_email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-medium text-white">{playlist.song_count}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Play className="w-4 h-4 text-gray-500" />
                            <p className="text-sm font-medium text-white">{playlist.play_count.toLocaleString()}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                            playlist.curation_status === 'pending' ? 'bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/30' :
                            playlist.curation_status === 'approved' ? 'bg-green-500/20 text-green-400 ring-1 ring-green-500/30' :
                            'bg-red-500/20 text-red-400 ring-1 ring-red-500/30'
                          }`}>
                            {playlist.curation_status.charAt(0).toUpperCase() + playlist.curation_status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm text-gray-400">
                            {formatDistanceToNow(new Date(playlist.created_at), { addSuffix: true })}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => viewPlaylistSongs(playlist.id)}
                              className="p-2 hover:bg-gray-800 rounded-lg transition-colors group/btn"
                              title="View songs"
                            >
                              <Eye className="w-4 h-4 text-gray-400 group-hover/btn:text-[#309605]" />
                            </button>
                            {playlist.curation_status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleApprove(playlist.id)}
                                  disabled={actionLoading}
                                  className="p-2 hover:bg-green-500/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed group/btn"
                                  title="Approve"
                                >
                                  <Check className="w-4 h-4 text-green-400 group-hover/btn:scale-110 transition-transform" />
                                </button>
                                <button
                                  onClick={() => handleReject(playlist.id)}
                                  disabled={actionLoading}
                                  className="p-2 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed group/btn"
                                  title="Reject"
                                >
                                  <X className="w-4 h-4 text-red-400 group-hover/btn:scale-110 transition-transform" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* Sort Controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#1a1a1a] border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#309605]/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-[#309605]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Top Performing Playlists</h3>
                <p className="text-sm text-gray-400">Analytics and performance metrics</p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSortBy('plays')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  sortBy === 'plays' ? 'bg-[#309605] text-white shadow-lg shadow-[#309605]/20' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                By Plays
              </button>
              <button
                onClick={() => setSortBy('earnings')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  sortBy === 'earnings' ? 'bg-[#309605] text-white shadow-lg shadow-[#309605]/20' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                By Earnings
              </button>
              <button
                onClick={() => setSortBy('engagement')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  sortBy === 'engagement' ? 'bg-[#309605] text-white shadow-lg shadow-[#309605]/20' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                By Engagement
              </button>
            </div>
          </div>

          {/* Playlists List */}
          <div className="space-y-3">
            {topPlaylists.length === 0 ? (
              <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-4">
                  <ListMusic className="w-8 h-8 text-gray-600" />
                </div>
                <p className="text-gray-400 text-lg font-medium">No curated playlists found</p>
                <p className="text-gray-500 text-sm mt-1">Approved playlists will appear here</p>
              </div>
            ) : (
              topPlaylists.map((playlist, index) => (
                <div key={playlist.playlist_id} className="bg-[#1a1a1a] border border-gray-800 hover:border-gray-700 rounded-xl p-5 transition-all group">
                  <div className="flex items-start gap-4">
                    {/* Rank Badge */}
                    <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-bold text-lg ${
                      index === 0 ? 'bg-gradient-to-br from-yellow-500 to-yellow-600 text-white shadow-lg shadow-yellow-500/20' :
                      index === 1 ? 'bg-gradient-to-br from-gray-400 to-gray-500 text-white shadow-lg shadow-gray-500/20' :
                      index === 2 ? 'bg-gradient-to-br from-orange-600 to-orange-700 text-white shadow-lg shadow-orange-600/20' :
                      'bg-gray-800 text-gray-400'
                    }`}>
                      #{index + 1}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h4 className="text-white font-semibold text-lg truncate">{playlist.playlist_title}</h4>
                            {playlist.is_featured && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-yellow-500/20 to-yellow-600/20 text-yellow-400 text-xs font-semibold rounded-lg ring-1 ring-yellow-500/30">
                                <Star className="w-3 h-3" />
                                Featured
                              </span>
                            )}
                            {playlist.is_monetization_blocked && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-500/20 text-red-400 text-xs font-semibold rounded-lg ring-1 ring-red-500/30">
                                <Ban className="w-3 h-3" />
                                Blocked
                              </span>
                            )}
                            <span className={`px-2 py-1 text-xs font-semibold rounded-lg ${
                              playlist.curation_status === 'approved' ? 'bg-green-500/20 text-green-400 ring-1 ring-green-500/30' :
                              playlist.curation_status === 'pending' ? 'bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/30' :
                              'bg-red-500/20 text-red-400 ring-1 ring-red-500/30'
                            }`}>
                              {playlist.curation_status}
                            </span>
                          </div>
                          <p className="text-sm text-gray-400">
                            Curator: <span className="text-gray-300 font-medium">{playlist.curator_name}</span> • <span className="text-gray-500">{playlist.song_count} songs</span>
                          </p>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() => toggleFeature(playlist.playlist_id, playlist.is_featured)}
                            className={`p-2.5 rounded-lg transition-all ${
                              playlist.is_featured
                                ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 ring-1 ring-yellow-500/30'
                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-yellow-400'
                            }`}
                            title={playlist.is_featured ? 'Unfeature playlist' : 'Feature playlist'}
                          >
                            <Star className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleMonetization('playlist', playlist.playlist_id, playlist.is_monetization_blocked)}
                            className={`p-2.5 rounded-lg transition-all ${
                              playlist.is_monetization_blocked
                                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 ring-1 ring-red-500/30'
                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-red-400'
                            }`}
                            title={playlist.is_monetization_blocked ? 'Unblock monetization' : 'Block monetization'}
                          >
                            {playlist.is_monetization_blocked ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Stats Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-4">
                        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
                          <div className="flex items-center gap-2 mb-1">
                            <Play className="w-3.5 h-3.5 text-gray-500" />
                            <p className="text-xs text-gray-500 font-medium">Total Plays</p>
                          </div>
                          <p className="text-lg font-bold text-white">{playlist.total_plays.toLocaleString()}</p>
                        </div>
                        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
                          <div className="flex items-center gap-2 mb-1">
                            <User className="w-3.5 h-3.5 text-gray-500" />
                            <p className="text-xs text-gray-500 font-medium">Listeners</p>
                          </div>
                          <p className="text-lg font-bold text-white">{playlist.unique_listeners.toLocaleString()}</p>
                        </div>
                        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
                          <div className="flex items-center gap-2 mb-1">
                            <DollarSign className="w-3.5 h-3.5 text-[#309605]" />
                            <p className="text-xs text-gray-500 font-medium">Earnings</p>
                          </div>
                          <p className="text-lg font-bold text-[#309605]">${playlist.total_earnings.toFixed(2)}</p>
                        </div>
                        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
                          <div className="flex items-center gap-2 mb-1">
                            <Clock className="w-3.5 h-3.5 text-gray-500" />
                            <p className="text-xs text-gray-500 font-medium">Avg Session</p>
                          </div>
                          <p className="text-lg font-bold text-white">{Math.floor(playlist.avg_session_duration / 60)}m</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            <div className="bg-gradient-to-br from-[#309605]/10 to-[#3ba208]/10 border border-[#309605]/20 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm font-medium mb-1">Total Playlists</p>
                  <p className="text-3xl font-bold text-white">{topPlaylists.length}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-[#309605]/20 flex items-center justify-center">
                  <Music className="w-6 h-6 text-[#309605]" />
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-yellow-500/10 to-yellow-600/10 border border-yellow-500/20 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm font-medium mb-1">Featured</p>
                  <p className="text-3xl font-bold text-white">{topPlaylists.filter(p => p.is_featured).length}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                  <Star className="w-6 h-6 text-yellow-400" />
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-green-500/10 to-green-600/10 border border-green-500/20 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm font-medium mb-1">Total Earnings</p>
                  <p className="text-2xl font-bold text-[#309605]">${topPlaylists.reduce((sum, p) => sum + p.total_earnings, 0).toFixed(2)}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-green-400" />
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-red-500/10 to-red-600/10 border border-red-500/20 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm font-medium mb-1">Blocked</p>
                  <p className="text-3xl font-bold text-white">{topPlaylists.filter(p => p.is_monetization_blocked).length}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center">
                  <Ban className="w-6 h-6 text-red-400" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between bg-[#1a1a1a] border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#309605]/20 flex items-center justify-center">
                <Settings className="w-5 h-5 text-[#309605]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Global Curator Settings</h3>
                <p className="text-sm text-gray-400">Configure system-wide curation parameters</p>
              </div>
            </div>
            {editingSettings ? (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setTempSettings(settings);
                    setEditingSettings(false);
                  }}
                  className="px-4 py-2 bg-gray-800 text-gray-300 hover:bg-gray-700 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveSettings}
                  className="px-4 py-2 bg-[#309605] text-white hover:bg-[#3ba208] rounded-lg font-medium shadow-lg shadow-[#309605]/20 transition-all"
                >
                  Save Changes
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingSettings(true)}
                className="px-4 py-2 bg-[#309605] text-white hover:bg-[#3ba208] rounded-lg font-medium shadow-lg shadow-[#309605]/20 transition-all"
              >
                Edit Settings
              </button>
            )}
          </div>

          {/* Settings Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {/* System Status */}
            <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-3 h-3 rounded-full ${tempSettings.global_enabled ? 'bg-green-500 shadow-lg shadow-green-500/50' : 'bg-red-500 shadow-lg shadow-red-500/50'}`} />
                <h4 className="text-white font-semibold">System Status</h4>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-800">
                <div>
                  <p className="text-sm font-medium text-white mb-1">Listener Curations</p>
                  <p className="text-xs text-gray-400">Enable or disable the entire system</p>
                </div>
                <button
                  onClick={() => editingSettings && setTempSettings({ ...tempSettings, global_enabled: !tempSettings.global_enabled })}
                  disabled={!editingSettings}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-all ${
                    tempSettings.global_enabled ? 'bg-[#309605]' : 'bg-gray-700'
                  } ${editingSettings ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                >
                  <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform shadow-lg ${
                    tempSettings.global_enabled ? 'translate-x-7' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>

            {/* Monetization Status */}
            <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-3 h-3 rounded-full ${tempSettings.monetization_enabled ? 'bg-green-500 shadow-lg shadow-green-500/50' : 'bg-red-500 shadow-lg shadow-red-500/50'}`} />
                <h4 className="text-white font-semibold">Monetization Status</h4>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-800">
                <div>
                  <p className="text-sm font-medium text-white mb-1">Curator Earnings</p>
                  <p className="text-xs text-gray-400">Enable or disable curator revenue sharing</p>
                </div>
                <button
                  onClick={() => editingSettings && setTempSettings({ ...tempSettings, monetization_enabled: !tempSettings.monetization_enabled })}
                  disabled={!editingSettings}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-all ${
                    tempSettings.monetization_enabled ? 'bg-[#309605]' : 'bg-gray-700'
                  } ${editingSettings ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                >
                  <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform shadow-lg ${
                    tempSettings.monetization_enabled ? 'translate-x-7' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>

            {/* Eligibility Requirements */}
            <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <AlertCircle className="w-4 h-4 text-blue-400" />
                </div>
                <h4 className="text-white font-semibold">Eligibility Requirements</h4>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Minimum Songs Required
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={tempSettings.min_songs}
                    onChange={(e) => editingSettings && setTempSettings({ ...tempSettings, min_songs: parseInt(e.target.value) || 10 })}
                    disabled={!editingSettings}
                    className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white font-medium focus:outline-none focus:border-[#309605] focus:ring-2 focus:ring-[#309605]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  />
                  <p className="text-xs text-gray-400 mt-2">
                    Minimum number of songs required in a playlist for eligibility
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Minimum Total Song Plays
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    value={tempSettings.min_song_plays}
                    onChange={(e) => editingSettings && setTempSettings({ ...tempSettings, min_song_plays: parseInt(e.target.value) || 0 })}
                    disabled={!editingSettings}
                    className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white font-medium focus:outline-none focus:border-[#309605] focus:ring-2 focus:ring-[#309605]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  />
                  <p className="text-xs text-gray-400 mt-2">
                    Minimum combined plays required for all songs in the playlist
                  </p>
                </div>
              </div>
            </div>

            {/* Revenue Configuration */}
            <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-[#309605]/20 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-[#309605]" />
                </div>
                <h4 className="text-white font-semibold">Revenue Configuration</h4>
              </div>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-300">
                    Curator Revenue Share
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={tempSettings.revenue_percentage}
                      onChange={(e) => editingSettings && setTempSettings({ ...tempSettings, revenue_percentage: parseInt(e.target.value) || 5 })}
                      disabled={!editingSettings}
                      className="w-16 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-center font-bold focus:outline-none focus:border-[#309605] focus:ring-2 focus:ring-[#309605]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    />
                    <span className="text-[#309605] font-bold">%</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  value={tempSettings.revenue_percentage}
                  onChange={(e) => editingSettings && setTempSettings({ ...tempSettings, revenue_percentage: parseInt(e.target.value) })}
                  disabled={!editingSettings}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mb-3"
                  style={{
                    background: editingSettings
                      ? `linear-gradient(to right, #00ad74 0%, #00ad74 ${tempSettings.revenue_percentage * 5}%, #374151 ${tempSettings.revenue_percentage * 5}%, #374151 100%)`
                      : '#374151'
                  }}
                />
                <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-800">
                  <p className="text-xs text-gray-400 mb-2">Revenue Split Breakdown:</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">Curator Share</span>
                      <span className="text-[#309605] font-bold">{tempSettings.revenue_percentage}%</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">Creator Share</span>
                      <span className="text-gray-300 font-semibold">{50}%</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">Listener Rewards</span>
                      <span className="text-gray-300 font-semibold">{10 - tempSettings.revenue_percentage}%</span>
                    </div>
                    <div className="flex items-center justify-between text-xs border-t border-gray-800 pt-1.5 mt-1.5">
                      <span className="text-gray-400">Platform</span>
                      <span className="text-gray-300 font-semibold">{40}%</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  Percentage of ad revenue allocated to playlist curators (0-20%)
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Songs Modal */}
      {showSongsModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#1a1a1a] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden border border-gray-800 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-800 bg-gray-900/50">
              <div>
                <h3 className="text-xl font-bold text-white">Playlist Songs</h3>
                <p className="text-sm text-gray-400 mt-0.5">{playlistSongs.length} tracks</p>
              </div>
              <button
                onClick={() => setShowSongsModal(false)}
                className="p-2 hover:bg-gray-800 rounded-lg transition-colors group"
              >
                <X className="w-5 h-5 text-gray-400 group-hover:text-white" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(85vh-100px)] custom-scrollbar">
              <div className="space-y-2">
                {playlistSongs.map((song, index) => (
                  <div key={song.id} className="flex items-center gap-4 p-3 bg-gray-900/50 hover:bg-gray-900 rounded-lg transition-colors group border border-gray-800 hover:border-gray-700">
                    <span className="text-sm font-semibold text-gray-500 w-8 text-center">{index + 1}</span>
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-800 flex-shrink-0 ring-1 ring-gray-700 group-hover:ring-gray-600 transition-all">
                      {song.cover_image_url ? (
                        <img src={song.cover_image_url} alt={song.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Music className="w-5 h-5 text-gray-600" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{song.title}</p>
                      <p className="text-xs text-gray-400 truncate">{song.artist_name}</p>
                    </div>
                    <span className="text-xs text-gray-500 font-medium">{formatDuration(song.duration_seconds)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
