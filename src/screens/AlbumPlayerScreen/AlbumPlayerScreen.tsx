import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Spinner } from '../../components/Spinner';
import {
  Heart,
  ArrowDownToLine,
  Play,
  Pause,
  Share2,
  MessageCircle,
  X,
  ChevronDown,
  SkipForward,
  SkipBack,
  Gift,
  Plus,
  Check,
  Flag,
  Shuffle
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import {
  supabase,
  isSongFavorited,
  toggleSongFavorite,
  isAlbumFavorited,
  toggleAlbumFavorite,
  isFollowing,
  followUser,
  unfollowUser,
  recordShareEvent,
  getFollowerCount,
  getUserPlaylistsForSong,
  toggleSongInPlaylist,
  getContentCommentsCount
} from '../../lib/supabase';
import { shareSong, shareAlbum } from '../../lib/shareService';
import { useAuth } from '../../contexts/AuthContext';
import { useAlert } from '../../contexts/AlertContext';
import { useOfflineSong } from '../../hooks/useOfflineSong';
import { deleteOfflineSong, downloadOfflineSong, isOfflineDownloadPlatformSupported } from '../../lib/offlineAudioService';
import { ensureOfflineDownloadAllowedWithPaywall } from '../../lib/offlineDownloadEntitlement';
import { CommentsModal, prefetchContentComments } from '../../components/CommentsModal';
import { TippingModal } from '../../components/TippingModal';
import { CreatePlaylistModal } from '../../components/CreatePlaylistModal';
import { ReportModal } from '../../components/ReportModal';
import { AuthModal } from '../../components/AuthModal';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useMusicPlayer } from '../../contexts/MusicPlayerContext';
import { useEngagementSync } from '../../hooks/useEngagementSync';
import { useAdPlacement } from '../../hooks/useAdPlacement';
import { usePlayerBottomBanner } from '../../hooks/usePlayerBottomBanner';
import { albumCache } from '../../lib/albumCache';
import { artistCache } from '../../lib/artistCache';
import { favoritesCache } from '../../lib/favoritesCache';
import { followsCache } from '../../lib/followsCache';
import { recordContribution } from '../../lib/contributionService';
import { isReleased, formatReleaseDateDisplay } from '../../lib/releaseDateUtils';
import {
  getNativeAdsForPlacement,
  prefetchAudioAdCompanionForPlacement,
  type NativeAdCard,
} from '../../lib/nativeAdService';
import { PlayerStaticAdBanner } from '../../components/PlayerStaticAdBanner';

interface AlbumTrack {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  duration: number;
  audioUrl: string | null;
  coverImageUrl?: string | null;
  featuredArtists?: string[];
  trackNumber: number;
  isFavorited?: boolean;
  playCount?: number;
}

interface AlbumData {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl: string | null;
  releaseDate?: string;
  description?: string;
  tracks: AlbumTrack[];
  totalDuration: number;
  playCount: number;
  followerCount?: number;
}

interface AlbumPlayerScreenProps {
  onPlayerVisibilityChange?: (isVisible: boolean) => void;
  onOpenMusicPlayer?: (song: any, playlist?: any[], context?: string) => void;
}

const AlbumPlayer: React.FC<AlbumPlayerScreenProps & {
  albumData: AlbumData;
  autoPlay?: boolean;
  startTrackIndex?: number;
  onShowAuthModal?: () => void;
}> = ({
  albumData,
  onPlayerVisibilityChange,
  autoPlay = true,
  startTrackIndex = 0,
  onShowAuthModal
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, isInitialized } = useAuth();
  const { showAlert, showConfirm } = useAlert();
  const playlistDropdownRef = useRef<HTMLDivElement>(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(startTrackIndex);
  const [isFollowingArtist, setIsFollowingArtist] = useState(false);
  const [isLoadingFollow, setIsLoadingFollow] = useState(false);
  const [isAlbumFavorited, setIsAlbumFavorited] = useState(false);
  const [showTrackList, setShowTrackList] = useState(true);
  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [artistFollowerCount, setArtistFollowerCount] = useState(0);
  const [artistProfile, setArtistProfile] = useState<any>(null);
  const [artistUserId, setArtistUserId] = useState<string | null>(null);
  const [showTippingModal, setShowTippingModal] = useState(false);
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] = useState(false);
  const [showPlaylistsDropdown, setShowPlaylistsDropdown] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState<any[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [shuffledPlaylist, setShuffledPlaylist] = useState<AlbumTrack[]>([]);
  const [originalPlaylist, setOriginalPlaylist] = useState<AlbumTrack[]>([]);
  const [tracks, setTracks] = useState<AlbumTrack[]>(albumData.tracks);
  const [inlineAd, setInlineAd] = useState<NativeAdCard | null>(null);
  const [showInlineAd, setShowInlineAd] = useState(false);
  const nativeAdTimersRef = useRef<{ show?: number; hide?: number }>({});

  const [isDownloadInProgress, setIsDownloadInProgress] = useState(false);

  const { showRewarded, showSongBonusRewarded, showBanner, hideBanner, removeBanner, showInterstitial } = useAdPlacement('AlbumPlayerScreen');
  const [showSongBonusPrompt, setShowSongBonusPrompt] = useState(false);
  const songsPlayedSinceInterstitialRef = useRef(0);
  const interstitialTimeoutRef = useRef<number | null>(null);

  const {
    currentSong,
    isPlaying,
    audioElement,
    playlistContext,
    playSong,
    togglePlayPause,
    hideFullPlayer,
    hideAllPlayers,
    playNext: globalPlayNext,
    playPrevious: globalPlayPrevious,
    isShuffleEnabled,
    repeatMode,
    toggleShuffle,
  } = useMusicPlayer();
  const thisAlbumContext = `album-${albumData.id}`;
  const isThisAlbumActive = playlistContext === thisAlbumContext;

  const currentTrack = tracks?.[currentTrackIndex] || null;
  const trackOfflineDownloaded = useOfflineSong(currentTrack?.id);
  const initialPathnameRef = useRef(location.pathname);

  // Close player when navigating to different routes (not within album routes)
  useEffect(() => {
    const mainRoutes = ['/', '/explore', '/library', '/create', '/profile'];
    // Only close if we're navigating away from the initial route
    if (location.pathname !== initialPathnameRef.current && mainRoutes.includes(location.pathname)) {
      handleClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Listen for global bonus events and surface a small user-initiated prompt.
  useEffect(() => {
    const handler = () => {
      setShowSongBonusPrompt(true);
    };
    window.addEventListener('globalSongBonusAvailable', handler as EventListener);
    return () => {
      window.removeEventListener('globalSongBonusAvailable', handler as EventListener);
    };
  }, []);

  usePlayerBottomBanner(
    'album_player_bottom_banner',
    showBanner,
    hideBanner,
    () => ({
      contentId: albumData?.id,
      contentType: 'album',
    }),
    [albumData?.id],
    true,
    0,
    false
  );

  // Auto interstitial: every 2 songs played in this album (trigger mid-way through the 2nd song).
  useEffect(() => {
    const currentTrack = tracks?.[currentTrackIndex] || null;
    if (!currentTrack?.id) return;

    songsPlayedSinceInterstitialRef.current += 1;
    const shouldTrigger = songsPlayedSinceInterstitialRef.current >= 2;
    if (!shouldTrigger) return;
    songsPlayedSinceInterstitialRef.current = 0;

    if (interstitialTimeoutRef.current != null) {
      window.clearTimeout(interstitialTimeoutRef.current);
      interstitialTimeoutRef.current = null;
    }

    const durationSeconds = typeof currentTrack.duration === 'number' && currentTrack.duration > 0 ? currentTrack.duration : undefined;
    const midMs = durationSeconds ? Math.max(12_000, Math.floor((durationSeconds * 1000) / 2)) : 30_000;

    interstitialTimeoutRef.current = window.setTimeout(() => {
      showInterstitial('album_midplay_interstitial', {
        contentId: currentTrack.id,
        contentType: 'song',
      }, { muteAppAudio: true }).catch(() => {});
    }, midMs);

    return () => {
      if (interstitialTimeoutRef.current != null) {
        window.clearTimeout(interstitialTimeoutRef.current);
        interstitialTimeoutRef.current = null;
      }
    };
  }, [currentTrackIndex, tracks, showInterstitial]);

  useEffect(() => {
    if (!isInitialized) return;

    if (albumData?.tracks?.length) {
      setTracks(prev => prev.map(track => ({
        ...track,
        isFavorited: track.isFavorited ?? favoritesCache.isSongFavorited(track.id)
      })));
    }

    // Load favorite status in background — don't block display (cache already set initial state)
    loadTrackFavoriteStatus().catch(() => {});
    loadAlbumFavoriteStatus().catch(() => {});

    // Initialize playlists
    if (albumData?.tracks) {
      setOriginalPlaylist(tracks);
      setShuffledPlaylist(tracks);
    }

    onPlayerVisibilityChange?.(true);
    window.dispatchEvent(new CustomEvent('albumPlayerVisibilityChange', {
      detail: { isVisible: true }
    }));

    if (autoPlay && albumData?.tracks && albumData.tracks.length > 0 && currentTrack?.audioUrl) {
      const albumPlaylist = tracks
        .filter(track => track.audioUrl)
        .map(track => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          artistId: track.artistId,
          coverImageUrl: track.coverImageUrl || albumData.coverImageUrl,
          audioUrl: track.audioUrl,
          duration: track.duration,
          playCount: 0
        }));

      if (albumPlaylist.length > 0) {
        const startPlayback = async () => {
          const targetSong = albumPlaylist[currentTrackIndex];
          if (!targetSong || isThisAlbumActive) {
            return;
          }

          try {
            await showRewarded('album_open_rewarded', {
              contentId: albumData.id,
              contentType: 'album',
            });
          } catch {
            // If ad fails or is skipped due to cooldown, still start playback
          }

          playSong(albumPlaylist[currentTrackIndex], false, albumPlaylist, currentTrackIndex, thisAlbumContext, albumData.id);
        };

        startPlayback().finally(() => {
          setTimeout(() => {
            hideFullPlayer();
          }, 100);
        });
      }
    }

    return () => {
      onPlayerVisibilityChange?.(false);
      window.dispatchEvent(new CustomEvent('albumPlayerVisibilityChange', {
        detail: { isVisible: false }
      }));
    };
  }, [onPlayerVisibilityChange, autoPlay, albumData]);

  // Sync tracks from parent when albumData updates (e.g. after engagement sync updates play counts)
  useEffect(() => {
    if (albumData?.tracks?.length) {
      setTracks(albumData.tracks);
    }
  }, [albumData?.tracks]);

  // Update local shuffled playlist when global shuffle state changes
  useEffect(() => {
    if (tracks) {
      if (isShuffleEnabled && tracks.length > 1) {
        const shuffled = [...tracks].sort(() => Math.random() - 0.5);
        setShuffledPlaylist(shuffled);
      } else {
        setShuffledPlaylist(tracks);
      }
    }
  }, [isShuffleEnabled, tracks]);

  useEffect(() => {
    console.log('[AlbumPlayerScreen] Album data changed:', {
      albumId: albumData?.id,
      title: albumData?.title,
      artist: albumData?.artist,
      artistId: albumData?.artistId
    });

    // Reset follow status when switching to a different artist
    setIsFollowingArtist(false);
    setArtistUserId(null);

    if (albumData?.artistId) {
      console.log('[AlbumPlayerScreen] Album has artistId, checking cache...');
      // Check artistCache first for instant display
      const cachedData = artistCache.getImmediate(albumData.artistId);
      console.log('[AlbumPlayerScreen] Immediate cache data:', cachedData);

      if (cachedData) {
        // Display cached data instantly (even if stale)
        console.log('[AlbumPlayerScreen] Using cached data for instant display');
        setArtistProfile(cachedData.profile);
        setArtistUserId(cachedData.userId);
        setArtistFollowerCount(cachedData.followerCount);
      } else {
        // Fallback to album cache data
        console.log('[AlbumPlayerScreen] Checking album cache for profile data...');
        const cachedProfile = (albumData as any)._cachedProfile;
        const cachedFollowerCount = (albumData as any)._cachedFollowerCount;
        console.log('[AlbumPlayerScreen] Album cached profile:', cachedProfile);
        console.log('[AlbumPlayerScreen] Album cached follower count:', cachedFollowerCount);

        if (cachedProfile) {
          setArtistProfile(cachedProfile);
          if (cachedProfile.id) {
            setArtistUserId(cachedProfile.id);
          }
        }

        if (cachedFollowerCount !== undefined) {
          setArtistFollowerCount(cachedFollowerCount);
        }
      }

      // Always refresh in background to ensure data is fresh
      console.log('[AlbumPlayerScreen] Calling loadArtistData in background...');
      loadArtistData();
    } else {
      console.log('[AlbumPlayerScreen] No artistId in album data');
    }
  }, [albumData]);

  // Check following status when artistUserId is available
  useEffect(() => {
    if (isAuthenticated && artistUserId) {
      checkFollowingStatus();
    }
  }, [isAuthenticated, artistUserId]);

  useEffect(() => {
    loadCommentCount();
  }, [currentTrackIndex]);

  useEffect(() => {
    if (!isThisAlbumActive) return;
    if (currentSong && tracks) {
      const trackIndex = tracks.findIndex(track => track.id === currentSong.id);
      if (trackIndex >= 0 && trackIndex !== currentTrackIndex) {
        setCurrentTrackIndex(trackIndex);
      }
    }
  }, [isThisAlbumActive, currentSong, albumData?.tracks, currentTrackIndex]);

  useEffect(() => {
    if (isThisAlbumActive && currentSong?.id === currentTrack?.id && !isPlaying && audioElement) {
      if (audioElement.readyState < 3) {
        setIsBuffering(true);
      } else {
        setIsBuffering(false);
      }
    } else {
      setIsBuffering(false);
    }
  }, [isPlaying, currentSong, currentTrack, audioElement]);

  useEffect(() => {
    if (!isThisAlbumActive || !isPlaying || !albumData?.id) return;
    prefetchContentComments(albumData.id, 'album').catch(() => {});
  }, [isThisAlbumActive, isPlaying, albumData?.id]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showPlaylistsDropdown && playlistDropdownRef.current && !playlistDropdownRef.current.contains(event.target as Node)) {
        setShowPlaylistsDropdown(false);
      }
    };

    if (showPlaylistsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPlaylistsDropdown]);

  // Global interstitials + bonus rewarded are handled in MusicPlayerContext; no album-specific song counter needed here.

  // Load a single inline native ad for album player (non-blocking)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ads = await getNativeAdsForPlacement('album_player', null, null, 1);
        if (!mounted) return;
        const visualOnlyAd =
          ads.find((ad) => !ad.audio_url || ad.audio_url.trim().length === 0) ?? null;
        setInlineAd(visualOnlyAd);
      } catch {
        if (!mounted) return;
        setInlineAd(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [albumData.id]);

  // Delay-show the native ad (up to ~60s), then auto-hide after 30s.
  useEffect(() => {
    setShowInlineAd(false);
    if (nativeAdTimersRef.current.show) window.clearTimeout(nativeAdTimersRef.current.show);
    if (nativeAdTimersRef.current.hide) window.clearTimeout(nativeAdTimersRef.current.hide);
    nativeAdTimersRef.current = {};

    if (!inlineAd) return;

    const minDelayMs = 5_000;
    const maxDelayMs = 60_000;
    const delayMs = Math.floor(minDelayMs + Math.random() * (maxDelayMs - minDelayMs));

    nativeAdTimersRef.current.show = window.setTimeout(() => {
      setShowInlineAd(true);
      nativeAdTimersRef.current.hide = window.setTimeout(() => {
        setShowInlineAd(false);
      }, 30_000);
    }, delayMs);

    return () => {
      if (nativeAdTimersRef.current.show) window.clearTimeout(nativeAdTimersRef.current.show);
      if (nativeAdTimersRef.current.hide) window.clearTimeout(nativeAdTimersRef.current.hide);
      nativeAdTimersRef.current = {};
    };
  }, [inlineAd, albumData.id]);

  // Preload likely audio-ad companion art for album placement so the first overlay paints faster.
  useEffect(() => {
    if (!albumData?.id) return;
    const country =
      typeof user?.user_metadata?.country === 'string' ? user.user_metadata.country : null;
    void prefetchAudioAdCompanionForPlacement('album_player', country);
  }, [albumData?.id, user?.user_metadata?.country]);

  // Load user country and static ad
  // Static inline banner ads removed from full-screen album player to avoid floating banners over scrolling content

  const checkFollowingStatus = async () => {
    if (!artistUserId || !isAuthenticated) return;

    try {
      const following = await isFollowing(artistUserId);
      setIsFollowingArtist(following);
    } catch (error) {
      console.error('Error checking following status:', error);
    }
  };

  const loadArtistData = async () => {
    console.log('[AlbumPlayerScreen] loadArtistData called for artistId:', albumData.artistId);
    console.log('[AlbumPlayerScreen] Album:', { id: albumData.id, title: albumData.title, artist: albumData.artist });

    if (!albumData.artistId) {
      console.log('[AlbumPlayerScreen] No artistId provided');
      return;
    }

    try {
      // Use artistCache for persistent data across component unmounts
      console.log('[AlbumPlayerScreen] Fetching from artistCache...');
      const cachedData = await artistCache.get(albumData.artistId);
      console.log('[AlbumPlayerScreen] Cached data received:', cachedData);

      if (cachedData) {
        console.log('[AlbumPlayerScreen] Updating state with cached data:', {
          profile: cachedData.profile,
          userId: cachedData.userId,
          followerCount: cachedData.followerCount
        });
        setArtistProfile(cachedData.profile);
        setArtistUserId(cachedData.userId);
        setArtistFollowerCount(cachedData.followerCount);
      } else {
        console.log('[AlbumPlayerScreen] No cached data available');
      }
    } catch (error) {
      console.error('[AlbumPlayerScreen] Error loading artist data:', error);
    }
  };

  const loadTrackFavoriteStatus = async () => {
    if (!isAuthenticated || !albumData?.tracks || albumData.tracks.length === 0) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const songIds = albumData.tracks.map(track => track.id);

      const { data: favorites, error } = await supabase
        .from('user_favorites')
        .select('song_id')
        .eq('user_id', user.id)
        .in('song_id', songIds);

      if (error) {
        console.error('Error loading favorites:', error);
        return;
      }

      const favoritedSongIds = new Set(favorites?.map(fav => fav.song_id) || []);

      const tracksWithFavorites = albumData.tracks.map(track => ({
        ...track,
        isFavorited: favoritedSongIds.has(track.id)
      }));

      setTracks(tracksWithFavorites);
    } catch (error) {
      console.error('Error loading track favorite status:', error);
    }
  };

  const loadAlbumFavoriteStatus = async () => {
    if (!isAuthenticated || !albumData?.id) return;

    try {
      const isFavorited = await isAlbumFavorited(albumData.id);
      setIsAlbumFavorited(isFavorited);
    } catch (error) {
      console.error('Error loading album favorite status:', error);
    }
  };

  // Re-check album favorite status when album or auth changes (e.g. when returning to screen).
  // Use favoritesCache first so the heart stays correct when leaving and returning (cache is updated on toggle).
  useEffect(() => {
    if (!albumData?.id) return;
    setIsAlbumFavorited(favoritesCache.isAlbumFavorited(albumData.id));
    loadAlbumFavoriteStatus();
  }, [albumData?.id, isAuthenticated]);

  // Restore follow state from followsCache when artist userId is available (persists when leaving/returning)
  useEffect(() => {
    if (artistUserId && isAuthenticated) {
      setIsFollowingArtist(followsCache.isFollowing(artistUserId));
    } else if (!isAuthenticated) {
      setIsFollowingArtist(false);
    }
  }, [artistUserId, isAuthenticated]);

  const loadCommentCount = async () => {
    if (!albumData?.id) return;
    try {
      const count = await getContentCommentsCount(albumData.id, 'album');
      setCommentCount(count);
    } catch (error) {
      console.error('Error loading comment count:', error);
    }
  };

  const playTrack = (trackIndex: number) => {
    const track = tracks?.[trackIndex];
    if (!track || !track.audioUrl) {
      alert('Track not available');
      return;
    }

    if (isThisAlbumActive && currentSong?.id === track.id) {
      togglePlayPause();
      setCurrentTrackIndex(trackIndex);
      return;
    }

    setCurrentTrackIndex(trackIndex);
    setIsBuffering(true);

    const albumPlaylist = tracks
      .filter(t => t.audioUrl)
      .map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        artistId: t.artistId,
        coverImageUrl: t.coverImageUrl || albumData.coverImageUrl,
        audioUrl: t.audioUrl,
        duration: t.duration,
        playCount: 0
      }));

    const playlistIndex = albumPlaylist.findIndex(song => song.id === track.id);

    if (playlistIndex >= 0) {
      playSong(albumPlaylist[playlistIndex], false, albumPlaylist, playlistIndex, thisAlbumContext, albumData.id);

      setTimeout(() => {
        hideFullPlayer();
        setIsBuffering(false);
      }, 200);
    }
  };

  const playNextTrack = () => {
    // Use global player next so audio-ad insertion cadence matches MusicPlayerScreen.
    globalPlayNext();
  };

  const playPreviousTrack = () => {
    globalPlayPrevious();
  };

  const handleToggleShuffle = () => {
    toggleShuffle();
  };

  const handleToggleFollow = async () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    if (!artistUserId) return;

    setIsLoadingFollow(true);
    try {
      if (isFollowingArtist) {
        await unfollowUser(artistUserId);
        setIsFollowingArtist(false);
        setArtistFollowerCount(prev => Math.max(0, prev - 1));
        // Update cache
        if (albumData.artistId) {
          artistCache.updateFollowerCount(albumData.artistId, -1);
        }
      } else {
        await followUser(artistUserId);
        setIsFollowingArtist(true);
        setArtistFollowerCount(prev => prev + 1);
        // Update cache
        if (albumData.artistId) {
          artistCache.updateFollowerCount(albumData.artistId, 1);
        }
        // Track artist follow for contribution rewards
        recordContribution('artist_follow', artistUserId, 'artist').catch(console.error);
      }
    } catch (error) {
      console.error('Error toggling follow status:', error);
      if (error instanceof Error && error.message.includes('not authenticated')) {
        setShowAuthModal(true);
      } else {
        alert('Failed to update follow status. Please try again.');
      }
    } finally {
      setIsLoadingFollow(false);
    }
  };

  const handleToggleAlbumFavorite = async () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    if (albumData?.id) {
      const previousState = isAlbumFavorited;
      setIsAlbumFavorited(!isAlbumFavorited);

      try {
        const isFavorited = await toggleAlbumFavorite(albumData.id);
        setIsAlbumFavorited(isFavorited);

        // Track engagement contribution when user likes album
        if (isFavorited && !previousState) {
          recordContribution('song_like', albumData.id, 'album').catch(console.error);
        }
      } catch (error) {
        setIsAlbumFavorited(previousState);
        console.error('Error toggling album favorite:', error);
        alert('Failed to update favorite status');
      }
    }
  };

  const handleToggleTrackFavorite = async (trackId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    const previousFavoritedState = Boolean(track.isFavorited);

    setTracks(prev =>
      prev.map(t => (t.id === trackId ? { ...t, isFavorited: !previousFavoritedState } : t))
    );

    try {
      const newFavoriteStatus = await toggleSongFavorite(trackId);

      setTracks(prev =>
        prev.map(t => (t.id === trackId ? { ...t, isFavorited: newFavoriteStatus } : t))
      );

      // Track engagement contribution when user likes track
      if (newFavoriteStatus && !previousFavoritedState) {
        recordContribution('song_like', trackId, 'song').catch(console.error);
      }
    } catch (error) {
      setTracks(prev =>
        prev.map(t => (t.id === trackId ? { ...t, isFavorited: previousFavoritedState } : t))
      );

      console.error('Error toggling track favorite:', error);
      alert('Failed to update favorite status');
    }
  };

  const handleDownloadAlbum = async () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    if (!currentTrack?.audioUrl) {
      showAlert({
        title: 'Cannot Download',
        message: 'This track cannot be downloaded',
        type: 'error'
      });
      return;
    }

    if (!isOfflineDownloadPlatformSupported()) {
      showAlert({
        title: 'Offline downloads',
        message: 'Saving music for offline listening is available in the Android app.',
        type: 'info'
      });
      return;
    }

    if (trackOfflineDownloaded) {
      await deleteOfflineSong(currentTrack.id);
      showAlert({
        title: 'Download Removed',
        message: 'Track removed from offline downloads',
        type: 'success'
      });
      return;
    }

    setIsDownloadInProgress(true);
    try {
      const allowed = await ensureOfflineDownloadAllowedWithPaywall(showConfirm, showAlert);
      if (!allowed) return;

      await downloadOfflineSong(
        {
          songId: currentTrack.id,
          title: currentTrack.title,
          artist: currentTrack.artist,
          coverImageUrl: currentTrack.coverImageUrl || albumData.coverImageUrl || null,
          durationSeconds: typeof currentTrack.duration === 'number' ? currentTrack.duration : null,
        },
        currentTrack.audioUrl
      );
      showAlert({
        title: 'Download Complete',
        message: 'Track saved for offline listening on this device.',
        type: 'success'
      });
    } catch (error) {
      console.error('Error downloading track:', error);
      showAlert({
        title: 'Download Failed',
        message: error instanceof Error ? error.message : 'Failed to download track. Please try again.',
        type: 'error'
      });
    } finally {
      setIsDownloadInProgress(false);
    }
  };

  const handleShareAlbum = () => {
    shareAlbum(albumData.id, albumData.title, albumData.artist).catch((error) => {
      console.error('Error sharing album:', error);
    });
    recordShareEvent(albumData.id, 'album').catch((error) => {
      console.error('Error recording share event:', error);
    });
  };

  const handleShareTrack = (track: AlbumTrack, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering track play
    shareSong(track.id, track.title, track.artist).catch((error) => {
      console.error('Error sharing track:', error);
    });
    recordShareEvent(track.id, 'song').catch((error) => {
      console.error('Error recording share event:', error);
    });
  };

  const handleClose = () => {
    hideFullPlayer();
    onPlayerVisibilityChange?.(false);
    window.dispatchEvent(new CustomEvent('albumPlayerVisibilityChange', {
      detail: { isVisible: false }
    }));
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const handleOpenArtistProfile = () => {
    if (!artistUserId) return;
    hideFullPlayer();
    onPlayerVisibilityChange?.(false);
    window.dispatchEvent(new CustomEvent('albumPlayerVisibilityChange', {
      detail: { isVisible: false }
    }));
    navigate(`/user/${artistUserId}`);
  };

  const handleAddToPlaylist = async () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    if (!currentSong) return;

    setIsLoadingPlaylists(true);
    try {
      const playlists = await getUserPlaylistsForSong(currentSong.id);
      setUserPlaylists(playlists);
      setShowPlaylistsDropdown(true);
    } catch (error) {
      console.error('Error loading playlists:', error);
    } finally {
      setIsLoadingPlaylists(false);
    }
  };

  const handleToggleSongInPlaylist = async (playlistId: string) => {
    if (!currentSong) return;

    try {
      await toggleSongInPlaylist(playlistId, currentSong.id);

      setUserPlaylists(prevPlaylists =>
        prevPlaylists.map(playlist =>
          playlist.id === playlistId
            ? { ...playlist, hasSong: !playlist.hasSong }
            : playlist
        )
      );
    } catch (error) {
      console.error('Error toggling song in playlist:', error);
      alert('Failed to update playlist');
    }
  };

  const handleCreatePlaylistSuccess = () => {
    setShowCreatePlaylistModal(false);
    if (showPlaylistsDropdown && currentSong) {
      handleAddToPlaylist();
    }
  };

  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours} hr ${minutes} min`;
    }
    return `${minutes} min`;
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  const shouldShowFollowButton = Boolean(albumData.artistId) && Boolean(user?.id) && user?.id !== artistUserId;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a] animate-in fade-in duration-300 touch-manipulation overflow-hidden pb-[env(safe-area-inset-bottom,0px)]">
      {/* Main Content — scrollable, seamless with header */}
      <div
        className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide"
        style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div
          className="flex-1 flex flex-col px-3 pb-4"
          style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)' }}
        >
          <div className="-ml-1 px-3 mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2">
              <button
                onClick={handleClose}
                className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all active:scale-95 flex-shrink-0"
                aria-label="Close player"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
              <div
                className="min-w-0 flex items-center gap-2 cursor-pointer active:scale-95 transition-transform"
                onClick={handleOpenArtistProfile}
              >
                <Avatar className="w-9 h-9 flex-shrink-0">
                  <AvatarImage src={artistProfile?.avatar_url || artistProfile?.profile_photo_url || undefined} />
                  <AvatarFallback className="bg-[#00ad74] text-white font-semibold text-xs">
                    {(albumData.artist || 'A').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 text-left">
                  <h3 className="font-bold text-white text-sm truncate leading-tight">
                    {albumData.artist || 'Unknown Artist'}
                  </h3>
                  <p className="text-white/60 text-[11px] truncate">
                    {formatNumber(artistFollowerCount)} followers
                  </p>
                </div>
              </div>
            </div>

            {shouldShowFollowButton ? (
              <button
                onClick={handleToggleFollow}
                disabled={isLoadingFollow || !artistUserId}
                aria-label={
                  !artistUserId
                    ? 'Loading follow status'
                    : isAuthenticated && isFollowingArtist
                      ? 'Unfollow artist'
                      : 'Follow artist'
                }
                className="inline-flex items-center justify-center px-3 py-1.5 rounded-full font-semibold text-[11px] bg-white text-[#0a0a0a] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingFollow || !artistUserId ? (
                  <Spinner size={12} className="text-[#0a0a0a]" />
                ) : (
                  isAuthenticated && isFollowingArtist ? 'Following' : 'Follow'
                )}
              </button>
            ) : null}
          </div>

          {/* Album Artwork / Inline Native Ad Slot */}
          <div className="px-3 py-4 flex-1 min-h-0">
            {inlineAd && showInlineAd ? (
              <PlayerStaticAdBanner
                ad={inlineAd}
                className="w-full rounded-2xl shadow-lg"
              />
            ) : (
              <div className="relative rounded-2xl overflow-hidden bg-white/5 w-full aspect-square shadow-lg">
                {albumData.coverImageUrl ? (
                  <img
                    src={albumData.coverImageUrl}
                    alt={albumData.title}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-white/5">
                    <span className="text-4xl font-bold text-white/30">♪</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Album Information */}
          <div className="px-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-white truncate leading-tight">
                {albumData.title}
              </h2>
              <p className="text-sm text-white/70 mt-0.5 truncate">
                {tracks?.length} tracks • {formatDuration(albumData.totalDuration)}
              </p>
            </div>
            <button
              onClick={() => {
                if (!isAuthenticated) setShowAuthModal(true);
                else setShowTippingModal(true);
              }}
              className="flex-shrink-0 p-1.5 mt-0.5 text-white/70 hover:text-white transition-colors"
            >
              <Gift className="w-5 h-5" />
            </button>
          </div>

          {/* Playback Controls */}
          <div className="flex items-center justify-center gap-6 px-3 pt-4 pb-2">
            <button
              onClick={handleToggleAlbumFavorite}
              className={cn(
                'hover:scale-110 p-1 transition-all',
                isAlbumFavorited ? 'text-red-500' : 'text-white/80 hover:text-white'
              )}
              aria-label={isAlbumFavorited ? 'Unlike album' : 'Like album'}
            >
              <Heart className={cn('w-5 h-5', isAlbumFavorited && 'fill-red-500')} />
            </button>
            <button onClick={playPreviousTrack} className="text-white hover:scale-110 active:scale-95 transition-transform p-1" aria-label="Previous track">
              <SkipBack className="w-6 h-6 fill-current" />
            </button>
            <button
              onClick={() => playTrack(currentTrackIndex)}
              className="w-14 h-14 rounded-full flex items-center justify-center bg-white text-[#0a0a0a] hover:scale-[1.06] active:scale-95 transition-all duration-200 shadow-lg"
              aria-label={isThisAlbumActive && isPlaying && currentSong?.id === currentTrack?.id ? 'Pause' : 'Play'}
            >
              {isBuffering ? (
                <Spinner size={20} className="text-[#0a0a0a]" />
              ) : isThisAlbumActive && isPlaying && currentSong?.id === currentTrack?.id ? (
                <Pause className="w-6 h-6" />
              ) : (
                <Play className="w-6 h-6 ml-0.5" />
              )}
            </button>
            <button onClick={playNextTrack} className="text-white hover:scale-110 active:scale-95 transition-transform p-1" aria-label="Next track">
              <SkipForward className="w-6 h-6 fill-current" />
            </button>
            <button
              onClick={() => setShowCommentsModal(true)}
              className="text-white/80 hover:text-white hover:scale-110 p-1 transition-all relative"
              aria-label="Comments"
            >
              <MessageCircle className="w-5 h-5" />
              {commentCount > 0 && (
                <span className="absolute -top-1 -right-1.5 text-[10px] font-bold text-white/80 tabular-nums">
                  {commentCount >= 1_000_000 ? `${(commentCount / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : commentCount >= 1_000 ? `${(commentCount / 1_000).toFixed(1).replace(/\.0$/, '')}K` : commentCount}
                </span>
              )}
            </button>
          </div>

          {/* Actions row — white icons; report red */}
          <div className="flex items-center justify-between px-3 pb-5">
            <div className="flex items-center gap-1">
              <div className="relative" ref={playlistDropdownRef}>
                <button
                  onClick={handleAddToPlaylist}
                  disabled={isLoadingPlaylists}
                  className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all disabled:opacity-50"
                  title="Add to playlist"
                >
                  {isLoadingPlaylists ? <Spinner size={18} className="text-white" /> : <Plus className="w-[18px] h-[18px]" />}
                </button>
                {showPlaylistsDropdown && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowPlaylistsDropdown(false)} aria-hidden />
                    <div className="absolute bottom-full left-0 mb-2 z-50 w-64 rounded-2xl bg-[#141414] shadow-2xl overflow-hidden">
                      <div className="px-4 py-3">
                        <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Add to playlist</p>
                      </div>
                      {userPlaylists.length === 0 && !isLoadingPlaylists ? (
                        <div className="px-4 py-6 text-white/50 text-sm text-center">No playlists yet. Create one below.</div>
                      ) : (
                        <div className="max-h-52 overflow-y-auto py-1">
                          {userPlaylists.map(playlist => (
                            <button
                              key={playlist.id}
                              onClick={() => handleToggleSongInPlaylist(playlist.id)}
                              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-white hover:bg-white/10 active:bg-white/15 transition-colors text-left rounded-xl mx-2"
                            >
                              <span className="truncate font-medium">{playlist.title}</span>
                              {playlist.hasSong && <Check className="w-5 h-5 text-[#00ad74] flex-shrink-0" />}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="p-2">
                        <button
                          onClick={() => { setShowPlaylistsDropdown(false); setShowCreatePlaylistModal(true); }}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-[#00ad74] hover:bg-[#009c68] text-white font-semibold text-sm transition-colors"
                        >
                          <Plus className="w-5 h-5" />
                          Create new playlist
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={handleShareAlbum}
                className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all"
                title="Share"
              >
                <Share2 className="w-[18px] h-[18px]" />
              </button>
              {currentTrack?.audioUrl ? (
                <button
                  type="button"
                  onClick={() => void handleDownloadAlbum()}
                  disabled={isDownloadInProgress}
                  className={cn(
                    'p-2 rounded-full transition-colors disabled:opacity-50',
                    trackOfflineDownloaded
                      ? 'shrink-0 hover:bg-red-500/20 active:bg-red-500/25'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  )}
                  title={trackOfflineDownloaded ? 'Remove offline download' : 'Download for offline'}
                >
                  {isDownloadInProgress ? (
                    <Spinner size={18} className="text-white" />
                  ) : trackOfflineDownloaded ? (
                    <X className="w-3.5 h-3.5 text-white/50" aria-hidden />
                  ) : (
                    <ArrowDownToLine className="w-[18px] h-[18px]" />
                  )}
                </button>
              ) : null}
              <button
                onClick={handleToggleShuffle}
                className={cn(
                  'p-2 rounded-full transition-all active:scale-95',
                  isShuffleEnabled
                    ? 'text-[#00ad74] bg-[#00ad74]/20'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                )}
                aria-label="Shuffle"
                title="Shuffle"
              >
                <Shuffle className="w-[18px] h-[18px]" />
              </button>
              <button
                onClick={() => setShowReportModal(true)}
                className="p-2 rounded-full text-red-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                title="Report"
              >
                <Flag className="w-[18px] h-[18px]" />
              </button>
            </div>
            {albumData.playCount != null && albumData.playCount > 0 && (
              <div className="flex items-center gap-1.5 text-white/60 text-xs">
                <Play className="w-3.5 h-3.5" fill="currentColor" />
                <span className="font-semibold text-white">{formatNumber(albumData.playCount)}</span>
                <span>plays</span>
              </div>
            )}
          </div>

          {/* song_bonus ~every 1.5 songs; rewarded interstitial every 3. Claim → VITE_ADMOB_REWARDED_ID */}
          {showSongBonusPrompt && (
            <div className="mt-3 mb-2 flex items-center justify-between gap-3 rounded-2xl bg-white/10 border border-white/15 px-3 py-2 shadow-lg">
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold text-white">Get bonus score</span>
                <span className="text-[10px] text-white/70">Watch a short ad to earn extra listener score.</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowSongBonusPrompt(false);
                  if (!currentTrack?.id) return;
                  showSongBonusRewarded({ contentId: currentTrack.id }).catch(() => {});
                }}
                className="px-3 py-1.5 rounded-full bg-white text-[11px] font-semibold text-black active:scale-95 hover:opacity-90 transition-all"
              >
                Claim
              </button>
            </div>
          )}

          {/* Track List */}
          <div className="rounded-2xl bg-white/[0.04] overflow-hidden">
            <div className="px-3 py-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-sans font-bold text-white text-lg">Tracks</h2>
                <button
                  onClick={() => setShowTrackList(!showTrackList)}
                  className="text-white/60 hover:text-white text-sm transition-colors"
                >
                  {showTrackList ? 'Hide' : 'Show'}
                </button>
              </div>

              {showTrackList && (
                <div className="space-y-1">
                  {tracks && tracks.length > 0 ? tracks.map((track, index) => (
                    <div
                      key={track.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-xl transition-all cursor-pointer group',
                        isThisAlbumActive && currentSong?.id === track.id
                          ? 'bg-white/10'
                          : 'hover:bg-white/5'
                      )}
                      onClick={() => playTrack(index)}
                    >
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold',
                        isThisAlbumActive && currentSong?.id === track.id ? 'bg-[#00ad74] text-white' : 'bg-white/10 text-white/60'
                      )}>
                        {isThisAlbumActive && currentSong?.id === track.id && isPlaying ? (
                          <Pause className="w-4 h-4" fill="currentColor" />
                        ) : (
                          <span>{track.trackNumber || (index + 1)}</span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'font-medium text-sm truncate',
                          isThisAlbumActive && currentSong?.id === track.id ? 'text-white' : 'text-white/90'
                        )}>
                          {track.title || 'Untitled Track'}
                        </p>
                        <p className="text-white/50 text-xs truncate">
                          {track.featuredArtists && track.featuredArtists.length > 0
                            ? `${track.artist} ft. ${track.featuredArtists.join(', ')}`
                            : track.artist
                          }
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isAuthenticated && (
                          <button
                            onClick={(e) => handleToggleTrackFavorite(track.id, e)}
                            className="p-1.5 rounded-full transition-all hover:bg-white/10"
                            aria-label={track.isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                          >
                            <Heart className={cn('w-4 h-4 transition-all duration-[50ms]', track.isFavorited ? 'text-red-500 fill-red-500' : 'text-white/70')} />
                          </button>
                        )}

                        <button
                          onClick={(e) => handleShareTrack(track, e)}
                          className="p-1.5 rounded-full transition-all hover:bg-white/10 active:scale-95"
                          aria-label="Share song"
                        >
                          <Share2 className="w-4 h-4 text-white/70" />
                        </button>

                        <span className="text-white/50 text-xs w-10 text-right tabular-nums">
                          {formatTime(track.duration)}
                        </span>
                      </div>
                    </div>
                  )) : (
                    <div className="text-center py-12">
                      <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Play className="w-8 h-8 text-white/30" />
                      </div>
                      <p className="text-white/50">No tracks available</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showCommentsModal && (
        <CommentsModal
          contentId={albumData.id}
          contentType="album"
          contentTitle={albumData.title}
          onClose={() => {
            setShowCommentsModal(false);
            loadCommentCount();
          }}
        />
      )}

      {showTippingModal && (
        <TippingModal
          onClose={() => setShowTippingModal(false)}
          onSuccess={() => setShowTippingModal(false)}
          recipientId={albumData.artistId || currentTrack?.artistId || undefined}
          recipientName={artistProfile?.display_name || albumData.artist}
          recipientAvatar={artistProfile?.avatar_url || albumData.coverImageUrl}
          contentId={currentTrack?.id || albumData.id}
          contentType="album"
        />
      )}

      {showCreatePlaylistModal && (
        <CreatePlaylistModal
          onClose={() => setShowCreatePlaylistModal(false)}
          onSuccess={handleCreatePlaylistSuccess}
          initialSongId={currentSong?.id}
        />
      )}

      {showReportModal && (
        <ReportModal
          contentType="album"
          contentId={albumData.id}
          contentTitle={albumData.title}
          reportedUserId={albumData.artistId}
          onClose={() => setShowReportModal(false)}
          onSuccess={() => {
            setShowReportModal(false);
          }}
        />
      )}

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
          }}
        />
      )}

      <style>{`
        * {
          -webkit-tap-highlight-color: transparent;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -khtml-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
        }

        .touch-manipulation {
          touch-action: manipulation;
        }
      `}</style>
    </div>
  );
};

export const AlbumPlayerScreen: React.FC<AlbumPlayerScreenProps> = ({ onPlayerVisibilityChange, onOpenMusicPlayer }) => {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const [albumData, setAlbumData] = useState<AlbumData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEngagementSync(useCallback((update) => {
    if (update.metric === 'play_count' && update.contentType === 'song') {
      setAlbumData(prev => {
        if (!prev) return prev;
        const newTracks = prev.tracks.map(t => t.id === update.contentId ? { ...t, playCount: update.value } : t);
        const newPlayCount = newTracks.reduce((sum, t) => sum + (t.playCount ?? 0), 0);
        return { ...prev, tracks: newTracks, playCount: newPlayCount };
      });
    }
  }, []));

  useEffect(() => {
    if (!albumId) {
      setError('Album ID is required');
      return;
    }

    onPlayerVisibilityChange?.(true);

    // Try to load from cache first for instant display
    const cached = albumCache.get(albumId);
    if (cached) {
      setAlbumData(cached);
      // Refresh in background
      loadAlbumData();
    } else {
      // Load immediately if not cached
      loadAlbumData();
    }

    return () => {
      onPlayerVisibilityChange?.(false);
    };
  }, [albumId]);

  const loadAlbumData = async () => {
    if (!albumId) return;

    try {
      setError(null);

      // Fetch album, songs, and artist profile in parallel for instant display
      const [albumResult, songsResult] = await Promise.all([
        supabase
          .from('albums')
          .select(`
            id,
            title,
            artist_id,
            cover_image_url,
            release_date,
            description,
            artists:artist_id (
              id,
              name,
              artist_profiles!artist_profiles_artist_id_fkey (
                stage_name,
                user_id,
                users:user_id (
                  id,
                  display_name,
                  avatar_url
                )
              )
            )
          `)
          .eq('id', albumId)
          .single(),
        supabase
          .from('songs')
          .select(`
            id,
            title,
            artist_id,
            cover_image_url,
            audio_url,
            duration_seconds,
            play_count,
            created_at,
            featured_artists,
            artists:artist_id (
              id,
              name,
              artist_profiles!artist_profiles_artist_id_fkey (
                stage_name,
                user_id,
                users:user_id (
                  display_name
                )
              )
            )
          `)
          .eq('album_id', albumId)
          .order('created_at', { ascending: true })
      ]);

      if (albumResult.error) throw albumResult.error;
      if (!albumResult.data) throw new Error('Album not found');
      if (songsResult.error) throw songsResult.error;

      const albumInfo = albumResult.data;
      const songsData = songsResult.data;

      console.log('Album Info:', albumInfo);
      console.log('Album Artists:', albumInfo.artists);

      const albumArtists = albumInfo.artists as any;
      let artistName = 'Unknown Artist';
      let extractedArtistProfile: any = null;

      if (albumArtists) {
        // Handle both array and single object responses
        const artist = Array.isArray(albumArtists) ? albumArtists[0] : albumArtists;

        // Try to get artist name from multiple sources
        if (artist) {
          // Check if artist_profiles exists and has data
          const artistProfiles = artist.artist_profiles;
          if (artistProfiles && Array.isArray(artistProfiles) && artistProfiles.length > 0) {
            const profile = artistProfiles[0];
            artistName = profile?.stage_name ||
                        profile?.users?.display_name ||
                        artist?.name ||
                        'Unknown Artist';

            // Extract profile data for instant header display
            if (profile?.users) {
              extractedArtistProfile = {
                id: profile.users.id,
                display_name: profile.users.display_name,
                avatar_url: profile.users.avatar_url
              };
            }
          } else {
            // Fallback to artist name directly
            artistName = artist?.name || 'Unknown Artist';
          }
        }
      }

      console.log('Resolved Artist Name:', artistName);

      const tracks: AlbumTrack[] = (songsData || []).map((song: any, index) => {
        // Get artist name from song, fallback to album artist
        let songArtistName = artistName;
        if (song.artists) {
          const songArtist = Array.isArray(song.artists) ? song.artists[0] : song.artists;

          if (songArtist) {
            const songArtistProfiles = songArtist.artist_profiles;
            if (songArtistProfiles && Array.isArray(songArtistProfiles) && songArtistProfiles.length > 0) {
              songArtistName = songArtistProfiles[0]?.stage_name ||
                              songArtistProfiles[0]?.users?.display_name ||
                              songArtist?.name ||
                              artistName;
            } else {
              songArtistName = songArtist?.name || artistName;
            }
          }
        }

        return {
          id: song.id,
          title: song.title,
          artist: songArtistName,
          artistId: song.artist_id,
          duration: song.duration_seconds || 0,
          audioUrl: song.audio_url,
          coverImageUrl: song.cover_image_url || albumInfo.cover_image_url,
          trackNumber: index + 1,
          featuredArtists: song.featured_artists || [],
          playCount: song.play_count || 0
        };
      });

      const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);

      if (albumInfo.release_date && !isReleased(albumInfo.release_date)) {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        let isOwner = false;
        if (currentUser) {
          const { data: profile } = await supabase
            .from('artist_profiles')
            .select('artist_id')
            .eq('user_id', currentUser.id)
            .maybeSingle();
          isOwner = profile?.artist_id === albumInfo.artist_id;
        }
        if (!isOwner) {
          setError(`This album isn't released yet. It drops on ${formatReleaseDateDisplay(albumInfo.release_date)}.`);
          return;
        }
      }

      const album: AlbumData = {
        id: albumInfo.id,
        title: albumInfo.title,
        artist: artistName,
        artistId: albumInfo.artist_id,
        coverImageUrl: albumInfo.cover_image_url,
        releaseDate: albumInfo.release_date,
        description: albumInfo.description,
        tracks,
        totalDuration,
        playCount: tracks.reduce((sum, track) => sum + (track.playCount || 0), 0)
      };

      setAlbumData(album);

      // Cache the loaded data for instant future access
      // Include extracted profile data for faster subsequent loads
      albumCache.set(albumId, {
        ...album,
        _cachedProfile: extractedArtistProfile
      });
    } catch (err) {
      console.error('Failed to load album:', err);
      setError(err instanceof Error ? err.message : 'Album not found');
    }
  };

  // Only show error state - no loading skeleton for instant feel
  if (error) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0a] z-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <Flag className="w-8 h-8 text-red-400" />
          </div>
          <h3 className="font-bold text-white text-xl mb-4">Album Not Found</h3>
          <p className="text-white/60 text-sm mb-6">
            {error || 'The album you\'re looking for doesn\'t exist or has been removed.'}
          </p>
          <button
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="px-6 py-2.5 rounded-full bg-white text-[#0a0a0a] font-semibold text-sm hover:opacity-90 active:scale-95 transition-all"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const handleShowAuthModal = () => {
    window.dispatchEvent(new CustomEvent('openAuthModal'));
  };

  // No second loading screen: while fetching album data, show same loader as route (Suspense) for one continuous load
  if (!albumData) {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-b from-[#0a0a0a] via-[#0d0d0d] to-[#111111] flex items-center justify-center">
        <div className="relative">
          <img
            src="/official_airaplay_logo.png"
            alt="Loading"
            className="w-32 h-32 object-contain drop-shadow-2xl"
            style={{ animation: 'breathe 3s ease-in-out infinite' }}
          />
          <div className="absolute inset-0 -z-10 blur-3xl opacity-30 bg-white scale-75 animate-pulse" />
        </div>
        <style>{`
          @keyframes breathe {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.05); opacity: 0.9; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <AlbumPlayer
      albumData={albumData}
      autoPlay={false}
      startTrackIndex={0}
      onPlayerVisibilityChange={onPlayerVisibilityChange}
      onShowAuthModal={handleShowAuthModal}
      onOpenMusicPlayer={onOpenMusicPlayer}
    />
  );
};
