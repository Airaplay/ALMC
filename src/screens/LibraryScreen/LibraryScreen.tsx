import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Video, Album, Play, Trash2, Plus, Search, Edit3, MoreVertical, Share2 } from 'lucide-react';
import { LazyImage } from '../../components/LazyImage';
import { AuthModal } from '../../components/AuthModal';
import { CreatePlaylistModal } from '../../components/CreatePlaylistModal';
import { EditContentModal } from '../../components/EditContentModal';
import { EditPlaylistModal } from '../../components/EditPlaylistModal';
import { BottomActionSheet } from '../../components/BottomActionSheet';
import { useConfirm } from '../../contexts/ConfirmContext';
import { supabase, getUserPlaylists, deleteContentUpload, deletePlaylist, recordShareEvent } from '../../lib/supabase';
import { shareSong, shareVideo, shareAlbum } from '../../lib/shareService';
import { persistentCache } from '../../lib/persistentCache';
import { useAuth } from '../../contexts/AuthContext';

interface LibraryScreenProps {
  onFormVisibilityChange?: (isVisible: boolean) => void;
  onOpenMusicPlayer?: (song: Song) => void;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  duration?: number;
  playCount?: number;
}

type TabType = 'uploads' | 'playlists';

const UPLOADS_CACHE_KEY = 'library_uploads_processed';
const PLAYLISTS_CACHE_KEY = 'library_playlists_processed';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const LibraryScreen = ({ onFormVisibilityChange, onOpenMusicPlayer }: LibraryScreenProps): JSX.Element => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { isAuthenticated: authIsAuthenticated, isInitialized } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('playlists');
  const [isLoading, setIsLoading] = useState(true);
  const [myUploads, setMyUploads] = useState<any[]>([]);
  const [myPlaylists, setMyPlaylists] = useState<any[]>([]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalDismissed, setAuthModalDismissed] = useState(false);
  const isInitialMount = useRef(true);
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] = useState(false);
  const [editingContent, setEditingContent] = useState<any>(null);
  const [editingPlaylist, setEditingPlaylist] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [contentFilter, setContentFilter] = useState('all');
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isCreator, setIsCreator] = useState(false);

  useEffect(() => {
    const isAnyModalOpen = showCreatePlaylistModal ||
                          !!editingContent ||
                          !!editingPlaylist;
    onFormVisibilityChange?.(isAnyModalOpen);
  }, [showCreatePlaylistModal, editingContent, editingPlaylist, onFormVisibilityChange]);

  useEffect(() => {
    // Only prevent non-creators from accessing the uploads tab
    if (!isCreator && activeTab === 'uploads') {
      setActiveTab('playlists');
    }
  }, [isCreator, activeTab]);

  // Auto-open auth modal for unauthenticated users (only if not dismissed)
  useEffect(() => {
    if (isInitialized && !authIsAuthenticated && !showAuthModal && !authModalDismissed) {
      setShowAuthModal(true);
    }
  }, [isInitialized, authIsAuthenticated]);

  // Load cached data on mount
  useEffect(() => {
    const loadCachedData = async () => {
      if (isInitialMount.current) {
        const [cachedUploads, cachedPlaylists] = await Promise.all([
          persistentCache.get<any[]>(UPLOADS_CACHE_KEY),
          persistentCache.get<any[]>(PLAYLISTS_CACHE_KEY)
        ]);

        if (cachedUploads && cachedUploads.length > 0) {
          setMyUploads(cachedUploads);
        }
        if (cachedPlaylists && cachedPlaylists.length > 0) {
          setMyPlaylists(cachedPlaylists);
        }
        isInitialMount.current = false;
      }
    };
    loadCachedData();
  }, []);

  useEffect(() => {
    checkAuthAndLoadData();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        checkAuthAndLoadData();
      } else if (event === 'SIGNED_OUT') {
        setIsCreator(false);
        setMyUploads([]);
        setMyPlaylists([]);
      }
    });

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && authIsAuthenticated) {
        console.log('🔄 Tab became visible - refreshing Library content');
        await persistentCache.delete(UPLOADS_CACHE_KEY);
        await loadUserContent();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authIsAuthenticated]);

  const checkAuthAndLoadData = async () => {
    try {
      setIsLoading(true);

      // Use enhanced session getter - users stay signed in until they log out
      const { getAuthenticatedSession } = await import('../../lib/supabase');
      const { session, error } = await getAuthenticatedSession();

      if (error && (error.message?.includes('Invalid Refresh Token') ||
                    error.message?.includes('refresh_token_not_found') ||
                    error.message === 'Auth session missing!')) {
        setMyUploads([]);
        setMyPlaylists([]);
        setIsLoading(false);
        return;
      }

      if (!session || !session.user) {
        setMyUploads([]);
        setMyPlaylists([]);
        setIsLoading(false);
        return;
      }

      // Check creator status first (fast, determines tab visibility)
      await checkIfUserIsCreator();

      // Then load content in parallel (slower, for display)
      Promise.all([
        loadUserContent(),
        loadUserPlaylists()
      ]).finally(() => {
        setIsLoading(false);
      });
    } catch (error) {
      console.error('Error checking auth:', error);
      // Don't immediately clear auth state - might be temporary network issue
      // Only clear if we're certain user is not signed in
      setIsLoading(false);
    }
  };

  const checkIfUserIsCreator = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log('❌ No session - not a creator');
        setIsCreator(false);
        return;
      }

      console.log('🔍 Checking creator status for user:', session.user.id);

      const { data, error } = await supabase
        .from('artist_profiles')
        .select('id, stage_name')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (error) {
        console.error('❌ Error checking creator status:', error);
        setIsCreator(false);
        return;
      }

      const hasProfile = !!data;
      setIsCreator(hasProfile);

      if (hasProfile) {
        console.log(`✅ User IS a creator: ${data.stage_name}`);
      } else {
        console.log('❌ User is NOT a creator (no artist_profile found)');
      }

    } catch (error) {
      console.error('❌ Error in checkIfUserIsCreator:', error);
      setIsCreator(false);
    }
  };

  const loadUserContent = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log('❌ No session - cannot load uploads');
        setMyUploads([]);
        return;
      }

      console.log('📥 Loading uploads for user:', session.user.id);

      const { data, error } = await supabase
        .from('content_uploads')
        .select(`
          *,
          artist_profiles!artist_profile_id (
            stage_name
          )
        `)
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Error loading content:', error);
        setMyUploads([]);
        return;
      }

      console.log(`✅ Loaded ${data?.length || 0} uploads from database`);
      if (data && data.length > 0) {
        console.log('Uploads:', data.map(u => `${u.content_type}: ${u.title}`));
      }

      // Set uploads immediately with play_count = 0 for fast initial render
      setMyUploads((data || []).map(upload => ({ ...upload, play_count: 0 })));

      // Enrich uploads with actual play counts in background (non-blocking)
      Promise.all(
        (data || []).map(async (upload) => {
          let actualPlayCount = 0;

          try {
            if (upload.content_type === 'single' && upload.metadata?.song_id) {
              const { data: song } = await supabase
                .from('songs')
                .select('play_count')
                .eq('id', upload.metadata.song_id)
                .maybeSingle();
              actualPlayCount = song?.play_count || 0;
            } else if (upload.content_type === 'album' && upload.metadata?.album_id) {
              // Use RPC call to properly handle UUID to string comparison
              const { data: result, error: songsError } = await supabase
                .rpc('get_album_play_count', { album_uuid: upload.metadata.album_id });

              if (songsError) {
                console.error('Error fetching album play count:', songsError);
                // Fallback to direct query
                const { data: songs } = await supabase
                  .from('songs')
                  .select('play_count')
                  .eq('album_id', upload.metadata.album_id);
                actualPlayCount = songs?.reduce((sum, song) => sum + (song.play_count || 0), 0) || 0;
              } else {
                actualPlayCount = result || 0;
              }
            } else if (upload.content_type === 'mix' && upload.metadata?.song_ids) {
              const { data: songs } = await supabase
                .from('songs')
                .select('play_count')
                .in('id', upload.metadata.song_ids);
              actualPlayCount = songs?.reduce((sum, song) => sum + (song.play_count || 0), 0) || 0;
            } else if (upload.content_type === 'video' && upload.metadata?.song_id) {
              const { count } = await supabase
                .from('video_playback_history')
                .select('*', { count: 'exact', head: true })
                .eq('video_id', upload.metadata.song_id);
              actualPlayCount = count || 0;
            }
          } catch (err) {
            console.error('Error fetching play count for upload:', upload.id, err);
          }

          return {
            ...upload,
            play_count: actualPlayCount
          };
        })
      ).then(async (enrichedData) => {
        setMyUploads(enrichedData);
        // Cache the enriched uploads
        await persistentCache.set(UPLOADS_CACHE_KEY, enrichedData, CACHE_DURATION);
      });
    } catch (error) {
      console.error('Error in loadUserContent:', error);
      setMyUploads([]);
    }
  }, []);

  const loadUserPlaylists = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMyPlaylists([]);
        return;
      }

      const playlists = await getUserPlaylists();
      setMyPlaylists(playlists || []);
      // Cache playlists
      await persistentCache.set(PLAYLISTS_CACHE_KEY, playlists || [], CACHE_DURATION);
    } catch (error) {
      console.error('Error in loadUserPlaylists:', error);
      setMyPlaylists([]);
    }
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    checkAuthAndLoadData();
  };

  const handleCreatePlaylistSuccess = () => {
    setShowCreatePlaylistModal(false);
    loadUserPlaylists();
  };

  const handleEditContentSuccess = async () => {
    setEditingContent(null);
    // Clear cache before reloading to ensure fresh data
    await persistentCache.delete(UPLOADS_CACHE_KEY);
    await loadUserContent();
  };

  const handleEditPlaylistSuccess = () => {
    setEditingPlaylist(null);
    loadUserPlaylists();
  };

  const handleDeleteContent = async (contentId: string) => {
    if (isDeleting) return;

    const confirmed = await confirm.confirm({
      title: 'Delete Content',
      message: 'Are you sure you want to delete this content? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });

    if (!confirmed) return;

    // Optimistic UI update - remove from UI immediately
    const contentToDelete = myUploads.find(item => item.id === contentId);
    if (!contentToDelete) return;

    setMyUploads(prev => prev.filter(item => item.id !== contentId));
    setIsDeleting(contentId);

    try {
      // Actual deletion happens in background
      await deleteContentUpload(contentId);
      // Update cache after successful deletion
      await persistentCache.set(
        UPLOADS_CACHE_KEY,
        myUploads.filter(item => item.id !== contentId),
        CACHE_DURATION
      );
    } catch (error) {
      console.error('Error deleting content:', error);
      // Revert optimistic update on error
      setMyUploads(prev => {
        const restored = [...prev, contentToDelete].sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        return restored;
      });
      alert('Failed to delete content. Please try again.');
    } finally {
      setIsDeleting(null);
    }
  };

  const handleDeletePlaylist = async (playlistId: string) => {
    if (isDeleting) return;

    const confirmed = await confirm.confirm({
      title: 'Delete Playlist',
      message: 'Are you sure you want to delete this playlist? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });

    if (!confirmed) return;

    // Optimistic UI update - remove from UI immediately
    const playlistToDelete = myPlaylists.find(item => item.id === playlistId);
    if (!playlistToDelete) return;

    setMyPlaylists(prev => prev.filter(item => item.id !== playlistId));
    setIsDeleting(playlistId);

    try {
      // Actual deletion happens in background
      await deletePlaylist(playlistId);
      // Update cache after successful deletion
      await persistentCache.set(
        PLAYLISTS_CACHE_KEY,
        myPlaylists.filter(item => item.id !== playlistId),
        CACHE_DURATION
      );
    } catch (error) {
      console.error('Error deleting playlist:', error);
      // Revert optimistic update on error
      setMyPlaylists(prev => {
        const restored = [...prev, playlistToDelete].sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        return restored;
      });
      alert('Failed to delete playlist. Please try again.');
    } finally {
      setIsDeleting(null);
    }
  };


  const handleShareContent = async (content: any) => {
    const contentType = content.content_type;
    const metadata = content.metadata || {};

    // Get artist name from artist_profiles join or fallback to metadata
    const artistName = content.artist_profiles?.stage_name || metadata.artist_name || 'Unknown Artist';

    try {
      await recordShareEvent(metadata.song_id || metadata.album_id || content.id, contentType);

      if (contentType === 'single') {
        const songId = metadata.song_id || content.id;
        await shareSong(songId, content.title, artistName);
      } else if (contentType === 'video') {
        await shareVideo(content.id, content.title);
      } else if (contentType === 'album') {
        await shareAlbum(metadata.album_id, content.title, artistName);
      }
    } catch (error) {
      console.error('Error sharing content:', error);
    }
  };


  const handlePlayContent = (content: any) => {
    const contentType = content.content_type;
    const metadata = content.metadata || {};

    // Get artist name from artist_profiles join or fallback to metadata
    const artistName = content.artist_profiles?.stage_name || metadata.artist_name || 'Unknown Artist';

    if (contentType === 'single' && metadata.audio_url && onOpenMusicPlayer) {
      const song: Song = {
        id: metadata.song_id || content.id,
        title: content.title,
        artist: artistName,
        artistId: content.user_id,
        coverImageUrl: metadata.cover_url,
        audioUrl: metadata.audio_url,
        duration: metadata.duration_seconds,
        playCount: content.play_count || 0
      };
      onOpenMusicPlayer(song);
    } else if (contentType === 'video' && (metadata.video_url || metadata.file_url)) {
      navigate(`/video/${content.id}`);
    } else if (contentType === 'album' && metadata.album_id) {
      navigate(`/album-detail/${metadata.album_id}`);
    } else {
      alert('This content cannot be played at the moment. It may be missing required media files.');
    }
  };

  const getFilteredUploads = useMemo(() => {
    let filtered = [...myUploads];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.title.toLowerCase().includes(query) ||
        (item.description && item.description.toLowerCase().includes(query))
      );
    }

    if (contentFilter !== 'all') {
      filtered = filtered.filter(item => item.content_type === contentFilter);
    }

    return filtered;
  }, [myUploads, searchQuery, contentFilter]);

  const getContentIcon = (contentType: string) => {
    switch (contentType) {
      case 'single': return Music;
      case 'album': return Album;
      case 'video': return Video;
      default: return Music;
    }
  };

  const formatContentType = (type: string): string => {
    switch (type) {
      case 'single': return 'Single';
      case 'album': return 'Album';
      case 'video': return 'Video';
      default: return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatPlayCount = (count: number): string => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  if (!isInitialized || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] content-with-nav">
        {null}
      </div>
    );
  }

  if (!authIsAuthenticated) {
    if (!showAuthModal && !authModalDismissed) {
      setShowAuthModal(true);
    } else if (authModalDismissed) {
      navigate('/');
      return null;
    }

    return (
      <>
        <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] content-with-nav">
          {null}
        </div>

        {showAuthModal && (
          <AuthModal
            onClose={() => {
              setShowAuthModal(false);
              setAuthModalDismissed(true);
              onFormVisibilityChange?.(false);
              navigate('/');
            }}
            onSuccess={handleAuthSuccess}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col min-h-[100dvh] overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav">
        {/* Header */}
        <header className="w-full py-5 px-6 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <h1 className="font-bold text-lg">Library</h1>
            <div className="w-10"></div>
          </div>
        </header>

        {/* Tab Filter */}
        <div className="px-4 py-4 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 justify-center">
            {isCreator && (
              <button
                onClick={() => setActiveTab('uploads')}
                className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all whitespace-nowrap active:scale-95 ${
                  activeTab === 'uploads'
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                My Uploads
              </button>
            )}
            <button
              onClick={() => setActiveTab('playlists')}
              className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all whitespace-nowrap active:scale-95 ${
                activeTab === 'playlists'
                  ? 'bg-white text-black'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              Playlists
            </button>
          </div>
        </div>

        {/* Content Filter (Uploads Only) */}
        {activeTab === 'uploads' && (
          <div className="px-6 pb-4 overflow-x-auto scrollbar-hide">
            {isCreator ? (
              <div className="flex gap-2 min-w-max justify-center">
                <button
                  onClick={() => setContentFilter('all')}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                    contentFilter === 'all'
                      ? 'bg-white/20 text-white'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setContentFilter('single')}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                    contentFilter === 'single'
                      ? 'bg-white/20 text-white'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  Singles
                </button>
                <button
                  onClick={() => setContentFilter('album')}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                    contentFilter === 'album'
                      ? 'bg-white/20 text-white'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  Albums
                </button>
                <button
                  onClick={() => setContentFilter('video')}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                    contentFilter === 'video'
                      ? 'bg-white/20 text-white'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  Videos
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* Search Bar (Uploads Only) */}
        {activeTab === 'uploads' && (
          <div className="px-6 pb-6">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/40" />
              <input
                type="text"
                placeholder="Search your uploads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-14 pl-12 pr-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 focus:border-white/30 transition-all text-base"
              />
            </div>
          </div>
        )}

        {/* My Uploads Tab */}
        {activeTab === 'uploads' && isCreator && (
          <div className="px-6 pb-20">
            <h2 className="text-xl font-bold mb-6">Your Content</h2>
            {isLoading ? (
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i}>
                    <div className="w-full aspect-square rounded-xl bg-white/5 animate-pulse mb-2" />
                    <div className="h-3 w-full bg-white/5 rounded animate-pulse mb-1" />
                    <div className="h-2 w-2/3 bg-white/5 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : !isLoading && getFilteredUploads.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Music className="w-8 h-8 text-white/60" />
                </div>
                <h3 className="font-semibold text-lg text-gray-300 mb-2">No Content Found</h3>
                <p className="text-gray-500 text-sm">
                  {searchQuery || contentFilter !== 'all'
                    ? 'Try adjusting your search or filters'
                    : 'Start creating and sharing your content'}
                </p>
              </div>
            ) : getFilteredUploads.length > 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {getFilteredUploads.map((content) => {
                  const IconComponent = getContentIcon(content.content_type);

                  return (
                    <div
                      key={content.id}
                      onClick={() => handlePlayContent(content)}
                      className="cursor-pointer group"
                    >
                      <div className="relative w-full aspect-square rounded-xl overflow-hidden mb-2 bg-white/5 will-change-transform">
                        {content.metadata?.cover_url || content.metadata?.thumbnail_url ? (
                          <LazyImage
                            src={content.metadata?.cover_url || content.metadata?.thumbnail_url}
                            alt={content.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <IconComponent className="w-8 h-8 text-white/40" />
                          </div>
                        )}

                        {/* Overflow Menu (Always visible - top-right) */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(content.id);
                          }}
                          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 backdrop-blur-md flex items-center justify-center hover:bg-black/80 transition-all z-10"
                          title="More options"
                        >
                          <MoreVertical className="w-4 h-4 text-white" />
                        </button>

                        {/* Large Play Button (Bottom-right - Always visible) */}
                        <div className="absolute bottom-3 right-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayContent(content);
                            }}
                            className="w-10 h-10 rounded-full bg-white hover:scale-110 active:scale-95 shadow-lg shadow-black/40 flex items-center justify-center transition-all duration-200"
                            title="Play"
                          >
                            <Play className="w-4 h-4 text-transparent ml-0.5 stroke-black stroke-[2]" fill="transparent" />
                          </button>
                        </div>

                        {content.play_count > 0 && (
                          <div className="absolute top-2 left-2 px-2 py-1 bg-black/70 backdrop-blur-sm rounded-full flex items-center gap-1">
                            <Play className="w-3 h-3 text-white" />
                            <span className="text-xs text-white">{formatPlayCount(content.play_count)}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-left">
                        <h3 className="text-xs font-semibold text-white truncate mb-0.5">{content.title}</h3>
                        <div className="flex items-center gap-1.5">
                          <p className="text-[10px] text-gray-400 truncate">{formatContentType(content.content_type)}</p>
                          <span className="text-[10px] text-gray-500">•</span>
                          <p className="text-[10px] text-gray-400">
                            {content.content_type === 'video'
                              ? `${formatPlayCount(content.play_count || 0)} views`
                              : `${formatPlayCount(content.play_count || 0)} plays`}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}

        {/* Playlists Tab */}
        {activeTab === 'playlists' && (
          <div className="px-6 pb-20">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Your Playlists</h2>
              <button
                onClick={() => setShowCreatePlaylistModal(true)}
                className="w-10 h-10 rounded-full bg-white flex items-center justify-center hover:scale-110 transition-transform"
              >
                <Plus className="w-5 h-5 text-black" />
              </button>
            </div>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i}>
                    <div className="w-full aspect-square rounded-xl bg-white/5 animate-pulse mb-2" />
                    <div className="h-3 w-full bg-white/5 rounded animate-pulse mb-1" />
                    <div className="h-2 w-1/2 bg-white/5 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : myPlaylists.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Music className="w-8 h-8 text-white/60" />
                </div>
                <h3 className="font-semibold text-lg text-gray-300 mb-2">No Playlists Yet</h3>
                <p className="text-gray-500 text-sm mb-6">Create your first playlist to organize your music</p>
                <button
                  onClick={() => setShowCreatePlaylistModal(true)}
                  className="px-8 py-3 bg-white text-black rounded-full font-medium hover:scale-105 transition-transform"
                >
                  Create Playlist
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {myPlaylists.map((playlist) => {
                  const songCount = playlist.playlist_songs ? playlist.playlist_songs.length : 0;

                  return (
                    <div
                      key={playlist.id}
                      onClick={() => navigate(`/playlist-detail/${playlist.id}`)}
                      className="cursor-pointer group"
                    >
                      <div className="relative w-full aspect-square rounded-xl overflow-hidden mb-2 bg-white/5 will-change-transform">
                        {playlist.cover_image_url ? (
                          <LazyImage
                            src={playlist.cover_image_url}
                            alt={playlist.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music className="w-8 h-8 text-white/40" />
                          </div>
                        )}

                        {/* Overflow Menu (Always visible - top-right) */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(playlist.id);
                          }}
                          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 backdrop-blur-md flex items-center justify-center hover:bg-black/80 transition-all z-10"
                          title="More options"
                        >
                          <MoreVertical className="w-4 h-4 text-white" />
                        </button>

                        {/* Large Play Button (Bottom-right - Always visible) */}
                        <div className="absolute bottom-3 right-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/playlist-detail/${playlist.id}`);
                            }}
                            className="w-10 h-10 rounded-full bg-white hover:scale-110 active:scale-95 shadow-lg shadow-black/40 flex items-center justify-center transition-all duration-200"
                            title="Open playlist"
                          >
                            <Play className="w-4 h-4 text-transparent ml-0.5 stroke-black stroke-[2]" fill="transparent" />
                          </button>
                        </div>

                        {/* Song Count Badge (Bottom-left) */}
                        <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/70 backdrop-blur-sm rounded-full">
                          <span className="text-xs text-white">{songCount} songs</span>
                        </div>

                      </div>
                      <div className="text-left">
                        <h3 className="text-xs font-semibold text-white truncate mb-0.5">{playlist.title}</h3>
                        <p className="text-[10px] text-gray-400 truncate">{formatDate(playlist.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Modals */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleAuthSuccess}
        />
      )}

      {showCreatePlaylistModal && (
        <CreatePlaylistModal
          onClose={() => setShowCreatePlaylistModal(false)}
          onSuccess={handleCreatePlaylistSuccess}
        />
      )}

      {editingContent && (
        <EditContentModal
          upload={editingContent}
          onClose={() => setEditingContent(null)}
          onSuccess={handleEditContentSuccess}
        />
      )}

      {editingPlaylist && (
        <EditPlaylistModal
          playlistId={editingPlaylist}
          onClose={() => setEditingPlaylist(null)}
          onSuccess={handleEditPlaylistSuccess}
        />
      )}

      {/* Content/Playlist Action Sheet */}
      {activeMenuId && (() => {
        const content = myUploads.find(c => c.id === activeMenuId);
        const playlist = myPlaylists.find(p => p.id === activeMenuId);
        const item = content || playlist;

        if (!item) return null;

        const isPlaylist = !!playlist;

        return (
          <BottomActionSheet
            isOpen={true}
            onClose={() => setActiveMenuId(null)}
            title={item.title}
            actions={
              isPlaylist
                ? [
                    {
                      icon: <Play className="w-5 h-5" />,
                      label: 'Open Playlist',
                      onClick: () => navigate(`/playlist-detail/${item.id}`),
                    },
                    {
                      icon: <Edit3 className="w-5 h-5" />,
                      label: 'Edit Playlist',
                      onClick: () => setEditingPlaylist(item.id),
                    },
                    {
                      icon: <Trash2 className="w-5 h-5" />,
                      label: 'Delete Playlist',
                      variant: 'destructive' as const,
                      onClick: () => setDeleteConfirmId(item.id),
                    },
                  ]
                : [
                    {
                      icon: <Play className="w-5 h-5" />,
                      label: 'Play',
                      onClick: () => handlePlayContent(content),
                    },
                    {
                      icon: <Share2 className="w-5 h-5" />,
                      label: 'Share',
                      onClick: () => handleShareContent(content),
                    },
                    {
                      icon: <Edit3 className="w-5 h-5" />,
                      label: 'Edit',
                      onClick: () => setEditingContent(content),
                    },
                    {
                      icon: <Trash2 className="w-5 h-5" />,
                      label: 'Delete',
                      variant: 'destructive' as const,
                      onClick: () => setDeleteConfirmId(item.id),
                    },
                  ]
            }
          />
        );
      })()}

      {/* Delete Confirmation Action Sheet */}
      {deleteConfirmId && (() => {
        const content = myUploads.find(c => c.id === deleteConfirmId) || myPlaylists.find(p => p.id === deleteConfirmId);
        if (!content) return null;

        const isPlaylist = myPlaylists.some(p => p.id === deleteConfirmId);

        return (
          <BottomActionSheet
            isOpen={true}
            onClose={() => setDeleteConfirmId(null)}
            title={`Delete ${isPlaylist ? 'Playlist' : 'Content'}?`}
            actions={[
              {
                icon: <Trash2 className="w-5 h-5" />,
                label: `Yes, delete "${content.title}"`,
                variant: 'destructive' as const,
                onClick: () => {
                  if (isPlaylist) {
                    handleDeletePlaylist(deleteConfirmId);
                  } else {
                    handleDeleteContent(deleteConfirmId);
                  }
                  setDeleteConfirmId(null);
                },
              },
            ]}
          />
        );
      })()}
    </>
  );
};
