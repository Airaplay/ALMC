import { useState, useEffect, useRef } from 'react';
import { Spinner } from '../../components/Spinner';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  UserPlus,
  UserMinus,
  Share2,
  Music,
  Play,
  Video,
  AlertCircle,
  List,
  Heart,
  MessageCircle,
  Youtube,
  Instagram,
  Flag,
  Edit,
  Trash2,
  MoreVertical,
  Link2,
} from 'lucide-react';
import { TreatTipButton } from '../../components/TreatTipButton';
import { ReportModal } from '../../components/ReportModal';
import { EditContentModal } from '../../components/EditContentModal';
import { BottomActionSheet } from '../../components/BottomActionSheet';
import { AuthModal } from '../../components/AuthModal';

const TikTokIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
  </svg>
);

const FacebookIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);
import {
  supabase,
  getPublicUserProfile,
  isFollowing,
  followUser,
  unfollowUser,
  recordShareEvent,
  toggleSongFavorite,
} from '../../lib/supabase';
import { shareProfile } from '../../lib/shareService';
import { persistentCache } from '../../lib/persistentCache';
import { recordContribution } from '../../lib/contributionService';

interface ContentUpload {
  id: string;
  title: string;
  content_type: string;
  status: string;
  created_at: string;
  metadata: {
    audio_url?: string;
    video_url?: string;
    cover_url?: string;
    thumbnail_url?: string;
    duration_seconds?: number;
    album_id?: string;
    song_id?: string;
  };
  play_count?: number;
}

interface Song {
  id: string;
  title: string;
  artist_id: string;
  duration_seconds: number;
  audio_url: string | null;
  cover_image_url: string | null;
  play_count: number;
  created_at: string;
  albums?: {
    id: string;
    title: string;
    cover_image_url: string | null;
  }[];
}

interface Album {
  id: string;
  title: string;
  cover_image_url: string | null;
  release_date: string | null;
  created_at: string;
  song_count: number;
  total_duration: number;
}

interface Playlist {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  is_public: boolean;
  created_at: string;
  song_count: number;
}

interface PublicProfileData {
  user: any;
  artistProfile: any;
  socialLinks: any[];
  uploads: ContentUpload[];
  followerCount: number;
  followingCount: number;
  verifiedBadgeUrl?: string | null;
}

interface PublicProfileScreenProps {
  onOpenMusicPlayer?: (song: any) => void;
  isMiniPlayerVisible?: boolean;
  onTippingModalVisibilityChange?: (isVisible: boolean) => void;
}

const PROFILE_CACHE_PREFIX = 'public_profile_';
const SONGS_CACHE_PREFIX = 'profile_songs_';
const VIDEOS_CACHE_PREFIX = 'profile_videos_';
const PLAYLISTS_CACHE_PREFIX = 'profile_playlists_';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const PublicProfileScreen = ({ onOpenMusicPlayer, isMiniPlayerVisible = false, onTippingModalVisibilityChange }: PublicProfileScreenProps): JSX.Element => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const isInitialMount = useRef(true);

  const [profileData, setProfileData] = useState<PublicProfileData | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isCurrentUserFollowing, setIsCurrentUserFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'music' | 'videos' | 'clips' | 'playlists'>('music');

  const [userSongs, setUserSongs] = useState<Song[]>([]);
  const [userAlbums, setUserAlbums] = useState<Album[]>([]);
  const [userVideos, setUserVideos] = useState<ContentUpload[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<Playlist[]>([]);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [isFavorited, setIsFavorited] = useState<Record<string, boolean>>({});
  const [musicFilter, setMusicFilter] = useState<'singles' | 'albums'>('singles');
  const [showReportModal, setShowReportModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [editingContent, setEditingContent] = useState<ContentUpload | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{show: boolean, contentId: string | null, contentType: string | null}>({show: false, contentId: null, contentType: null});
  const [showActionSheet, setShowActionSheet] = useState<{isOpen: boolean, contentId: string | null, contentType: string | null}>({isOpen: false, contentId: null, contentType: null});

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId) {
      setError('Invalid user ID');
      setIsLoading(false);
      return;
    }

    checkCurrentUserAndLoadProfile();
  }, [userId]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkFavorites();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (profileData && activeTab) {
      loadTabContent();
    }
  }, [activeTab]);

  const checkCurrentUserAndLoadProfile = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const authUserPromise = supabase.auth.getUser();
      const profileDataPromise = getPublicUserProfile(userId!);

      const [authResult, data] = await Promise.all([authUserPromise, profileDataPromise]);
      const authUser = authResult.data.user;

      setCurrentUser(authUser);
      setProfileData(data);
      setIsLoading(false);

      const initialTab = (data.user.role === 'creator' || data.user.role === 'admin') ? 'music' : 'clips';
      setActiveTab(initialTab);

      if (authUser && userId) {
        isFollowing(userId).then(status => setIsCurrentUserFollowing(status));
        checkFavorites();
      }

      if (initialTab === 'music') {
        loadUserMusic();
      } else if (initialTab === 'clips') {
        loadUserClips();
      }
    } catch (err: any) {
      console.error('Error loading public profile:', err);
      setError(err.message || 'Failed to load profile');
      setIsLoading(false);
    }
  };

  const checkFavorites = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('user_favorites')
        .select('song_id')
        .eq('user_id', session.user.id);

      if (error) throw error;

      const favMap: Record<string, boolean> = {};
      data?.forEach(fav => {
        favMap[fav.song_id] = true;
      });
      setIsFavorited(favMap);
    } catch (err) {
      console.error('Error checking favorites:', err);
    }
  };

  const loadTabContent = async () => {
    if (!profileData || !userId) return;

    setContentError(null);

    try {
      switch (activeTab) {
        case 'music':
          loadUserMusic();
          break;
        case 'videos':
          loadUserVideos();
          break;
        case 'clips':
          loadUserClips();
          break;
        case 'playlists':
          loadUserPlaylists();
          break;
      }
    } catch (err) {
      console.error(`Error loading ${activeTab} content:`, err);
      setContentError(`Failed to load ${activeTab}`);
    }
  };

  const loadUserMusic = async () => {
    try {
      const { data: singleUploadsData, error: singlesError } = await supabase
        .from('content_uploads')
        .select('id, title, metadata, created_at, play_count')
        .eq('user_id', userId)
        .eq('content_type', 'single')
        .eq('status', 'approved')
        .order('created_at', { ascending: false });

      if (singlesError) throw singlesError;

      // Fetch actual play counts from songs table for songs that have song_id in metadata
      const songIds = (singleUploadsData || [])
        .map((upload: any) => upload.metadata?.song_id)
        .filter((id: string | undefined): id is string => !!id);

      let playCountMap: Record<string, number> = {};
      if (songIds.length > 0) {
        const { data: songsData } = await supabase
          .from('songs')
          .select('id, play_count')
          .in('id', songIds);

        if (songsData) {
          songsData.forEach((song: any) => {
            playCountMap[song.id] = song.play_count || 0;
          });
        }
      }

      const formattedSingles = singleUploadsData?.map((upload: any) => {
        const songId = upload.metadata?.song_id || upload.id;
        // Use play_count from songs table if available, otherwise fallback to content_uploads play_count
        const playCount = playCountMap[songId] ?? upload.play_count ?? 0;

        return {
          id: songId,
          title: upload.title,
          duration_seconds: upload.metadata?.duration_seconds || 0,
          audio_url: upload.metadata?.audio_url,
          cover_image_url: upload.metadata?.cover_url,
          play_count: playCount,
          created_at: upload.created_at,
          artist_id: userId || '',
          albums: undefined
        };
      }) || [];

      setUserSongs(formattedSingles);

      const { data: artistProfile, error: profileError } = await supabase
        .from('artist_profiles')
        .select('artist_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileError || !artistProfile || !artistProfile.artist_id) {
        setUserAlbums([]);
        return;
      }

      const { data: albumsData, error: albumsError } = await supabase
        .from('albums')
        .select('id, title, cover_image_url, release_date, created_at')
        .eq('artist_id', artistProfile.artist_id)
        .order('created_at', { ascending: false });

      if (albumsError) throw albumsError;

      if (albumsData && albumsData.length > 0) {
        const albumIds = albumsData.map(a => a.id);
        const { data: allSongs } = await supabase
          .from('songs')
          .select('album_id, duration_seconds')
          .in('album_id', albumIds);

        const songsByAlbum: Record<string, any[]> = {};
        allSongs?.forEach(song => {
          if (!songsByAlbum[song.album_id]) {
            songsByAlbum[song.album_id] = [];
          }
          songsByAlbum[song.album_id].push(song);
        });

        const processedAlbums = albumsData.map((album: any) => {
          const albumSongs = songsByAlbum[album.id] || [];
          const totalDuration = albumSongs.reduce((sum, song) => sum + (song.duration_seconds || 0), 0);
          const songCount = albumSongs.length;

          return {
            ...album,
            song_count: songCount,
            total_duration: totalDuration,
          };
        });

        setUserAlbums(processedAlbums);
      } else {
        setUserAlbums([]);
      }
    } catch (err) {
      console.error('Error loading user music:', err);
      throw err;
    }
  };

  const loadUserVideos = async () => {
    try {
      const { data, error } = await supabase
        .from('content_uploads')
        .select('*')
        .eq('user_id', userId)
        .eq('content_type', 'video')
        .eq('status', 'approved')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUserVideos(data || []);
    } catch (err) {
      console.error('Error loading user videos:', err);
      throw err;
    }
  };

  const loadUserClips = async () => {
    try {
      const { data, error } = await supabase
        .from('content_uploads')
        .select('*')
        .eq('user_id', userId)
        .eq('content_type', 'short_clip')
        .eq('status', 'approved')
        .order('created_at', { ascending: false });

      if (error) throw error;
      // setUserClips(data || []); // Clips tab not yet implemented
    } catch (err) {
      console.error('Error loading user clips:', err);
      throw err;
    }
  };

  const loadUserPlaylists = async () => {
    try {
      let query = supabase
        .from('playlists')
        .select('id, title, description, cover_image_url, is_public, created_at, playlist_songs (count)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!isOwnProfile) {
        query = query.eq('is_public', true);
      }

      const { data, error } = await query;

      if (error) throw error;

      const processedPlaylists = (data || []).map((playlist: any) => ({
        ...playlist,
        song_count: playlist.playlist_songs?.[0]?.count || 0,
      }));

      setUserPlaylists(processedPlaylists);
    } catch (err) {
      console.error('Error loading user playlists:', err);
      throw err;
    }
  };

  const handleFollowToggle = async () => {
    if (!userId || isFollowLoading) return;

    if (!currentUser) {
      setShowAuthModal(true);
      return;
    }

    setIsFollowLoading(true);
    try {
      if (isCurrentUserFollowing) {
        await unfollowUser(userId);
        setIsCurrentUserFollowing(false);
        if (profileData) {
          setProfileData({
            ...profileData,
            followerCount: Math.max(0, profileData.followerCount - 1),
          });
        }
      } else {
        await followUser(userId);
        setIsCurrentUserFollowing(true);
        if (profileData) {
          setProfileData({
            ...profileData,
            followerCount: profileData.followerCount + 1,
          });
        }
        // Track artist follow for contribution rewards
        recordContribution('artist_follow', userId, 'artist').catch(console.error);
      }
    } catch (err: any) {
      console.error('Error toggling follow status:', err);
      alert(err.message || 'Failed to update follow status');
    } finally {
      setIsFollowLoading(false);
    }
  };

  const handleShareProfile = async () => {
    if (!profileData) return;

    try {
      await recordShareEvent(userId!, 'profile');
    } catch (error) {
      console.error('Error recording share event:', error);
    }

    try {
      const userName = profileData.user.display_name || profileData.user.email || 'User';
      await shareProfile(userId!, userName);
    } catch (error) {
      console.error('Error sharing profile:', error);
    }
  };

  const handleContentClick = (content: ContentUpload | Song | Album | Playlist, type: string) => {
    switch (type) {
      case 'song':
        if (onOpenMusicPlayer && 'audio_url' in content) {
          const songContent = content as Song;
          const artistName = profileData?.artistProfile?.stage_name || profileData?.user.display_name || 'Unknown Artist';

          const formattedSong = {
            id: songContent.id,
            title: songContent.title,
            artist: artistName,
            artistId: songContent.artist_id,
            coverImageUrl: songContent.cover_image_url,
            audioUrl: songContent.audio_url,
            duration: songContent.duration_seconds,
            playCount: songContent.play_count || 0,
          };

          // Include all singles from this creator so users can skip through them
          // After all singles finish, player will automatically check for albums
          const formattedPlaylist = userSongs.map(song => ({
            id: song.id,
            title: song.title,
            artist: artistName,
            artistId: song.artist_id,
            coverImageUrl: song.cover_image_url,
            audioUrl: song.audio_url,
            duration: song.duration_seconds,
            playCount: song.play_count || 0,
          }));

          const context = `profile-${userId}-singles`;

          onOpenMusicPlayer(formattedSong, formattedPlaylist, context);
        }
        break;
      case 'album':
        navigate(`/album/${content.id}`);
        break;
      case 'video':
        navigate(`/video/${content.id}`);
        break;
      case 'clip':
        navigate(`/loops/${content.id}`);
        break;
      case 'playlist':
        navigate(`/playlist/${content.id}`);
        break;
    }
  };

  const handleToggleFavorite = async (songId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const previousState = isFavorited[songId];
      setIsFavorited(prev => ({ ...prev, [songId]: !previousState }));

      const newState = await toggleSongFavorite(songId);
      setIsFavorited(prev => ({ ...prev, [songId]: newState }));
    } catch (err) {
      console.error('Error toggling favorite:', err);
      const previousState = isFavorited[songId];
      setIsFavorited(prev => ({ ...prev, [songId]: previousState }));
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEditContent = async (contentId: string) => {
    try {
      const { data, error } = await supabase
        .from('content_uploads')
        .select('*')
        .eq('id', contentId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setEditingContent(data);
      } else {
        alert('Content not found');
      }
    } catch (err: any) {
      console.error('Error fetching content for edit:', err);
      alert(err.message || 'Failed to load content details');
    }
  };

  const handleDeleteContent = async (contentId: string, contentType: string) => {
    setShowDeleteConfirm({ show: true, contentId, contentType });
  };

  const confirmDelete = async () => {
    if (!showDeleteConfirm.contentId) return;

    try {
      const { error } = await supabase
        .from('content_uploads')
        .delete()
        .eq('id', showDeleteConfirm.contentId);

      if (error) throw error;

      alert('Content deleted successfully');
      setShowDeleteConfirm({ show: false, contentId: null, contentType: null });

      loadTabContent();
    } catch (err: any) {
      console.error('Error deleting content:', err);
      alert(err.message || 'Failed to delete content');
    }
  };

  const isCreator = profileData?.user.role === 'creator' || profileData?.user.role === 'admin';
  const isOwnProfile = currentUser?.id === userId;
  const isPrivateProfile = profileData?.user.profile_visibility === 'private';

  // Show error only if there's a real error and no data
  if (!isLoading && error && !profileData) {
    return (
      <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav overflow-y-auto">
        <style>{`
          @supports (padding: max(0px)) {
            .safe-area-inset-x {
              padding-left: max(20px, env(safe-area-inset-left));
              padding-right: max(20px, env(safe-area-inset-right));
            }
          }
        `}</style>
        <header className="w-full py-3 px-5 safe-area-inset-x sticky top-0 z-20 bg-[#1a1a1a]/95 backdrop-blur-md border-b border-white/5">
          <div className="flex items-center justify-between gap-3">
            <button onClick={() => navigate(-1)} className="p-2.5 active:scale-95 active:bg-white/20 hover:bg-white/10 rounded-full transition-all duration-200 flex-shrink-0 touch-manipulation">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h1 className="font-semibold text-base truncate flex-1 text-center">Profile</h1>
            <div className="w-10 flex-shrink-0"></div>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center px-6 safe-area-inset-x">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
            <h3 className="font-semibold text-lg text-gray-300 mb-2">Profile Not Found</h3>
            <p className="text-gray-500 text-sm mb-6">{error || 'Unable to load profile'}</p>
            <button
              onClick={() => navigate(-1)}
              className="px-6 py-3 bg-white text-black rounded-full active:scale-95 hover:scale-105 transition-transform font-semibold touch-manipulation"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Always show screen structure, even while loading
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav overflow-y-auto">
      <style>{`
        @supports (padding: max(0px)) {
          .safe-area-inset-x {
            padding-left: max(20px, env(safe-area-inset-left));
            padding-right: max(20px, env(safe-area-inset-right));
          }
        }
      `}</style>
      <header className="w-full py-3 px-5 safe-area-inset-x sticky top-0 z-20 bg-[#1a1a1a]/95 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="p-2.5 active:scale-95 active:bg-white/20 hover:bg-white/10 rounded-full transition-all duration-200 flex-shrink-0 touch-manipulation"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="font-semibold text-base truncate flex-1 text-center">
            Profile
          </h1>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={handleShareProfile}
              className="p-2.5 active:scale-95 active:bg-white/20 hover:bg-white/10 rounded-full transition-all duration-200 touch-manipulation"
              aria-label="Share profile"
            >
              <Share2 className="w-5 h-5" />
            </button>
            {!isOwnProfile && (
              <button
                onClick={() => setShowReportModal(true)}
                className="p-2.5 active:scale-95 active:bg-white/20 hover:bg-white/10 rounded-full transition-all duration-200 touch-manipulation"
                aria-label="Report user"
              >
                <Flag className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {!profileData && isLoading ? (
        <div className="px-5 py-6 safe-area-inset-x">
          <div className="flex items-start gap-5 mb-6">
            <div className="w-24 h-24 rounded-full bg-white/5 animate-pulse" />
            <div className="flex-1 min-w-0 space-y-3">
              <div className="h-7 w-48 bg-white/5 rounded animate-pulse" />
              <div className="h-4 w-32 bg-white/5 rounded animate-pulse" />
              <div className="flex gap-5">
                <div className="h-4 w-24 bg-white/5 rounded animate-pulse" />
                <div className="h-4 w-24 bg-white/5 rounded animate-pulse" />
              </div>
            </div>
          </div>
          <div className="space-y-2 mb-6">
            <div className="h-4 w-full bg-white/5 rounded animate-pulse" />
            <div className="h-4 w-3/4 bg-white/5 rounded animate-pulse" />
          </div>
          <div className="flex gap-2 mb-6">
            <div className="h-10 flex-1 bg-white/5 rounded-full animate-pulse" />
            <div className="h-10 w-20 bg-white/5 rounded-full animate-pulse" />
          </div>
          <div className="flex gap-2 mb-6 overflow-x-auto scrollbar-hide">
            <div className="h-9 w-24 bg-white/5 rounded-full animate-pulse" />
            <div className="h-9 w-24 bg-white/5 rounded-full animate-pulse" />
            <div className="h-9 w-24 bg-white/5 rounded-full animate-pulse" />
          </div>
          <div className="grid grid-cols-3 gap-3 pt-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <div className="w-full aspect-square rounded-lg bg-white/5 animate-pulse mb-2" />
                <div className="h-3 w-full bg-white/5 rounded animate-pulse mb-1" />
                <div className="h-2 w-2/3 bg-white/5 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ) : profileData ? (
        <div className="px-5 py-5 safe-area-inset-x">
          <div className="flex items-start gap-4 mb-5">
            <div className="relative w-20 h-20 rounded-full overflow-hidden bg-white/5 flex-shrink-0 shadow-xl border border-white/10">
              {profileData.user.avatar_url ? (
              <img
                src={profileData.user.avatar_url}
                alt={profileData.user.display_name || 'Profile'}
                className="w-full h-full object-cover"
                loading="lazy"
                style={{ willChange: 'transform' }}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-white/20 to-white/5 flex items-center justify-center">
                <span className="text-3xl font-bold text-white">
                  {(profileData.user.display_name || profileData.user.email || 'U').charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <h2 className="text-xl font-bold text-white truncate">
                {profileData.user.display_name || 'Anonymous'}
              </h2>
              {isCreator && profileData.artistProfile?.is_verified && (
                profileData.verifiedBadgeUrl ? (
                  <img
                    src={profileData.verifiedBadgeUrl}
                    alt="Verified Creator"
                    className="w-5 h-5 flex-shrink-0 object-contain"
                    loading="lazy"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      img.style.display = 'none';
                    }}
                  />
                ) : (
                  <BadgeCheck className="w-5 h-5 text-[#309605] fill-[#309605] flex-shrink-0" />
                )
              )}
            </div>

            {profileData.user.username && (
              <p className="text-white/60 text-sm mb-3">@{profileData.user.username}</p>
            )}

            <div className="flex items-center gap-5 text-sm">
              <div>
                <span className="font-bold text-white">{formatNumber(profileData.followerCount)}</span>
                <span className="text-white/60 ml-1">Followers</span>
              </div>
              <div>
                <span className="font-bold text-white">{formatNumber(profileData.followingCount)}</span>
                <span className="text-white/60 ml-1">Following</span>
              </div>
            </div>
          </div>
        </div>

        {(profileData.artistProfile?.bio || profileData.user.bio) && (
          <p className="text-white/70 text-sm mb-4 leading-relaxed break-words px-0.5">
            {profileData.artistProfile?.bio || profileData.user.bio}
          </p>
        )}

        {profileData.user.social_media_platform && profileData.user.social_media_url && (
          <div className="mb-3 w-full flex justify-center">
            <a
              href={profileData.user.social_media_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 py-1.5 active:opacity-50 hover:opacity-70 transition-opacity duration-200 touch-manipulation"
            >
              <Link2 className="w-3.5 h-3.5 text-white/60 flex-shrink-0" />
              <span className="text-xs text-white/70 font-normal truncate max-w-xs">
                {profileData.user.social_media_url}
              </span>
            </a>
          </div>
        )}

        {profileData.socialLinks && profileData.socialLinks.length > 0 && (
          <div className="flex flex-col items-center gap-1.5 justify-center w-full mb-5">
            {profileData.socialLinks.map((link: any) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 py-1.5 active:opacity-50 hover:opacity-70 transition-opacity duration-200 touch-manipulation"
              >
                <Link2 className="w-3.5 h-3.5 text-white/60 flex-shrink-0" />
                <span className="text-white/70 text-xs font-normal truncate max-w-xs">
                  {link.url}
                </span>
              </a>
            ))}
          </div>
        )}

        {!isOwnProfile && (
          <div className="flex items-center gap-2 mb-5">
            <button
              onClick={handleFollowToggle}
              disabled={isFollowLoading}
              className={`flex-1 h-11 rounded-full text-sm font-semibold active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-1.5 touch-manipulation ${
                currentUser && isCurrentUserFollowing
                  ? 'bg-white/10 hover:bg-white/20 border border-white/20 text-white'
                  : 'bg-white text-black hover:bg-white/90'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isFollowLoading ? (
                <Spinner size={16} className="text-white" />
              ) : currentUser && isCurrentUserFollowing ? (
                <>
                  <UserMinus className="w-4 h-4 flex-shrink-0" />
                  <span className="whitespace-nowrap">Following</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 flex-shrink-0" />
                  <span className="whitespace-nowrap">Follow</span>
                </>
              )}
            </button>
            {currentUser && (
              <>
                <TreatTipButton
                  recipientId={userId!}
                  className="h-11 w-11 bg-white active:scale-95 hover:bg-white/90 rounded-full flex items-center justify-center transition-all duration-200 f{formatEarnings(userProfile?.total_earnings || 0)}lex-shrink-0 touch-manipulation"
                  iconOnly={true}
                  onModalVisibilityChange={onTippingModalVisibilityChange}
                />
                {!isPrivateProfile && (
                  <button
                    onClick={async () => {
                      if (!userId || !currentUser) return;

                      try {
                        const { getOrCreateThread } = await import('../../lib/supabase');
                        const threadId = await getOrCreateThread(currentUser.id, userId);
                        if (threadId) {
                          navigate(`/messages/${threadId}`);
                        } else {
                          throw new Error('Failed to create message thread');
                        }
                      } catch (err: any) {
                        console.error('Error opening message thread:', err);
                        alert(err.message || 'Failed to open message thread');
                      }
                    }}
                    className="h-11 w-11 bg-white active:scale-95 hover:bg-white/90 rounded-full flex items-center justify-center transition-all duration-200 f{formatEarnings(userProfile?.total_earnings || 0)}lex-shrink-0 touch-manipulation"
                    aria-label="Send message"
                  >
                    <MessageCircle className="w-4 h-4 text-black" />
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {isCreator && (!isPrivateProfile || isOwnProfile) && (
          <div className="overflow-x-auto scrollbar-hide mb-5">
            <div className="flex justify-center gap-2 min-w-max px-1">
              <button
                onClick={() => setActiveTab('music')}
                className={`px-5 py-2.5 rounded-full text-sm font-semibold active:scale-95 transition-all duration-200 whitespace-nowrap touch-manipulation ${
                  activeTab === 'music' ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                Music
              </button>
              <button
                onClick={() => setActiveTab('videos')}
                className={`px-5 py-2.5 rounded-full text-sm font-semibold active:scale-95 transition-all duration-200 whitespace-nowrap touch-manipulation ${
                  activeTab === 'videos' ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                Videos
              </button>
              <button
                onClick={() => setActiveTab('playlists')}
                className={`px-5 py-2.5 rounded-full text-sm font-semibold active:scale-95 transition-all duration-200 whitespace-nowrap touch-manipulation ${
                  activeTab === 'playlists' ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                Playlists
              </button>
            </div>
          </div>
        )}
      </div>
      ) : null}

      {profileData && (!isPrivateProfile || isOwnProfile) && (
        <div className="flex-1 px-5 pb-6 safe-area-inset-x" ref={scrollRef}>
        {contentError ? (
          <div className="text-center py-10">
            <p className="text-red-400 text-sm mb-4">{contentError}</p>
            <button
              onClick={loadTabContent}
              className="px-6 py-2.5 bg-white/10 active:scale-95 hover:bg-white/20 rounded-full text-sm font-medium transition-all duration-200 touch-manipulation"
            >
              Try Again
            </button>
          </div>
        ) : activeTab === 'music' ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">Music</h3>
              <div className="flex bg-white/10 rounded-full p-0.5">
                <button
                  onClick={() => setMusicFilter('singles')}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold active:scale-95 transition-all duration-200 touch-manipulation ${
                    musicFilter === 'singles' ? 'bg-white text-black' : 'text-white/70 hover:text-white'
                  }`}
                >
                  Singles
                </button>
                <button
                  onClick={() => setMusicFilter('albums')}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold active:scale-95 transition-all duration-200 touch-manipulation ${
                    musicFilter === 'albums' ? 'bg-white text-black' : 'text-white/70 hover:text-white'
                  }`}
                >
                  Albums
                </button>
              </div>
            </div>

            {musicFilter === 'singles' ? (
              !isLoadingContent && userSongs.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Music className="w-8 h-8 text-white/60" />
                  </div>
                  <h3 className="font-semibold text-lg text-gray-300 mb-2">No Singles Yet</h3>
                  <p className="text-gray-500 text-sm">This artist hasn&apos;t uploaded any singles yet</p>
                </div>
              ) : userSongs.length > 0 ? (
                <div className="grid grid-cols-3 gap-2.5">
                  {userSongs.map((song) => (
                    <div key={song.id} className="cursor-pointer group">
                      <div className="relative">
                        <div
                          onClick={() => handleContentClick(song, 'song')}
                          className="relative w-full aspect-square rounded-lg overflow-hidden mb-2 bg-white/5 active:scale-95 transition-transform duration-200 touch-manipulation"
                        >
                          <img
                            src={song.cover_image_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                            alt={song.title}
                            className="w-full h-full object-cover group-active:scale-105 transition-transform duration-200"
                            loading="lazy"
                            style={{ willChange: 'transform' }}
                          />
                          <div className="absolute inset-0 bg-black/0 group-active:bg-black/30 transition-colors duration-200 flex items-center justify-center">
                            <Play className="w-8 h-8 text-white opacity-0 group-active:opacity-100 transition-opacity duration-200" fill="white" />
                          </div>
                          {isOwnProfile && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowActionSheet({ isOpen: true, contentId: song.id, contentType: 'single' });
                              }}
                              className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/70 backdrop-blur-md flex items-center justify-center active:scale-90 active:bg-black/90 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/40 shadow-lg touch-manipulation"
                              aria-label="Content options"
                            >
                              <MoreVertical className="w-4 h-4 text-white" />
                            </button>
                          )}
                        </div>
                      </div>
                      <h4 className="text-xs font-medium text-white truncate">{song.title}</h4>
                    </div>
                  ))}
                </div>
              ) : null
            ) : (
              !isLoadingContent && userAlbums.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Music className="w-8 h-8 text-white/60" />
                  </div>
                  <h3 className="font-semibold text-lg text-gray-300 mb-2">No Albums Yet</h3>
                  <p className="text-gray-500 text-sm">This artist hasn&apos;t released any albums yet</p>
                </div>
              ) : userAlbums.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {userAlbums.map((album) => (
                    <div
                      key={album.id}
                      onClick={() => handleContentClick(album, 'album')}
                      className="cursor-pointer group active:scale-95 transition-transform duration-200 touch-manipulation"
                    >
                      <div className="relative w-full aspect-square rounded-lg overflow-hidden mb-2 bg-white/5">
                        <img
                          src={album.cover_image_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                          alt={album.title}
                          className="w-full h-full object-cover group-active:scale-105 transition-transform duration-200"
                          loading="lazy"
                          style={{ willChange: 'transform' }}
                        />
                        <div className="absolute inset-0 bg-black/0 group-active:bg-black/30 transition-colors duration-200 flex items-center justify-center">
                          <Play className="w-12 h-12 text-white opacity-0 group-active:opacity-100 transition-opacity duration-200" fill="white" />
                        </div>
                      </div>
                      <h4 className="text-sm font-semibold text-white truncate">{album.title}</h4>
                      <p className="text-xs text-gray-400">{album.song_count} tracks</p>
                    </div>
                  ))}
                </div>
              ) : null
            )}
          </div>
        ) : activeTab === 'videos' ? (
          !isLoadingContent && userVideos.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Video className="w-8 h-8 text-white/60" />
              </div>
              <h3 className="font-semibold text-lg text-gray-300 mb-2">No Videos Yet</h3>
              <p className="text-gray-500 text-sm">This creator hasn&apos;t uploaded any videos yet</p>
            </div>
          ) : userVideos.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {userVideos.map((video) => (
                <div key={video.id} className="cursor-pointer group">
                  <div className="relative">
                    <div
                      onClick={() => handleContentClick(video, 'video')}
                      className="relative w-full rounded-lg overflow-hidden bg-white/5 shadow-lg group-hover:shadow-2xl transition-all duration-300"
                    >
                      <div className="w-full aspect-video relative bg-black">
                        {video.metadata?.thumbnail_url ? (
                          <img
                            src={video.metadata.thumbnail_url}
                            alt={video.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-pink-600/20 to-red-600/20 flex items-center justify-center">
                            <Video className="w-10 h-10 text-pink-400" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>

                        {isOwnProfile && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowActionSheet({ isOpen: true, contentId: video.id, contentType: 'video' });
                            }}
                            className="absolute top-2 right-2 w-10 h-10 rounded-full bg-black/70 backdrop-blur-md flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/90 hover:scale-110 active:scale-95 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/40 focus:opacity-100 shadow-lg"
                            aria-label="Content options"
                          >
                            <MoreVertical className="w-5 h-5 text-white" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-2">
                      <h4 className="text-sm font-semibold text-white line-clamp-2 leading-tight">
                        {video.title}
                      </h4>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null
        ) : (
          !isLoadingContent && userPlaylists.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <List className="w-8 h-8 text-white/60" />
              </div>
              <h3 className="font-semibold text-lg text-gray-300 mb-2">No Playlists Yet</h3>
              <p className="text-gray-500 text-sm">This user hasn&apos;t created any public playlists yet</p>
            </div>
          ) : userPlaylists.length > 0 ? (
            <div className="space-y-3">
              {userPlaylists.map((playlist) => (
                <div
                  key={playlist.id}
                  onClick={() => handleContentClick(playlist, 'playlist')}
                  className="flex items-center gap-4 p-4 bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 rounded-xl transition-all duration-300 cursor-pointer group"
                >
                  <div className="w-14 h-14 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
                    {playlist.cover_image_url ? (
                      <img
                        src={playlist.cover_image_url}
                        alt={playlist.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <List className="w-6 h-6 text-white/60" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-base font-semibold text-white truncate group-hover:text-white transition-colors">
                      {playlist.title}
                    </h4>
                    <p className="text-sm text-white/60 truncate">
                      {playlist.description || `${playlist.song_count} songs`}
                    </p>
                  </div>
                  <Play className="w-5 h-5 text-white/60 flex-shrink-0" />
                </div>
              ))}
            </div>
          ) : null
        )}
      </div>
      )}

      {showReportModal && (
        <ReportModal
          contentType="user"
          contentId={userId!}
          contentTitle={profileData?.user.display_name || profileData?.user.username || 'User'}
          reportedUserId={userId}
          onClose={() => setShowReportModal(false)}
          onSuccess={() => {
            setShowReportModal(false);
            alert('Report submitted successfully. Our team will review it.');
          }}
        />
      )}

      {editingContent && (
        <EditContentModal
          upload={editingContent}
          onClose={() => {
            setEditingContent(null);
            loadTabContent();
          }}
          onSuccess={() => {
            setEditingContent(null);
            loadTabContent();
          }}
        />
      )}

      {showDeleteConfirm.show && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Delete Content</h3>
                <p className="text-sm text-white/60">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-white/80 text-sm mb-6">
              Are you sure you want to delete this content? All associated data will be permanently removed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm({ show: false, contentId: null, contentType: null })}
                className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 rounded-lg text-white font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomActionSheet
        isOpen={showActionSheet.isOpen}
        onClose={() => setShowActionSheet({ isOpen: false, contentId: null, contentType: null })}
        title="Content Options"
        actions={[
          {
            label: 'Edit',
            icon: <Edit className="w-5 h-5" />,
            onClick: async () => {
              if (showActionSheet.contentId) {
                if (showActionSheet.contentType === 'single') {
                  const { data } = await supabase
                    .from('content_uploads')
                    .select('*')
                    .eq('metadata->>song_id', showActionSheet.contentId)
                    .eq('content_type', 'single')
                    .maybeSingle();
                  if (data) {
                    handleEditContent(data.id);
                  }
                } else {
                  handleEditContent(showActionSheet.contentId);
                }
              }
            },
          },
          {
            label: 'Delete',
            icon: <Trash2 className="w-5 h-5" />,
            onClick: async () => {
              if (showActionSheet.contentId) {
                if (showActionSheet.contentType === 'single') {
                  const { data } = await supabase
                    .from('content_uploads')
                    .select('id')
                    .eq('metadata->>song_id', showActionSheet.contentId)
                    .eq('content_type', 'single')
                    .maybeSingle();
                  if (data) {
                    handleDeleteContent(data.id, 'single');
                  }
                } else {
                  handleDeleteContent(showActionSheet.contentId, showActionSheet.contentType || '');
                }
              }
            },
            variant: 'destructive' as const,
          },
        ]}
      />

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={async () => {
            setShowAuthModal(false);
            const { data: { user } } = await supabase.auth.getUser();
            setCurrentUser(user);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
};
