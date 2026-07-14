import { useState, useEffect } from 'react';
import { Search, Eye, Trash2, CheckCircle, XCircle, AlertTriangle, Music, Video, Album, Zap, Play, BarChart3, List, ArrowLeft, User, Layers, Pencil, Upload } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ContentOverviewSection } from './ContentOverviewSection';
import { LoadingLogo } from '../../components/LoadingLogo';
import { EditContentModal } from '../../components/EditContentModal';
import { AdminUserContentUploadModal } from '../../components/admin/AdminUserContentUploadModal';

export const ContentManagementSection = (): JSX.Element => {
  const [activeTab, setActiveTab] = useState<'overview' | 'manage'>('overview');
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [content, setContent] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [contentTypeFilter, setContentTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [editingContent, setEditingContent] = useState<any | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const itemsPerPage = 10;

  useEffect(() => {
    if (selectedUser) {
      fetchUserContent(selectedUser.id);
    } else {
      fetchUsers();
    }
  }, [currentPage, contentTypeFilter, statusFilter, selectedUser]);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      const { data: usersData, count, error } = await supabase
        .from('users')
        .select(`
          id,
          display_name,
          email,
          avatar_url,
          created_at,
          content_uploads(count)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const usersWithStats = await Promise.all(
        (usersData || []).map(async (user) => {
          const { count: totalUploads } = await supabase
            .from('content_uploads')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

          // Get play counts from content_uploads (videos, clips, albums)
          // Note: Singles are NOT in content_uploads - they are ONLY in the songs table
          const { data: contentPlayData } = await supabase
            .from('content_uploads')
            .select('play_count')
            .eq('user_id', user.id);

          const contentPlays = contentPlayData?.reduce((sum, item) => sum + (item.play_count || 0), 0) || 0;

          // Get play counts from songs table (join through artist_profiles)
          const { data: artistProfile } = await supabase
            .from('artist_profiles')
            .select('artist_id')
            .eq('user_id', user.id)
            .single();

          let songPlays = 0;
          if (artistProfile) {
            const { data: songPlayData } = await supabase
              .from('songs')
              .select('play_count')
              .eq('artist_id', artistProfile.artist_id);

            songPlays = songPlayData?.reduce((sum, item) => sum + (item.play_count || 0), 0) || 0;
          }

          // Total plays = content_uploads play_count + songs play_count
          const totalPlays = contentPlays + songPlays;

          return {
            ...user,
            totalUploads: totalUploads || 0,
            totalPlays
          };
        })
      );

      setUsers(usersWithStats);
      setTotalItems(count || 0);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Failed to load users. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUserContent = async (userId: string) => {
    try {
      setIsLoading(true);
      setError(null);
      console.log('Fetching content for user:', userId);

      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      // Initialize content arrays
      let allContent: any[] = [];
      let totalCount = 0;

      // Fetch from content_uploads (videos, albums, short_clips, singles)
      console.log('Fetching content_uploads for user:', userId);
      let contentQuery = supabase
        .from('content_uploads')
        .select('*', { count: 'exact' })
        .eq('user_id', userId);

      // Apply content type filter if not 'all'
      if (contentTypeFilter !== 'all') {
        contentQuery = contentQuery.eq('content_type', contentTypeFilter);
      }

      if (statusFilter !== 'all') {
        contentQuery = contentQuery.eq('status', statusFilter);
      }

      // Fetch content
      const { data: contentData, count: contentCount, error: contentError } = await contentQuery
        .order('created_at', { ascending: false });

      if (contentError) {
        console.error('Error fetching content_uploads:', contentError);
      } else {
        console.log('Content_uploads found:', contentCount);
      }

      // For singles in content_uploads, fetch play_count from songs table
      const enrichedContent = await Promise.all(
        (contentData || []).map(async (item) => {
          if (item.content_type === 'single' && item.metadata?.song_id) {
            // Fetch the actual play count from songs table
            const { data: songData, error: songError } = await supabase
              .from('songs')
              .select('play_count')
              .eq('id', item.metadata.song_id)
              .maybeSingle();

            if (!songError && songData) {
              return {
                ...item,
                play_count: songData.play_count || 0
              };
            }
          }
          return item;
        })
      );

      allContent = [...allContent, ...enrichedContent];
      totalCount += contentCount || 0;

      // Sort all content by date
      allContent.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      console.log('Total content found:', totalCount);
      console.log('All content before pagination:', allContent.length);

      // Apply pagination
      const paginatedContent = allContent.slice(from, to + 1);

      console.log('Paginated content:', paginatedContent.length);
      console.log('Content data:', paginatedContent);

      setContent(paginatedContent);
      setTotalItems(totalCount);
    } catch (err) {
      console.error('Error fetching user content:', err);
      setError('Failed to load content. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      if (selectedUser) {
        fetchUserContent(selectedUser.id);
      } else {
        fetchUsers();
      }
      return;
    }

    if (selectedUser) {
      const filteredContent = content.filter(item =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
      setContent(filteredContent);
    } else {
      const filteredUsers = users.filter(user =>
        (user.display_name && user.display_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setUsers(filteredUsers);
    }
  };

  const handleSelectUser = (user: any) => {
    setSelectedUser(user);
    setCurrentPage(1);
    setContentTypeFilter('all');
    setStatusFilter('all');
  };

  const handleBackToUsers = () => {
    setSelectedUser(null);
    setCurrentPage(1);
    setContentTypeFilter('all');
    setStatusFilter('all');
  };

  const handleDeleteContent = async (contentId: string, contentType: string) => {
    if (isDeleting) return;

    if (!confirm('Are you sure you want to delete this content? This action cannot be undone.')) {
      return;
    }

    try {
      setIsDeleting(contentId);

      // For singles, we need to get the song_id from metadata and delete from songs table
      // The content_uploads cascade will handle the rest
      if (contentType === 'single') {
        const contentItem = content.find(item => item.id === contentId);
        const songId = contentItem?.metadata?.song_id;

        if (songId) {
          // Delete the song - this will cascade to content_uploads
          const { error: songError } = await supabase
            .from('songs')
            .delete()
            .eq('id', songId);

          if (songError) {
            throw songError;
          }
        }

        // Also delete from content_uploads in case cascade didn't work
        const { error: contentError } = await supabase
          .from('content_uploads')
          .delete()
          .eq('id', contentId);

        if (contentError && contentError.code !== 'PGRST116') {
          // Ignore "no rows" error as cascade might have already deleted it
          throw contentError;
        }
      } else {
        // For other content types, delete directly from content_uploads
        const { error } = await supabase
          .from('content_uploads')
          .delete()
          .eq('id', contentId);

        if (error) {
          throw error;
        }
      }

      // Update local state
      setContent(content.filter(item => item.id !== contentId));
      setTotalItems(prev => prev - 1);
    } catch (err) {
      console.error('Error deleting content:', err);
      alert(`Failed to delete content: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(null);
    }
  };

  const handleUpdateStatus = async (contentId: string, newStatus: string, contentType: string) => {
    if (isUpdatingStatus) return;

    try {
      setIsUpdatingStatus(contentId);

      if (contentType === 'single') {
        // For singles, update both the song and content_upload
        const contentItem = content.find(item => item.id === contentId);
        const songId = contentItem?.metadata?.song_id;

        if (songId) {
          // Update the song status
          const { error: songError } = await supabase
            .from('songs')
            .update({ status: newStatus })
            .eq('id', songId);

          if (songError) {
            throw songError;
          }
        }

        // Update content_upload status
        const { error: contentError } = await supabase
          .from('content_uploads')
          .update({ status: newStatus })
          .eq('id', contentId);

        if (contentError) {
          throw contentError;
        }
      } else {
        // For other content types, update content_uploads
        const { error } = await supabase
          .from('content_uploads')
          .update({ status: newStatus })
          .eq('id', contentId);

        if (error) {
          throw error;
        }
      }

      // Update local state
      setContent(content.map(item =>
        item.id === contentId ? { ...item, status: newStatus } : item
      ));
    } catch (err) {
      console.error('Error updating content status:', err);
      alert(`Failed to update content status: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsUpdatingStatus(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getContentIcon = (contentType: string) => {
    switch (contentType) {
      case 'single':
        return <Music className="w-5 h-5 text-blue-600" />;
      case 'album':
        return <Album className="w-5 h-5 text-[#309605]" />;
      case 'video':
        return <Video className="w-5 h-5 text-pink-600" />;
      case 'short_clip':
        return <Zap className="w-5 h-5 text-yellow-600" />;
      default:
        return <Music className="w-5 h-5 text-gray-600" />;
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'pending':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'rejected':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const formatContentType = (type: string): string => {
    switch (type) {
      case 'single':
        return 'Single';
      case 'album':
        return 'Album';
      case 'video':
        return 'Video';
      case 'short_clip':
        return 'Short Clip';
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  const formatPlayCount = (count: number): string => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  const totalPages = Math.ceil(totalItems / itemsPerPage);

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {selectedUser ? (
            <button onClick={handleBackToUsers} className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center flex-shrink-0 transition-colors" title="Back to Users">
              <ArrowLeft className="w-4 h-4 text-gray-600" />
            </button>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <Layers className="w-4 h-4 text-green-600" />
            </div>
          )}
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">
              {selectedUser ? `${selectedUser.display_name || 'User'}'s Content` : 'Content Management'}
            </h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {selectedUser ? `${totalItems} total items` : `Manage creator content across the platform`}
            </p>
          </div>
        </div>
        {!selectedUser && (
          <div className="flex-shrink-0 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">
            <span className="text-xs font-medium text-gray-500">{totalItems} creators</span>
          </div>
        )}
        {selectedUser && (
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex-shrink-0 px-3 py-1.5 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg transition-colors text-xs font-medium inline-flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Content
          </button>
        )}
      </div>

      <div className="border-b border-gray-100">
        <nav className="flex gap-1">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'overview' ? 'border-[#309605] text-[#309605]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Overview
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'manage' ? 'border-[#309605] text-[#309605]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <List className="w-4 h-4" />
            Manage Content
          </button>
        </nav>
      </div>

      {activeTab === 'overview' ? (
        <ContentOverviewSection />
      ) : (

      <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder={selectedUser ? "Search content..." : "Search creators..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
          />
        </div>

        {selectedUser && (
          <>
            <select
              value={contentTypeFilter}
              onChange={(e) => setContentTypeFilter(e.target.value)}
              className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#309605]"
            >
              <option value="all">All Types</option>
              <option value="single">Singles</option>
              <option value="album">Albums</option>
              <option value="video">Videos</option>
              <option value="short_clip">Short Clips</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#309605]"
            >
              <option value="all">All Status</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
          </>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-3 py-10 justify-center">
          <LoadingLogo variant="pulse" size={24} />
          <p className="text-sm text-gray-500">Loading content...</p>
        </div>
      ) : error ? (
        <div className="p-5 bg-red-50 border border-red-100 rounded-xl text-center">
          <AlertTriangle className="w-7 h-7 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={selectedUser ? () => fetchUserContent(selectedUser.id) : fetchUsers} className="mt-3 px-3 py-1.5 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded-lg">Try Again</button>
        </div>
      ) : !selectedUser && users.length === 0 ? (
        <div className="p-8 bg-white rounded-xl border border-gray-100 text-center">
          <p className="text-sm text-gray-500">No creators found</p>
        </div>
      ) : selectedUser && content.length === 0 ? (
        <div className="p-8 bg-white rounded-xl border border-gray-100 text-center">
          <p className="text-sm text-gray-500">No content found</p>
        </div>
      ) : !selectedUser ? (
        <div className="overflow-x-auto bg-white rounded-xl border border-gray-100 shadow-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Creator</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Content</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Plays</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Joined</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {user.avatar_url ? (
                          <img src={user.avatar_url} alt={user.display_name || 'User'} className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                      <span className="text-sm font-medium text-gray-900">{user.display_name || 'Unnamed User'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{user.totalUploads}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-sm text-gray-700">
                      <Play className="w-3.5 h-3.5 text-gray-400" />
                      <span>{formatPlayCount(user.totalPlays)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(user.created_at)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleSelectUser(user)}
                      className="px-2.5 py-1.5 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg transition-colors text-xs font-medium"
                    >
                      View Content
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border border-gray-100 shadow-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Content</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Plays/Views</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Uploaded</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {content.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {item.metadata?.cover_url || item.metadata?.thumbnail_url ? (
                          <img src={item.metadata?.cover_url || item.metadata?.thumbnail_url} alt={item.title} className="w-full h-full object-cover" />
                        ) : (
                          getContentIcon(item.content_type)
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900 line-clamp-1">{item.title}</div>
                        {item.description && <div className="text-xs text-gray-500 line-clamp-1">{item.description}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {getContentIcon(item.content_type)}
                      <span className="text-sm text-gray-700">{formatContentType(item.content_type)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${getStatusBadgeClass(item.status)}`}>{item.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-sm text-gray-700">
                      <Play className="w-3.5 h-3.5 text-gray-400" />
                      <span>{formatPlayCount(item.play_count || 0)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(item.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <button onClick={() => setEditingContent(item)} className="p-1.5 bg-gray-50 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors" title="Edit content">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => window.open(item.metadata?.file_url || item.metadata?.audio_url || item.metadata?.video_url, '_blank')} disabled={!item.metadata?.file_url && !item.metadata?.audio_url && !item.metadata?.video_url} className="p-1.5 bg-blue-50 rounded-lg hover:bg-blue-100 text-blue-600 disabled:opacity-50 transition-colors" title="View Content">
                        <Eye size={14} />
                      </button>
                      {item.status !== 'approved' && (
                        <button onClick={() => handleUpdateStatus(item.id, 'approved', item.content_type)} disabled={isUpdatingStatus === item.id} className="p-1.5 bg-green-50 rounded-lg hover:bg-green-100 text-green-600 disabled:opacity-50 transition-colors" title="Approve">
                          <CheckCircle size={14} />
                        </button>
                      )}
                      {item.status !== 'rejected' && (
                        <button onClick={() => handleUpdateStatus(item.id, 'rejected', item.content_type)} disabled={isUpdatingStatus === item.id} className="p-1.5 bg-red-50 rounded-lg hover:bg-red-100 text-red-500 disabled:opacity-50 transition-colors" title="Reject">
                          <XCircle size={14} />
                        </button>
                      )}
                      <button onClick={() => handleDeleteContent(item.id, item.content_type)} disabled={isDeleting === item.id} className="p-1.5 bg-red-50 rounded-lg hover:bg-red-100 text-red-500 disabled:opacity-50 transition-colors" title="Delete">
                        {isDeleting === item.id ? <LoadingLogo variant="pulse" size={14} /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Showing {((currentPage - 1) * itemsPerPage) + 1}–{Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems}
          </p>
          <div className="flex gap-1">
            <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-600 disabled:opacity-50 hover:bg-gray-50 transition-colors">Previous</button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum = i + 1;
              if (totalPages > 5) { if (currentPage > 3) { pageNum = currentPage - 3 + i; } if (pageNum > totalPages) { pageNum = totalPages - (4 - i); } }
              return (
                <button key={pageNum} onClick={() => setCurrentPage(pageNum)} className={`w-7 h-7 text-xs rounded-lg ${currentPage === pageNum ? 'bg-[#309605] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {pageNum}
                </button>
              );
            })}
            <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages} className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-600 disabled:opacity-50 hover:bg-gray-50 transition-colors">Next</button>
          </div>
        </div>
      )}
      </div>
      )}

      {editingContent && selectedUser && (
        <EditContentModal
          upload={editingContent}
          targetUserId={selectedUser.id}
          theme="admin"
          onClose={() => setEditingContent(null)}
          onSuccess={() => {
            setEditingContent(null);
            fetchUserContent(selectedUser.id);
          }}
        />
      )}

      {showUploadModal && selectedUser && (
        <AdminUserContentUploadModal
          user={selectedUser}
          onClose={() => setShowUploadModal(false)}
          onSuccess={() => fetchUserContent(selectedUser.id)}
        />
      )}
    </div>
  );
};