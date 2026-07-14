import { useState, useEffect } from 'react';
import { ArrowLeft, Music, Video, User, Sparkles, Album, Play, Eye, MousePointer, BarChart3, Pause, PlayCircle, Trash2, AlertCircle, Search, Clock, Gift, Coins, RefreshCw, ListMusic, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Skeleton } from '../../components/ui/skeleton';
import { PromotionSetupModal } from '../../components/PromotionSetupModal';
import { AuthModal } from '../../components/AuthModal';
import { CustomConfirmDialog } from '../../components/CustomConfirmDialog';
import { LazyImage } from '../../components/LazyImage';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAlert } from '../../contexts/AlertContext';
import { persistentCache } from '../../lib/persistentCache';
import { useNavigate } from 'react-router-dom';
import { useProgressiveRender } from '../../hooks/useProgressiveRender';

interface Song {
  id: string;
  title: string;
  cover_image_url: string | null;
  play_count: number;
  created_at: string;
}

interface AlbumData {
  id: string;
  title: string;
  cover_image_url: string | null;
  created_at: string;
  songs?: { id: string }[];
}

interface ShortClip {
  id: string;
  title: string;
  metadata: {
    thumbnail_url?: string;
    duration_seconds?: number;
  };
  created_at: string;
}

interface UserProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
}

interface Playlist {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  play_count: number;
  created_at: string;
  songs?: { id: string }[];
}

interface Promotion {
  id: string;
  promotion_type: 'song' | 'video' | 'profile' | 'album' | 'short_clip' | 'playlist';
  target_id: string | null;
  target_title: string;
  treats_cost: number;
  duration_hours: number;
  start_date: string;
  end_date: string;
  status: 'pending_approval' | 'pending' | 'active' | 'paused' | 'completed' | 'cancelled' | 'rejected' | 'deleted';
  impressions_actual: number;
  clicks: number;
  created_at: string;
  promotion_sections?: {
    section_name: string;
  };
}

const CACHE_KEYS = {
  USER_SONGS: (userId: string) => `promotion:songs:${userId}`,
  USER_VIDEOS: (userId: string) => `promotion:videos:${userId}`,
  USER_ALBUMS: (userId: string) => `promotion:albums:${userId}`,
  USER_CLIPS: (userId: string) => `promotion:clips:${userId}`,
  USER_PLAYLISTS: (userId: string) => `promotion:playlists:${userId}`,
  USER_PROFILE: (userId: string) => `promotion:profile:${userId}`,
  PROMOTIONS: (userId: string, filter: string) => `promotions:${userId}:${filter}`,
};

const CACHE_TTL = {
  CONTENT: 3 * 60 * 1000,
  PROMOTIONS: 15 * 1000,
};

const ContentTypeIcon: React.FC<{ type: string; className?: string }> = ({ type, className = 'w-5 h-5' }) => {
  switch (type) {
    case 'singles': return <Music className={className} />;
    case 'albums': return <Album className={className} />;
    case 'videos': return <Video className={className} />;
    case 'loops': return <Play className={className} />;
    case 'playlists': return <ListMusic className={className} />;
    case 'profile': return <User className={className} />;
    default: return <Sparkles className={className} />;
  }
};

const statusConfig = {
  pending_approval: { label: 'Pending', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  pending: { label: 'Approved', color: 'text-[#00ad74]', bg: 'bg-[#00ad74]/10', border: 'border-[#00ad74]/20' },
  active: { label: 'Active', color: 'text-[#00ad74]', bg: 'bg-[#00ad74]/10', border: 'border-[#00ad74]/20' },
  paused: { label: 'Paused', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  completed: { label: 'Completed', color: 'text-white/40', bg: 'bg-white/5', border: 'border-white/10' },
  cancelled: { label: 'Cancelled', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  rejected: { label: 'Rejected', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  deleted: { label: 'Deleted', color: 'text-white/30', bg: 'bg-white/5', border: 'border-white/10' },
};

export const PromotionCenterScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const { user, isAuthenticated, isInitialized } = useAuth();
  const { showAlert } = useAlert();
  const [isLoading, setIsLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [selectedContent, setSelectedContent] = useState<{
    type: 'song' | 'video' | 'profile' | 'album' | 'short_clip' | 'playlist';
    id: string | null;
    title: string;
  } | null>(null);

  const [userSongs, setUserSongs] = useState<Song[]>([]);
  const [userVideos, setUserVideos] = useState<Song[]>([]);
  const [userAlbums, setUserAlbums] = useState<AlbumData[]>([]);
  const [userShortClips, setUserShortClips] = useState<ShortClip[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<Playlist[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [isLoadingPromotions, setIsLoadingPromotions] = useState(false);
  const [promotionFilter, setPromotionFilter] = useState<'all' | 'pending_approval' | 'active' | 'completed'>('all');
  const [currentTab, setCurrentTab] = useState('content');
  const [contentTab, setContentTab] = useState('singles');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteConfirmData, setDeleteConfirmData] = useState<{ id: string; title: string; status: string } | null>(null);
  const [contentSearchQuery, setContentSearchQuery] = useState('');

  const { visibleItems: visibleSongs, hasMore: hasMoreSongs, sentinelRef: songsSentinelRef } =
    useProgressiveRender(userSongs.filter(s =>
      !contentSearchQuery || s.title.toLowerCase().includes(contentSearchQuery.toLowerCase())
    ), 8, 4);

  const { visibleItems: visibleVideos, hasMore: hasMoreVideos, sentinelRef: videosSentinelRef } =
    useProgressiveRender(userVideos.filter(v =>
      !contentSearchQuery || v.title.toLowerCase().includes(contentSearchQuery.toLowerCase())
    ), 8, 4);

  const { visibleItems: visibleAlbums, hasMore: hasMoreAlbums, sentinelRef: albumsSentinelRef } =
    useProgressiveRender(userAlbums.filter(a =>
      !contentSearchQuery || a.title.toLowerCase().includes(contentSearchQuery.toLowerCase())
    ), 8, 4);

  const { visibleItems: visibleClips, hasMore: hasMoreClips, sentinelRef: clipsSentinelRef } =
    useProgressiveRender(userShortClips.filter(c =>
      !contentSearchQuery || c.title.toLowerCase().includes(contentSearchQuery.toLowerCase())
    ), 8, 4);

  const { visibleItems: visiblePlaylists, hasMore: hasMorePlaylists, sentinelRef: playlistsSentinelRef } =
    useProgressiveRender(userPlaylists.filter(p =>
      !contentSearchQuery || p.title.toLowerCase().includes(contentSearchQuery.toLowerCase())
    ), 8, 4);

  const { visibleItems: visiblePromotions, hasMore: hasMorePromotions, sentinelRef: promotionsSentinelRef } =
    useProgressiveRender(promotions, 6, 3);

  useEffect(() => {
    if (isInitialized) {
      loadData();
    }
  }, [isInitialized, isAuthenticated, user]);

  useEffect(() => {
    if (isAuthenticated && currentTab === 'promotions') {
      loadPromotions();
    }
  }, [isAuthenticated, currentTab, promotionFilter]);

  useEffect(() => {
    if (!isAuthenticated || !user || currentTab !== 'promotions') return;

    const channel = supabase
      .channel('promotions_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'promotions',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          if (user) {
            persistentCache.delete(CACHE_KEYS.PROMOTIONS(user.id, promotionFilter));
          }
          loadPromotions(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated, user, currentTab, promotionFilter]);

  useEffect(() => {
    if (userProfile) {
      const isListener = userProfile.role === 'listener';
      setContentTab(isListener ? 'playlists' : 'singles');
    }
  }, [userProfile]);

  const loadData = async () => {
    try {
      if (isAuthenticated && user) {
        await loadUserContent();
      }
    } catch (error) {
      console.error('[PromotionCenterScreen] Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadUserContent = async (skipCache = false) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await Promise.all([
      loadUserSongs(user.id, skipCache),
      loadUserVideos(user.id, skipCache),
      loadUserAlbums(user.id, skipCache),
      loadUserShortClips(user.id, skipCache),
      loadUserPlaylists(user.id, skipCache),
      loadUserProfile(user.id, skipCache)
    ]);
  };

  const loadUserSongs = async (userId: string, skipCache = false) => {
    try {
      const cacheKey = CACHE_KEYS.USER_SONGS(userId);
      if (!skipCache) {
        const cached = await persistentCache.get<Song[]>(cacheKey);
        if (cached) { setUserSongs(cached); return; }
      }

      const { data: artistProfile } = await supabase
        .from('artist_profiles').select('artist_id').eq('user_id', userId).maybeSingle();

      if (!artistProfile?.artist_id) { setUserSongs([]); return; }

      const { data, error } = await supabase
        .from('songs').select('id, title, cover_image_url, play_count, created_at')
        .eq('artist_id', artistProfile.artist_id).is('video_url', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const songs = data || [];
      setUserSongs(songs);
      await persistentCache.set(cacheKey, songs, CACHE_TTL.CONTENT);
    } catch (error) {
      console.error('Error loading user songs:', error);
    }
  };

  const loadUserVideos = async (userId: string, skipCache = false) => {
    try {
      const cacheKey = CACHE_KEYS.USER_VIDEOS(userId);
      if (!skipCache) {
        const cached = await persistentCache.get<Song[]>(cacheKey);
        if (cached) { setUserVideos(cached); return; }
      }

      const { data, error } = await supabase
        .from('content_uploads').select('id, title, metadata, play_count, created_at')
        .eq('user_id', userId).eq('content_type', 'video')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const videos = (data || []).map(video => ({
        id: video.id,
        title: video.title,
        cover_image_url: video.metadata?.thumbnail_url || null,
        play_count: video.play_count || 0,
        created_at: video.created_at
      }));

      setUserVideos(videos);
      await persistentCache.set(cacheKey, videos, CACHE_TTL.CONTENT);
    } catch (error) {
      console.error('Error loading user videos:', error);
    }
  };

  const loadUserAlbums = async (userId: string, skipCache = false) => {
    try {
      const cacheKey = CACHE_KEYS.USER_ALBUMS(userId);
      if (!skipCache) {
        const cached = await persistentCache.get<AlbumData[]>(cacheKey);
        if (cached) { setUserAlbums(cached); return; }
      }

      const { data: artistProfile } = await supabase
        .from('artist_profiles').select('artist_id').eq('user_id', userId).maybeSingle();

      if (!artistProfile?.artist_id) { setUserAlbums([]); return; }

      const { data, error } = await supabase
        .from('albums').select('id, title, cover_image_url, created_at, songs(id)')
        .eq('artist_id', artistProfile.artist_id).order('created_at', { ascending: false });

      if (error) throw error;
      const albums = data || [];
      setUserAlbums(albums);
      await persistentCache.set(cacheKey, albums, CACHE_TTL.CONTENT);
    } catch (error) {
      console.error('Error loading user albums:', error);
    }
  };

  const loadUserShortClips = async (userId: string, skipCache = false) => {
    try {
      const cacheKey = CACHE_KEYS.USER_CLIPS(userId);
      if (!skipCache) {
        const cached = await persistentCache.get<ShortClip[]>(cacheKey);
        if (cached) { setUserShortClips(cached); return; }
      }

      const { data, error } = await supabase
        .from('content_uploads').select('id, title, metadata, created_at')
        .eq('user_id', userId).eq('content_type', 'short_clip')
        .order('created_at', { ascending: false });

      if (error) throw error;
      const clips = data || [];
      setUserShortClips(clips);
      await persistentCache.set(cacheKey, clips, CACHE_TTL.CONTENT);
    } catch (error) {
      console.error('Error loading user short clips:', error);
    }
  };

  const loadUserPlaylists = async (userId: string, skipCache = false) => {
    try {
      const cacheKey = CACHE_KEYS.USER_PLAYLISTS(userId);
      if (!skipCache) {
        const cached = await persistentCache.get<Playlist[]>(cacheKey);
        if (cached) { setUserPlaylists(cached); return; }
      }

      const { data, error } = await supabase
        .from('playlists')
        .select('id, title, description, cover_image_url, play_count, created_at, playlist_songs(id)')
        .eq('user_id', userId).order('created_at', { ascending: false });

      if (error) throw error;

      const playlists = (data || []).map(playlist => ({
        ...playlist,
        songs: playlist.playlist_songs || []
      }));

      setUserPlaylists(playlists);
      await persistentCache.set(cacheKey, playlists, CACHE_TTL.CONTENT);
    } catch (error) {
      console.error('Error loading user playlists:', error);
    }
  };

  const loadUserProfile = async (userId: string, skipCache = false) => {
    try {
      const cacheKey = CACHE_KEYS.USER_PROFILE(userId);
      if (!skipCache) {
        const cached = await persistentCache.get<UserProfile>(cacheKey);
        if (cached) { setUserProfile(cached); return; }
      }

      const { data, error } = await supabase
        .from('users').select('id, display_name, avatar_url, role').eq('id', userId).single();

      if (error) throw error;
      setUserProfile(data);
      await persistentCache.set(cacheKey, data, CACHE_TTL.CONTENT);
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const loadPromotions = async (skipCache = false) => {
    try {
      setIsLoadingPromotions(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const cacheKey = CACHE_KEYS.PROMOTIONS(user.id, promotionFilter);

      if (!skipCache) {
        const cached = await persistentCache.get<Promotion[]>(cacheKey);
        if (cached) {
          setPromotions(cached);
          setIsLoadingPromotions(false);
          return;
        }
      }

      try {
        await supabase.rpc('auto_complete_expired_promotions');
      } catch (err) {
        console.error('Error auto-completing promotions:', err);
      }

      let query = supabase
        .from('promotions')
        .select(`*, promotion_sections:promotion_section_id(section_name)`)
        .eq('user_id', user.id)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false });

      if (promotionFilter !== 'all') {
        query = query.eq('status', promotionFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const promos = data || [];
      setPromotions(promos);
      await persistentCache.set(cacheKey, promos, CACHE_TTL.PROMOTIONS);
    } catch (error) {
      console.error('Error loading promotions:', error);
    } finally {
      setIsLoadingPromotions(false);
    }
  };

  const handlePromoteClick = (type: 'song' | 'video' | 'profile' | 'album' | 'short_clip' | 'playlist', id: string | null, title: string) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    setSelectedContent({ type, id, title });
    setShowPromotionModal(true);
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    loadData();
  };

  const handlePromotionSuccess = async () => {
    setShowPromotionModal(false);
    setSelectedContent(null);
    if (user) {
      await persistentCache.delete(CACHE_KEYS.PROMOTIONS(user.id, promotionFilter));
    }
    await loadPromotions(true);
  };

  const handlePausePromotion = async (promotionId: string) => {
    try {
      setActionLoading(promotionId);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase.rpc('pause_promotion', {
        p_promotion_id: promotionId,
        p_user_id: user.id
      });

      if (error) throw error;

      if (data.success) {
        await persistentCache.delete(CACHE_KEYS.PROMOTIONS(user.id, promotionFilter));
        await loadPromotions(true);
        showAlert({ title: 'Promotion Paused', message: 'Your promotion has been paused successfully.', type: 'success' });
      } else {
        showAlert({ title: 'Pause Failed', message: data.message || 'Unable to pause promotion.', type: 'error' });
      }
    } catch (error) {
      console.error('Error pausing promotion:', error);
      showAlert({ title: 'Pause Failed', message: 'Failed to pause promotion. Please try again.', type: 'error' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleResumePromotion = async (promotionId: string) => {
    try {
      setActionLoading(promotionId);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase.rpc('resume_promotion', {
        p_promotion_id: promotionId,
        p_user_id: user.id
      });

      if (error) throw error;

      if (data.success) {
        await persistentCache.delete(CACHE_KEYS.PROMOTIONS(user.id, promotionFilter));
        await loadPromotions(true);
        showAlert({ title: 'Promotion Resumed', message: 'Your promotion is now active again.', type: 'success' });
      } else {
        showAlert({ title: 'Resume Failed', message: data.message || 'Unable to resume promotion.', type: 'error' });
      }
    } catch (error) {
      console.error('Error resuming promotion:', error);
      showAlert({ title: 'Resume Failed', message: 'Failed to resume promotion. Please try again.', type: 'error' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeletePromotionClick = (promotion: Promotion) => {
    const statusText = promotion.status === 'pending_approval' || promotion.status === 'pending'
      ? ' (Full refund available)'
      : '';

    setDeleteConfirmData({
      id: promotion.id,
      title: promotion.target_title || 'this promotion',
      status: statusText
    });
  };

  const handleDeletePromotion = async () => {
    if (!deleteConfirmData) return;

    const promotionId = deleteConfirmData.id;
    const promotionTitle = deleteConfirmData.title;
    setDeleteConfirmData(null);

    try {
      setActionLoading(promotionId);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setPromotions(prev => prev.filter(p => p.id !== promotionId));

      const { data, error } = await supabase.rpc('delete_promotion', {
        p_promotion_id: promotionId,
        p_user_id: user.id
      });

      if (error) throw error;

      if (data.success) {
        await persistentCache.delete(CACHE_KEYS.PROMOTIONS(user.id, promotionFilter));
        showAlert({ title: 'Promotion Deleted', message: data.message || `"${promotionTitle}" has been successfully deleted.`, type: 'success' });
      } else {
        showAlert({ title: 'Deletion Failed', message: data.message || 'Unable to delete promotion.', type: 'error' });
        await loadPromotions(true);
      }
    } catch (error) {
      console.error('Error deleting promotion:', error);
      showAlert({ title: 'Deletion Failed', message: 'Failed to delete promotion. Please try again.', type: 'error' });
      await loadPromotions(true);
    } finally {
      setActionLoading(null);
    }
  };

  const getRemainingTime = (endDate: string): string => {
    const now = new Date();
    const end = new Date(endDate);
    const diff = end.getTime() - now.getTime();
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d left`;
    return `${hours}h left`;
  };

  const ContentItem = ({
    id, title, subtitle, coverUrl, icon: Icon, onBoost
  }: {
    id: string;
    title: string;
    subtitle: string;
    coverUrl: string | null;
    icon: React.ElementType;
    onBoost: () => void;
  }) => (
    <div className="flex items-center gap-3 p-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] active:bg-white/[0.06] transition-colors">
      <div className="w-13 h-13 rounded-xl overflow-hidden bg-white/[0.06] flex-shrink-0 flex items-center justify-center" style={{ width: 52, height: 52 }}>
        {coverUrl ? (
          <LazyImage src={coverUrl} alt={title} className="w-full h-full object-cover" />
        ) : (
          <Icon className="w-5 h-5 text-white/30" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-white/90 text-sm truncate font-['Inter',sans-serif]">{title}</p>
        <p className="text-white/35 text-xs mt-0.5 font-['Inter',sans-serif]">{subtitle}</p>
      </div>

      <button
        onClick={onBoost}
        className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#00ad74]/15 border border-[#00ad74]/25 text-[#00ad74] text-xs font-bold font-['Inter',sans-serif] active:scale-[0.97] active:bg-[#00ad74]/20 transition-all"
      >
        <Gift className="w-3.5 h-3.5" />
        Boost
      </button>
    </div>
  );

  const EmptyState = ({ icon: Icon, message }: { icon: React.ElementType; message: string }) => (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center">
        <Icon className="w-7 h-7 text-white/20" />
      </div>
      <p className="text-white/30 text-sm font-['Inter',sans-serif] text-center">{message}</p>
    </div>
  );

  const SentinelLoader = ({ ref: sentinelRef }: { ref: React.RefObject<HTMLDivElement> }) => (
    <div ref={sentinelRef} className="py-6 flex justify-center">
      <Loader2 className="w-5 h-5 text-white/20 animate-spin" />
    </div>
  );

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0a] z-[100] overflow-y-auto">
        <header className="sticky top-0 z-20 px-5 pt-6 pb-4 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-white/[0.04]">
          <div className="flex items-center gap-4">
            <Skeleton className="w-9 h-9 rounded-xl bg-white/[0.05]" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-40 rounded-lg bg-white/[0.05]" />
              <Skeleton className="h-3.5 w-28 rounded-lg bg-white/[0.04]" />
            </div>
          </div>
        </header>
        <div className="px-5 pt-5 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 p-4 rounded-2xl border border-white/[0.07] bg-white/[0.03]">
              <Skeleton className="w-13 h-13 rounded-xl bg-white/[0.05]" style={{ width: 52, height: 52 }} />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4 rounded-lg bg-white/[0.05]" />
                <Skeleton className="h-3 w-1/2 rounded-lg bg-white/[0.04]" />
              </div>
              <Skeleton className="h-8 w-16 rounded-xl bg-white/[0.05]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <div className="fixed inset-0 bg-[#0a0a0a] z-[100] flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-sm text-center">
            <div className="w-20 h-20 rounded-3xl bg-[#00ad74]/10 border border-[#00ad74]/20 flex items-center justify-center mx-auto mb-6">
              <Gift className="w-9 h-9 text-[#00ad74]" />
            </div>
            <h2 className="font-['Inter',sans-serif] font-black text-white text-3xl leading-tight tracking-tight mb-1">
              Boost Center,
            </h2>
            <p className="font-['Inter',sans-serif] text-white/40 text-lg font-light mb-8">
              reach more listeners.
            </p>
            <p className="text-white/50 text-sm font-['Inter',sans-serif] mb-8 leading-relaxed">
              Sign in to promote your content and reach more listeners with treats.
            </p>
            <button
              onClick={() => setShowAuthModal(true)}
              className="w-full py-4 rounded-2xl bg-white text-black text-sm font-black font-['Inter',sans-serif] active:scale-[0.98] transition-transform"
            >
              Sign In to Continue
            </button>
          </div>
        </div>

        {showAuthModal && (
          <AuthModal onClose={() => setShowAuthModal(false)} onSuccess={handleAuthSuccess} />
        )}
      </>
    );
  }

  const isListener = userProfile?.role === 'listener';
  const availableContentTabs = isListener
    ? ['playlists', 'profile']
    : ['singles', 'albums', 'videos', 'loops', 'playlists', 'profile'];

  const tabLabels: Record<string, string> = {
    singles: 'Singles',
    albums: 'Albums',
    videos: 'Videos',
    loops: 'Loops',
    playlists: 'Playlists',
    profile: 'Profile',
  };

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] z-[100] overflow-y-auto">

      <header className="sticky top-0 z-20 px-5 pt-6 pb-4 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="flex items-center gap-3 mb-0.5">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.07] flex items-center justify-center active:scale-[0.93] active:bg-white/[0.08] transition-all flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-white/70" />
          </button>

          <div>
            <h1 className="font-['Inter',sans-serif] font-black text-white text-xl tracking-tight leading-tight">
              Boost Center,
            </h1>
            <p className="text-white/35 text-xs font-light font-['Inter',sans-serif] leading-tight">
              promote &amp; reach more listeners.
            </p>
          </div>
        </div>
      </header>

      <div className="px-5 pt-5 pb-32 space-y-5">

        <div className="grid grid-cols-2 gap-2">
          {(['content', 'promotions'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setCurrentTab(tab)}
              className={`h-11 rounded-2xl font-bold text-sm font-['Inter',sans-serif] transition-all duration-200 flex items-center justify-center gap-2 active:scale-[0.97] ${
                currentTab === tab
                  ? 'bg-white text-black'
                  : 'bg-white/[0.05] border border-white/[0.07] text-white/50 active:bg-white/[0.08]'
              }`}
            >
              {tab === 'content' ? <Sparkles className="w-4 h-4" /> : <BarChart3 className="w-4 h-4" />}
              {tab === 'content' ? 'My Content' : 'Campaigns'}
            </button>
          ))}
        </div>

        {currentTab === 'content' ? (
          <>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25 pointer-events-none" />
              <input
                type="text"
                placeholder="Search your content..."
                value={contentSearchQuery}
                onChange={(e) => setContentSearchQuery(e.target.value)}
                className="w-full h-11 bg-white/[0.04] border border-white/[0.07] rounded-2xl pl-10 pr-4 text-white/90 placeholder:text-white/20 text-sm outline-none focus:border-[#00ad74]/40 focus:bg-white/[0.06] transition-all font-['Inter',sans-serif]"
              />
            </div>

            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-5 px-5 pb-0.5">
              {availableContentTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setContentTab(tab)}
                  className={`flex-shrink-0 h-8 px-3.5 rounded-full font-semibold text-[11px] font-['Inter',sans-serif] flex items-center gap-1.5 transition-all active:scale-[0.96] ${
                    contentTab === tab
                      ? 'bg-white text-black'
                      : 'bg-white/[0.05] border border-white/[0.07] text-white/40 active:bg-white/[0.09]'
                  }`}
                >
                  <ContentTypeIcon type={tab} className="w-3 h-3" />
                  {tabLabels[tab]}
                </button>
              ))}
            </div>

            <div className="space-y-2.5">
              {contentTab === 'singles' && (
                <>
                  {visibleSongs.length === 0 ? (
                    <EmptyState
                      icon={Music}
                      message={contentSearchQuery ? 'No songs match your search.' : 'Upload singles to promote them.'}
                    />
                  ) : (
                    <>
                      {visibleSongs.map((song) => (
                        <ContentItem
                          key={song.id}
                          id={song.id}
                          title={song.title}
                          subtitle={`${song.play_count.toLocaleString()} plays`}
                          coverUrl={song.cover_image_url}
                          icon={Music}
                          onBoost={() => handlePromoteClick('song', song.id, song.title)}
                        />
                      ))}
                      {hasMoreSongs && <SentinelLoader ref={songsSentinelRef as React.RefObject<HTMLDivElement>} />}
                    </>
                  )}
                </>
              )}

              {contentTab === 'videos' && (
                <>
                  {visibleVideos.length === 0 ? (
                    <EmptyState
                      icon={Video}
                      message={contentSearchQuery ? 'No videos match your search.' : 'Upload videos to promote them.'}
                    />
                  ) : (
                    <>
                      {visibleVideos.map((video) => (
                        <ContentItem
                          key={video.id}
                          id={video.id}
                          title={video.title}
                          subtitle={`${video.play_count.toLocaleString()} views`}
                          coverUrl={video.cover_image_url}
                          icon={Video}
                          onBoost={() => handlePromoteClick('video', video.id, video.title)}
                        />
                      ))}
                      {hasMoreVideos && <SentinelLoader ref={videosSentinelRef as React.RefObject<HTMLDivElement>} />}
                    </>
                  )}
                </>
              )}

              {contentTab === 'albums' && (
                <>
                  {visibleAlbums.length === 0 ? (
                    <EmptyState
                      icon={Album}
                      message={contentSearchQuery ? 'No albums match your search.' : 'Create albums to promote them.'}
                    />
                  ) : (
                    <>
                      {visibleAlbums.map((album) => (
                        <ContentItem
                          key={album.id}
                          id={album.id}
                          title={album.title}
                          subtitle={`${album.songs?.length || 0} songs`}
                          coverUrl={album.cover_image_url}
                          icon={Album}
                          onBoost={() => handlePromoteClick('album', album.id, album.title)}
                        />
                      ))}
                      {hasMoreAlbums && <SentinelLoader ref={albumsSentinelRef as React.RefObject<HTMLDivElement>} />}
                    </>
                  )}
                </>
              )}

              {contentTab === 'loops' && (
                <>
                  {visibleClips.length === 0 ? (
                    <EmptyState
                      icon={Play}
                      message={contentSearchQuery ? 'No loops match your search.' : 'Upload loops to promote them.'}
                    />
                  ) : (
                    <>
                      {visibleClips.map((clip) => (
                        <ContentItem
                          key={clip.id}
                          id={clip.id}
                          title={clip.title}
                          subtitle={clip.metadata?.duration_seconds ? `${Math.floor(clip.metadata.duration_seconds)}s` : 'Loop'}
                          coverUrl={clip.metadata?.thumbnail_url || null}
                          icon={Play}
                          onBoost={() => handlePromoteClick('short_clip', clip.id, clip.title)}
                        />
                      ))}
                      {hasMoreClips && <SentinelLoader ref={clipsSentinelRef as React.RefObject<HTMLDivElement>} />}
                    </>
                  )}
                </>
              )}

              {contentTab === 'playlists' && (
                <>
                  {visiblePlaylists.length === 0 ? (
                    <EmptyState
                      icon={ListMusic}
                      message={contentSearchQuery ? 'No playlists match your search.' : 'Create playlists to promote them.'}
                    />
                  ) : (
                    <>
                      {visiblePlaylists.map((playlist) => (
                        <ContentItem
                          key={playlist.id}
                          id={playlist.id}
                          title={playlist.title}
                          subtitle={`${playlist.songs?.length || 0} songs • ${playlist.play_count.toLocaleString()} plays`}
                          coverUrl={playlist.cover_image_url}
                          icon={ListMusic}
                          onBoost={() => handlePromoteClick('playlist', playlist.id, playlist.title)}
                        />
                      ))}
                      {hasMorePlaylists && <SentinelLoader ref={playlistsSentinelRef as React.RefObject<HTMLDivElement>} />}
                    </>
                  )}
                </>
              )}

              {contentTab === 'profile' && userProfile && (
                <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
                  <div className="p-5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-4">Your Profile</p>

                    <div className="flex items-center gap-4 mb-5">
                      <Avatar className="w-16 h-16 border border-white/10">
                        <AvatarImage src={userProfile.avatar_url || undefined} />
                        <AvatarFallback className="bg-[#00ad74]/20 text-[#00ad74] font-black text-xl font-['Inter',sans-serif]">
                          {userProfile.display_name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <h3 className="font-black text-white text-lg truncate font-['Inter',sans-serif] leading-tight">
                          {userProfile.display_name}
                        </h3>
                        <p className="text-white/35 text-sm capitalize font-['Inter',sans-serif] mt-0.5">
                          {userProfile.role}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[#00ad74]/15 bg-[#00ad74]/5 p-4 mb-4 space-y-2">
                      <p className="text-white/60 text-xs font-bold uppercase tracking-widest font-['Inter',sans-serif]">Boost Benefits</p>
                      {['Increase profile visibility', 'Featured in recommendations', 'Attract more followers'].map((benefit) => (
                        <div key={benefit} className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#00ad74] flex-shrink-0" />
                          <p className="text-white/60 text-sm font-['Inter',sans-serif]">{benefit}</p>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => handlePromoteClick('profile', userProfile.id, userProfile.display_name)}
                      className="w-full py-4 rounded-2xl bg-[#00ad74] text-black text-sm font-black font-['Inter',sans-serif] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                    >
                      <Gift className="w-4 h-4" />
                      Boost My Profile
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-5 px-5 pb-0.5">
              {(['all', 'pending_approval', 'active', 'completed'] as const).map((filter) => {
                const filterLabels = { all: 'All', pending_approval: 'Pending', active: 'Active', completed: 'Done' };
                return (
                  <button
                    key={filter}
                    onClick={() => setPromotionFilter(filter)}
                    className={`flex-shrink-0 h-8 px-3.5 rounded-full font-semibold text-[11px] font-['Inter',sans-serif] transition-all active:scale-[0.96] ${
                      promotionFilter === filter
                        ? 'bg-white text-black'
                        : 'bg-white/[0.05] border border-white/[0.07] text-white/40 active:bg-white/[0.09]'
                    }`}
                  >
                    {filterLabels[filter]}
                  </button>
                );
              })}

              <button
                onClick={() => loadPromotions(true)}
                className="flex-shrink-0 w-8 h-8 rounded-full bg-white/[0.05] border border-white/[0.07] flex items-center justify-center active:bg-white/[0.09] transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-white/40 ${isLoadingPromotions ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {isLoadingPromotions ? (
              <div className="space-y-2.5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-3/4 rounded-lg bg-white/[0.05]" />
                        <Skeleton className="h-3 w-1/2 rounded-lg bg-white/[0.04]" />
                      </div>
                      <Skeleton className="h-6 w-16 rounded-full bg-white/[0.05]" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[1, 2, 3].map((j) => (
                        <Skeleton key={j} className="h-16 rounded-xl bg-white/[0.04]" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : promotions.length === 0 ? (
              <EmptyState icon={BarChart3} message="No campaigns yet. Boost content to start reaching more listeners." />
            ) : (
              <div className="space-y-3">
                {visiblePromotions.map((promotion) => {
                  const cfg = statusConfig[promotion.status] ?? statusConfig.deleted;
                  const canAct = !['cancelled', 'rejected', 'deleted'].includes(promotion.status);
                  const isPending = promotion.status === 'pending_approval' || promotion.status === 'pending';
                  const isActiveOrPaused = promotion.status === 'active' || promotion.status === 'paused';

                  return (
                    <div key={promotion.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
                      <div className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-white/90 text-sm truncate font-['Inter',sans-serif] leading-tight">
                              {promotion.target_title}
                            </h3>
                            <p className="text-white/30 text-xs mt-0.5 font-['Inter',sans-serif]">
                              {promotion.promotion_type} &bull; {promotion.promotion_sections?.section_name || 'General'}
                            </p>
                          </div>

                          <span className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold font-['Inter',sans-serif] border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
                            {cfg.label}
                          </span>
                        </div>

                        {isActiveOrPaused && (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                            <Clock className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
                            <span className="text-white/40 text-xs font-['Inter',sans-serif]">
                              {getRemainingTime(promotion.end_date)}
                            </span>
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { icon: Eye, label: 'Views', value: promotion.impressions_actual.toLocaleString(), color: 'text-white/50' },
                            { icon: MousePointer, label: 'Clicks', value: promotion.clicks.toLocaleString(), color: 'text-[#00ad74]' },
                            { icon: Coins, label: 'Cost', value: Number(promotion.treats_cost).toLocaleString(), color: 'text-yellow-400' },
                          ].map(({ icon: Icon, label, value, color }) => (
                            <div key={label} className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-3">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <Icon className={`w-3 h-3 ${color}`} />
                                <p className="text-white/25 text-[10px] font-['Inter',sans-serif]">{label}</p>
                              </div>
                              <p className={`font-black text-sm font-['Inter',sans-serif] ${color}`}>{value}</p>
                            </div>
                          ))}
                        </div>

                        {canAct && (
                          <div className="flex gap-2 pt-1">
                            {promotion.status === 'active' && (
                              <button
                                onClick={() => handlePausePromotion(promotion.id)}
                                disabled={actionLoading === promotion.id}
                                className="flex-1 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-bold font-['Inter',sans-serif] flex items-center justify-center gap-1.5 active:scale-[0.97] disabled:opacity-40 transition-all"
                              >
                                {actionLoading === promotion.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <><Pause className="w-3.5 h-3.5" /> Pause</>
                                )}
                              </button>
                            )}

                            {promotion.status === 'paused' && (
                              <button
                                onClick={() => handleResumePromotion(promotion.id)}
                                disabled={actionLoading === promotion.id}
                                className="flex-1 h-10 rounded-xl bg-[#00ad74]/10 border border-[#00ad74]/20 text-[#00ad74] text-xs font-bold font-['Inter',sans-serif] flex items-center justify-center gap-1.5 active:scale-[0.97] disabled:opacity-40 transition-all"
                              >
                                {actionLoading === promotion.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <><PlayCircle className="w-3.5 h-3.5" /> Resume</>
                                )}
                              </button>
                            )}

                            <button
                              onClick={() => handleDeletePromotionClick(promotion)}
                              disabled={actionLoading === promotion.id}
                              className="flex-1 h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold font-['Inter',sans-serif] flex items-center justify-center gap-1.5 active:scale-[0.97] disabled:opacity-40 transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              {isPending ? 'Delete (Refund)' : 'Delete'}
                            </button>
                          </div>
                        )}

                        {isPending && (
                          <div className="flex items-start gap-2 p-3 rounded-xl bg-[#00ad74]/5 border border-[#00ad74]/15">
                            <AlertCircle className="w-3.5 h-3.5 text-[#00ad74]/70 mt-0.5 flex-shrink-0" />
                            <p className="text-[#00ad74]/70 text-xs font-['Inter',sans-serif]">Full refund available if deleted</p>
                          </div>
                        )}

                        {isActiveOrPaused && (
                          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/5 border border-red-500/15">
                            <AlertCircle className="w-3.5 h-3.5 text-red-400/60 mt-0.5 flex-shrink-0" />
                            <p className="text-red-400/60 text-xs font-['Inter',sans-serif]">No refund if deleted</p>
                          </div>
                        )}

                        {promotion.status === 'completed' && (
                          <div className="flex items-start gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                            <AlertCircle className="w-3.5 h-3.5 text-white/25 mt-0.5 flex-shrink-0" />
                            <p className="text-white/25 text-xs font-['Inter',sans-serif]">Can be deleted for cleanup (no refund)</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {hasMorePromotions && <SentinelLoader ref={promotionsSentinelRef as React.RefObject<HTMLDivElement>} />}
              </div>
            )}
          </>
        )}
      </div>

      {showPromotionModal && selectedContent && (
        <PromotionSetupModal
          promotionType={selectedContent.type}
          targetId={selectedContent.id}
          targetTitle={selectedContent.title}
          onClose={() => {
            setShowPromotionModal(false);
            setSelectedContent(null);
          }}
          onSuccess={handlePromotionSuccess}
        />
      )}

      <CustomConfirmDialog
        isOpen={deleteConfirmData !== null}
        title="Delete Promotion?"
        message={`Are you sure you want to delete "${deleteConfirmData?.title}"?${deleteConfirmData?.status || ''}\n\nThis action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={handleDeletePromotion}
        onCancel={() => setDeleteConfirmData(null)}
        isLoading={actionLoading !== null}
      />

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} onSuccess={handleAuthSuccess} />
      )}
    </div>
  );
};
