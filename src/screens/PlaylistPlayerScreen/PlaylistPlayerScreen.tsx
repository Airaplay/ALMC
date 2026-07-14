import React, { useState, useEffect, useRef } from 'react';
import {
  Heart,
  Play,
  Pause,
  Share2,
  MessageCircle,
  ArrowLeft,
  SkipForward,
  SkipBack,
  Flag,
  Shuffle,
  Repeat,
  Edit,
  Trash2,
  Music,
  Gift,
  ArrowDownToLine,
  X
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { sharePlaylist } from '../../lib/shareService';
import {
  supabase,
  isSongFavorited,
  toggleSongFavorite,
  recordShareEvent,
  getContentCommentsCount
} from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAlert } from '../../contexts/AlertContext';
import { useOfflineSong } from '../../hooks/useOfflineSong';
import { deleteOfflineSong, downloadOfflineSong, isOfflineDownloadPlatformSupported } from '../../lib/offlineAudioService';
import { ensureOfflineDownloadAllowedWithPaywall } from '../../lib/offlineDownloadEntitlement';
import { CommentsModal, prefetchContentComments } from '../../components/CommentsModal';
import { ReportModal } from '../../components/ReportModal';
import { TippingModal } from '../../components/TippingModal';
import { trackPlaylistPlayed, recordContribution } from '../../lib/contributionService';
import { EditPlaylistModal } from '../../components/EditPlaylistModal';
import { AuthModal } from '../../components/AuthModal';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useMusicPlayer } from '../../contexts/MusicPlayerContext';
import { playlistCache } from '../../lib/playlistCache';
import { LoadingLogo } from '../../components/LoadingLogo';
import { LazyImage } from '../../components/LazyImage';
import { useAdPlacement } from '../../hooks/useAdPlacement';
import { usePlayerBottomBanner } from '../../hooks/usePlayerBottomBanner';
import { favoritesCache } from '../../lib/favoritesCache';
import {
  getNativeAdsForPlacement,
  prefetchAudioAdCompanionForPlacement,
  type NativeAdCard,
} from '../../lib/nativeAdService';
import { PlayerStaticAdBanner } from '../../components/PlayerStaticAdBanner';

interface PlaylistTrack {
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
  addedAt?: string;
}

interface PlaylistData {
  id: string;
  title: string;
  description?: string;
  coverImageUrl: string | null;
  userId: string;
  userName?: string;
  userAvatar?: string;
  tracks: PlaylistTrack[];
  totalDuration: number;
  createdAt?: string;
  updatedAt?: string;
  isOwner: boolean;
}

interface PlaylistPlayerScreenProps {
  onPlayerVisibilityChange?: (isVisible: boolean) => void;
  onOpenMusicPlayer?: (song: any, playlist?: any[], context?: string) => void;
}

const PlaylistPlayer: React.FC<PlaylistPlayerScreenProps & {
  playlistData: PlaylistData;
  autoPlay?: boolean;
  startTrackIndex?: number;
  onShowAuthModal?: () => void;
  isListenerCurationsPlaylist?: boolean;
  onPlaylistUpdated?: () => void;
}> = ({
  playlistData,
  onPlayerVisibilityChange,
  autoPlay = true,
  startTrackIndex = 0,
  onShowAuthModal,
  isListenerCurationsPlaylist = false,
  onPlaylistUpdated
}) => {
  const navigate = useNavigate();
  const { user, isAuthenticated, isInitialized } = useAuth();
  const { showAlert, showConfirm } = useAlert();
  const [currentTrackIndex, setCurrentTrackIndex] = useState(startTrackIndex);
  const [showTrackList, setShowTrackList] = useState(true);
  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showTippingModal, setShowTippingModal] = useState(false);
  const [showEditPlaylistModal, setShowEditPlaylistModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [tracks, setTracks] = useState<PlaylistTrack[]>(playlistData.tracks);
  const [isMiniPlayerActive, setIsMiniPlayerActive] = useState(false);
  const [inlineAd, setInlineAd] = useState<NativeAdCard | null>(null);
  const [showInlineAd, setShowInlineAd] = useState(false);
  const nativeAdTimersRef = useRef<{ show?: number; hide?: number }>({});

  const [isDownloadInProgress, setIsDownloadInProgress] = useState(false);

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
    toggleRepeat: globalToggleRepeat,
    repeatMode: globalRepeatMode,
    toggleShuffle: globalToggleShuffle,
    isShuffleEnabled: globalIsShuffleEnabled,
  } = useMusicPlayer();
  const thisPlaylistContext = `playlist-${playlistData.id}`;
  const isThisPlaylistActive = playlistContext === thisPlaylistContext;

  const currentTrack = tracks?.[currentTrackIndex] || null;
  const trackOfflineDownloaded = useOfflineSong(currentTrack?.id);
  const { showSongBonusRewarded, showBanner, hideBanner, removeBanner, showInterstitial } = useAdPlacement('PlaylistPlayerScreen');
  const [showSongBonusPrompt, setShowSongBonusPrompt] = useState(false);
  const songsPlayedSinceInterstitialRef = useRef(0);
  const interstitialTimeoutRef = useRef<number | null>(null);

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
    'playlist_player_bottom_banner',
    showBanner,
    hideBanner,
    () => ({
      contentId: playlistData?.id,
      contentType: 'playlist',
    }),
    [playlistData?.id],
    true,
    0,
    false
  );

  // Auto interstitial: every 2 songs played in this playlist (trigger mid-way through the 2nd song).
  useEffect(() => {
    const t = tracks?.[currentTrackIndex] || null;
    if (!t?.id) return;

    songsPlayedSinceInterstitialRef.current += 1;
    const shouldTrigger = songsPlayedSinceInterstitialRef.current >= 2;
    if (!shouldTrigger) return;
    songsPlayedSinceInterstitialRef.current = 0;

    if (interstitialTimeoutRef.current != null) {
      window.clearTimeout(interstitialTimeoutRef.current);
      interstitialTimeoutRef.current = null;
    }

    const durationSeconds = typeof t.duration === 'number' && t.duration > 0 ? t.duration : undefined;
    const midMs = durationSeconds ? Math.max(12_000, Math.floor((durationSeconds * 1000) / 2)) : 30_000;

    interstitialTimeoutRef.current = window.setTimeout(() => {
      showInterstitial('playlist_midplay_interstitial', {
        contentId: t.id,
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

    // Apply favoritesCache immediately so hearts stay correct when leaving/returning (before async load)
    if (playlistData?.tracks?.length) {
      setTracks(prev => prev.map(t => ({
        ...t,
        isFavorited: t.isFavorited ?? favoritesCache.isSongFavorited(t.id)
      })));
    }

    // Load track favorite status in background — don't block display (cache already set initial state)
    loadTrackFavoriteStatus().catch(() => {});

    onPlayerVisibilityChange?.(true);
    window.dispatchEvent(new CustomEvent('playlistPlayerVisibilityChange', {
      detail: { isVisible: true }
    }));

    if (autoPlay && playlistData?.tracks && playlistData.tracks.length > 0) {
      const playlistTracks = playlistData.tracks
        .filter(track => track.audioUrl)
        .map(track => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          artistId: track.artistId,
          coverImageUrl: track.coverImageUrl || playlistData.coverImageUrl,
          audioUrl: track.audioUrl,
          duration: track.duration,
          playCount: 0
        }));

      if (playlistTracks.length > 0) {
        const startPlayback = async () => {
          const firstPlayableIndex = playlistData.tracks.findIndex(track => track.audioUrl);
          const playableIndexInFiltered = firstPlayableIndex >= 0
            ? playlistTracks.findIndex(track => track.id === playlistData.tracks[firstPlayableIndex].id)
            : 0;

          const targetSong = playlistTracks[playableIndexInFiltered];
          if (isThisPlaylistActive || !targetSong) {
            return;
          }

          // Just start playback; playlist-level rewarded ads are handled by the
          // global "every 2 songs" logic, not on open.
          playSong(targetSong, false, playlistTracks, playableIndexInFiltered, thisPlaylistContext, null, playlistData.id);
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
      window.dispatchEvent(new CustomEvent('playlistPlayerVisibilityChange', {
        detail: { isVisible: false }
      }));
    };
  }, [onPlayerVisibilityChange, autoPlay, playlistData]);

  // Load a single inline native ad for playlist player (non-blocking)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ads = await getNativeAdsForPlacement('playlist_player', null, null, 1);
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
  }, [playlistData.id]);

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
  }, [inlineAd, playlistData.id]);

  // Preload likely audio-ad companion art for playlist placement so the first overlay paints faster.
  useEffect(() => {
    if (!playlistData?.id) return;
    const country =
      typeof user?.user_metadata?.country === 'string' ? user.user_metadata.country : null;
    void prefetchAudioAdCompanionForPlacement('playlist_player', country);
  }, [playlistData?.id, user?.user_metadata?.country]);

  // No additional timers: rewarded ads are handled by song-transition logic only.

  useEffect(() => {
    loadCommentCount();
  }, [currentTrackIndex]);

  useEffect(() => {
    if (!isThisPlaylistActive) return;
    if (currentSong && tracks) {
      const trackIndex = tracks.findIndex(track => track.id === currentSong.id);
      if (trackIndex >= 0 && trackIndex !== currentTrackIndex) {
        setCurrentTrackIndex(trackIndex);
      }
    }
  }, [isThisPlaylistActive, currentSong, tracks, currentTrackIndex]);

  // Keep buffering state in sync with actual audio events (readyState alone doesn't trigger re-renders)
  useEffect(() => {
    if (currentSong?.id !== currentTrack?.id || !audioElement) {
      setIsBuffering(false);
      return;
    }
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => setIsBuffering(false);
    const onPlaying = () => setIsBuffering(false);
    const onStalled = () => setIsBuffering(true);
    const onError = () => setIsBuffering(false);
    audioElement.addEventListener('waiting', onWaiting);
    audioElement.addEventListener('canplay', onCanPlay);
    audioElement.addEventListener('playing', onPlaying);
    audioElement.addEventListener('stalled', onStalled);
    audioElement.addEventListener('error', onError);
    // Initial state from current readyState
    if (isPlaying && audioElement.readyState < 3) {
      setIsBuffering(true);
    } else {
      setIsBuffering(false);
    }
    return () => {
      audioElement.removeEventListener('waiting', onWaiting);
      audioElement.removeEventListener('canplay', onCanPlay);
      audioElement.removeEventListener('playing', onPlaying);
      audioElement.removeEventListener('stalled', onStalled);
      audioElement.removeEventListener('error', onError);
    };
  }, [isPlaying, currentSong?.id, currentTrack?.id, audioElement]);

  useEffect(() => {
    if (!isThisPlaylistActive || !isPlaying || !playlistData?.id) return;
    prefetchContentComments(playlistData.id, 'playlist').catch(() => {});
  }, [isThisPlaylistActive, isPlaying, playlistData?.id]);

  // Detect mini player state
  useEffect(() => {
    const checkMiniPlayer = () => {
      setIsMiniPlayerActive(document.body.classList.contains('mini-player-active'));
    };

    checkMiniPlayer();

    const observer = new MutationObserver(checkMiniPlayer);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  const loadTrackFavoriteStatus = async () => {
    if (!isAuthenticated || !playlistData?.tracks || playlistData.tracks.length === 0) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const songIds = playlistData.tracks.map(track => track.id);

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

      // Merge with favoritesCache so hearts stay correct when leaving/returning (cache updated on toggle)
      const tracksWithFavorites = playlistData.tracks.map(track => ({
        ...track,
        isFavorited: favoritedSongIds.has(track.id) || favoritesCache.isSongFavorited(track.id)
      }));

      setTracks(tracksWithFavorites);
    } catch (error) {
      console.error('Error loading favorite status:', error);
    }
  };

  const loadCommentCount = async () => {
    if (!playlistData?.id) return;
    try {
      const count = await getContentCommentsCount(playlistData.id, 'playlist');
      setCommentCount(count);
    } catch (error) {
      console.error('Error loading comment count:', error);
    }
  };

  const playTrack = (trackIndex: number) => {
    const track = tracks?.[trackIndex];
    if (!track) {
      alert('Track not found');
      return;
    }

    if (!track.audioUrl) {
      alert('This track does not have a valid audio file. Please contact the creator.');
      return;
    }

    if (isThisPlaylistActive && currentSong?.id === track.id) {
      togglePlayPause();
      setCurrentTrackIndex(trackIndex);
      return;
    }

    setCurrentTrackIndex(trackIndex);
    setIsBuffering(true);

    const playlistTracks = tracks
      .filter(t => t.audioUrl)
      .map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        artistId: t.artistId,
        coverImageUrl: t.coverImageUrl || playlistData.coverImageUrl,
        audioUrl: t.audioUrl,
        duration: t.duration,
        playCount: 0
      }));

    const playlistIndex = playlistTracks.findIndex(song => song.id === track.id);

    if (playlistIndex >= 0) {
      playSong(playlistTracks[playlistIndex], false, playlistTracks, playlistIndex, thisPlaylistContext, null, playlistData.id);

      // Track playlist play for contribution rewards (only if not the owner)
      if (user?.id && playlistData.userId && user.id !== playlistData.userId) {
        trackPlaylistPlayed(playlistData.userId, playlistData.id, user.id).catch(console.error);
      }

      setTimeout(() => hideFullPlayer(), 200);
      // isBuffering is cleared by audio 'canplay'/'playing' events in useEffect
    }
  };

  const playNextTrack = () => {
    globalPlayNext();
  };

  const playPreviousTrack = () => {
    globalPlayPrevious();
  };

  const handleToggleShuffle = () => {
    globalToggleShuffle();
  };

  const handleToggleRepeat = () => {
    globalToggleRepeat();
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

  const handleDownloadTrack = async () => {
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
          coverImageUrl: currentTrack.coverImageUrl || playlistData.coverImageUrl || null,
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

  const handleSharePlaylist = () => {
    sharePlaylist(playlistData.id, playlistData.title).catch((error) => {
      console.error('Error sharing playlist:', error);
    });
    recordShareEvent(playlistData.id, 'playlist').catch((error) => {
      console.error('Error recording share event:', error);
    });
  };

  const handleDeletePlaylist = async () => {
    if (!playlistData.isOwner) {
      alert('You can only delete your own playlists');
      return;
    }

    const confirmed = confirm(`Are you sure you want to delete "${playlistData.title}"? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('playlists')
        .delete()
        .eq('id', playlistData.id);

      if (error) throw error;

      alert('Playlist deleted successfully');
      navigate('/library');
    } catch (error) {
      console.error('Error deleting playlist:', error);
      alert('Failed to delete playlist');
    }
  };

  const handleRemoveTrackFromPlaylist = async (trackId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!playlistData.isOwner) {
      alert('You can only remove tracks from your own playlists');
      return;
    }

    const confirmed = confirm('Remove this track from the playlist?');
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('playlist_songs')
        .delete()
        .eq('playlist_id', playlistData.id)
        .eq('song_id', trackId);

      if (error) throw error;

      const updatedTracks = tracks.filter(track => track.id !== trackId);
      setTracks(updatedTracks);

      if (updatedTracks.length === 0) {
        alert('Playlist is now empty');
      }

      alert('Track removed from playlist');
    } catch (error) {
      console.error('Error removing track:', error);
      alert('Failed to remove track');
    }
  };

  const handleClose = () => {
    hideFullPlayer();

    onPlayerVisibilityChange?.(false);
    window.dispatchEvent(new CustomEvent('playlistPlayerVisibilityChange', {
      detail: { isVisible: false }
    }));

    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
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

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#0a0a0a] via-[#0d0d0d] to-[#111111] fixed inset-0 z-50 pb-[env(safe-area-inset-bottom,0px)] overflow-hidden">
      {/* Scrollable Content Container */}
      <div
        className="flex-1 overflow-y-auto px-4 pb-4 scrollbar-hide"
        style={{
          paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)',
          paddingBottom: isMiniPlayerActive
            ? 'calc(12.5rem + env(safe-area-inset-bottom, 0px))'
            : 'calc(8rem + env(safe-area-inset-bottom, 0px))'
        }}
      >
        <div className="flex flex-col gap-6 pt-0 pb-4">
          {/* Playlist Header Card */}
          <div className="relative overflow-hidden rounded-2xl">
            {/* Background: Track image collage or playlist cover */}
            <div className="absolute inset-0 z-0">
              {isListenerCurationsPlaylist && playlistData.coverImageUrl ? (
                <img
                  src={playlistData.coverImageUrl}
                  alt={playlistData.title}
                  className="w-full h-full object-cover"
                />
              ) : tracks.length > 0 && tracks.some(t => t.coverImageUrl) ? (
                <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
                  {tracks
                    .filter(t => t.coverImageUrl)
                    .slice(0, 4)
                    .map((t, idx) => (
                      <img
                        key={idx}
                        src={t.coverImageUrl!}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ))}
                </div>
              ) : playlistData.coverImageUrl ? (
                <img
                  src={playlistData.coverImageUrl}
                  alt={playlistData.title}
                  className="w-full h-full object-cover"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/70 to-black/90" />
            </div>

            <div className="relative z-10 p-6 pb-7 min-h-[200px] flex flex-col justify-between">
              <div
                className="flex items-center justify-between"
              >
                <button
                  onClick={handleClose}
                  className="min-w-[40px] min-h-[40px] flex items-center justify-center bg-black/40 hover:bg-black/55 active:bg-black/65 rounded-full transition-all active:scale-95 backdrop-blur-sm"
                  aria-label="Go back"
                >
                  <ArrowLeft className="w-5 h-5 text-white" strokeWidth={2.5} />
                </button>
                <div className="flex items-center gap-1">
                  {playlistData.isOwner ? (
                    <>
                      <button
                        onClick={() => setShowEditPlaylistModal(true)}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center bg-black/35 hover:bg-black/50 rounded-full transition-all active:scale-95"
                        aria-label="Edit playlist"
                      >
                        <Edit className="w-5 h-5 text-white/80" />
                      </button>
                      <button
                        onClick={handleDeletePlaylist}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center bg-black/35 hover:bg-red-500/30 rounded-full transition-all active:scale-95"
                        aria-label="Delete playlist"
                      >
                        <Trash2 className="w-5 h-5 text-red-400" />
                      </button>
                    </>
                  ) : (
                    <div className="w-[40px]" />
                  )}
                </div>
              </div>

              <div>
              <h2 className="font-sans font-bold text-white text-2xl leading-tight mb-1">
                {playlistData.title}
              </h2>

              {isListenerCurationsPlaylist && (
                <p className="font-sans text-white/70 text-sm leading-snug mb-2 max-w-[95%]">
                  by {playlistData.userName?.trim() || 'Unknown'}
                </p>
              )}

              {playlistData.description && (
                <p className="font-sans text-white/70 text-sm leading-relaxed mb-3 max-w-[85%] line-clamp-2">
                  {playlistData.description}
                </p>
              )}

              <div className="flex items-center justify-between gap-3 text-white/50 text-xs font-sans">
                <div className="flex items-center gap-2">
                  <Music className="w-3.5 h-3.5" />
                  <span>{formatDuration(playlistData.totalDuration)}</span>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    onClick={() => setShowCommentsModal(true)}
                    className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all relative"
                    title="Comments"
                  >
                    <MessageCircle className="w-[18px] h-[18px]" />
                    {commentCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 text-[10px] font-bold text-white/80 tabular-nums">
                        {commentCount >= 1000 ? `${(commentCount / 1000).toFixed(1).replace(/\.0$/, '')}K` : commentCount}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={handleSharePlaylist}
                    className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all"
                    title="Share"
                  >
                    <Share2 className="w-[18px] h-[18px]" />
                  </button>
                  {isListenerCurationsPlaylist && !playlistData.isOwner && (
                    <button
                      onClick={() => setShowTippingModal(true)}
                      className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all"
                      title="Tip creator"
                    >
                      <Gift className="w-[18px] h-[18px]" />
                    </button>
                  )}
                  <button
                    onClick={() => setShowReportModal(true)}
                    className="p-2 rounded-full text-red-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    title="Report"
                  >
                    <Flag className="w-[18px] h-[18px]" />
                  </button>
                </div>
              </div>

              {/* Inline Native Ad inside header when available */}
              {inlineAd && showInlineAd && (
                <div className="mt-4">
                  <PlayerStaticAdBanner ad={inlineAd} className="rounded-xl" />
                </div>
              )}
              </div>
            </div>
          </div>

          {/* song_bonus ~every 1.5 songs; rewarded interstitial every 3. Claim → VITE_ADMOB_REWARDED_ID */}
          {showSongBonusPrompt && (
            <div className="mt-3 mb-2 mx-4 flex items-center justify-between gap-3 rounded-2xl bg-white/10 border border-white/15 px-3 py-2 shadow-lg">
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

          {/* Playback Controls */}
          <div className="flex items-center justify-center gap-6 px-2">
            <button
              onClick={handleToggleShuffle}
              className={cn(
                'p-2 rounded-full transition-all active:scale-95',
                globalIsShuffleEnabled
                  ? 'text-[#00ad74] bg-[#00ad74]/20'
                  : 'text-white/50 hover:text-white/70 hover:bg-white/10'
              )}
              aria-label="Shuffle"
            >
              <Shuffle className="w-5 h-5" />
            </button>
            <button onClick={playPreviousTrack} className="text-white hover:scale-110 active:scale-95 transition-transform p-1" aria-label="Previous track">
              <SkipBack className="w-6 h-6 fill-current" />
            </button>
            <button
              onClick={() => playTrack(currentTrackIndex)}
              className="w-14 h-14 rounded-full flex items-center justify-center bg-white text-[#0a0a0a] hover:scale-[1.06] active:scale-95 transition-all duration-200 shadow-lg"
              aria-label={isThisPlaylistActive && isPlaying && currentSong?.id === currentTrack?.id ? 'Pause' : 'Play'}
            >
              {isThisPlaylistActive && isPlaying && currentSong?.id === currentTrack?.id ? (
                <Pause className="w-6 h-6" />
              ) : (
                <Play className="w-6 h-6 ml-0.5" />
              )}
            </button>
            <button onClick={playNextTrack} className="text-white hover:scale-110 active:scale-95 transition-transform p-1" aria-label="Next track">
              <SkipForward className="w-6 h-6 fill-current" />
            </button>
            <button
              onClick={handleToggleRepeat}
              className={cn(
                'p-2 rounded-full transition-all active:scale-95 relative',
                globalRepeatMode !== 'off'
                  ? 'text-[#00ad74] bg-[#00ad74]/20'
                  : 'text-white/50 hover:text-white/70 hover:bg-white/10'
              )}
              aria-label={`Repeat ${globalRepeatMode}`}
            >
              <Repeat className="w-5 h-5" />
              {globalRepeatMode === 'one' && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-[#00ad74] rounded-full flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">1</span>
                </span>
              )}
            </button>
          </div>

          {/* Track List */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1 mb-1">
              <h4 className="font-sans font-semibold text-white text-sm">
                Tracks
              </h4>
              <button
                onClick={() => setShowTrackList(!showTrackList)}
                className="text-white/60 hover:text-white text-xs transition-colors"
              >
                {showTrackList ? 'Hide' : 'Show'}
              </button>
            </div>

            {showTrackList && (
              tracks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Music className="w-12 h-12 text-white/40 mb-3" />
                  <p className="font-sans text-white/60 text-sm">
                    No tracks in this playlist
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {tracks.map((track, index) => {
                    const isCurrentTrack = isThisPlaylistActive && currentSong?.id === track.id;
                    const isPlayingTrack = isCurrentTrack && isPlaying;

                    return (
                      <div
                        key={track.id}
                        className={cn(
                          'group rounded-xl p-4 transition-all cursor-pointer',
                          isCurrentTrack
                            ? 'bg-white/15'
                            : 'bg-white/5 hover:bg-white/10 active:bg-white/15'
                        )}
                        onClick={() => playTrack(index)}
                      >
                        <div className="flex items-center gap-3">
                          {/* Track Number / Play Icon */}
                          <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                            <span className={cn(
                              'font-sans text-sm group-hover:hidden',
                              isCurrentTrack ? 'text-white font-semibold' : 'text-white/60'
                            )}>
                              {track.trackNumber || (index + 1)}
                            </span>
                            <Play
                              className="w-4 h-4 hidden group-hover:block text-white"
                              fill="white"
                            />
                          </div>

                          {/* Cover Image */}
                          <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5 flex-shrink-0 shadow">
                            {track.coverImageUrl ? (
                              <LazyImage
                                src={track.coverImageUrl}
                                alt={track.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Music className="w-5 h-5 text-white/40" />
                              </div>
                            )}
                          </div>

                          {/* Song Info */}
                          <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                            <p className={cn(
                              'font-sans font-medium text-sm truncate leading-tight',
                              isCurrentTrack ? 'text-white' : 'text-white'
                            )}>
                              {track.title || 'Untitled Track'}
                            </p>
                            <span className="font-sans text-white/60 text-xs truncate">
                              {track.featuredArtists && track.featuredArtists.length > 0
                                ? `${track.artist} ft. ${track.featuredArtists.join(', ')}`
                                : track.artist
                              }
                            </span>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1">
                            {isAuthenticated && (
                              <button
                                onClick={(e) => handleToggleTrackFavorite(track.id, e)}
                                className="p-1.5 rounded-full transition-all hover:bg-white/10"
                                aria-label={track.isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                              >
                                <Heart className={cn('w-4 h-4 transition-all duration-[50ms]', track.isFavorited ? 'text-red-500 fill-red-500' : 'text-white/70')} />
                              </button>
                            )}

                            {playlistData.isOwner && (
                              <button
                                onClick={(e) => handleRemoveTrackFromPlaylist(track.id, e)}
                                className="p-1.5 hover:bg-red-500/20 rounded-full transition-all opacity-0 group-hover:opacity-100"
                                aria-label="Remove from playlist"
                              >
                                <Trash2 className="w-4 h-4 text-red-400" />
                              </button>
                            )}

                            {/* Duration */}
                            <span className="font-sans text-white/60 text-xs flex-shrink-0 w-10 text-right tabular-nums">
                              {formatTime(track.duration)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showCommentsModal && (
        <CommentsModal
          contentId={playlistData.id}
          contentType="playlist"
          contentTitle={playlistData.title}
          onClose={() => {
            setShowCommentsModal(false);
            loadCommentCount();
          }}
        />
      )}

      {showReportModal && (
        <ReportModal
          contentType="playlist"
          contentId={playlistData.id}
          contentTitle={playlistData.title}
          reportedUserId={playlistData.userId}
          onClose={() => setShowReportModal(false)}
          onSuccess={() => {
            setShowReportModal(false);
          }}
        />
      )}

      {showTippingModal && (
        <TippingModal
          onClose={() => setShowTippingModal(false)}
          onSuccess={() => setShowTippingModal(false)}
          recipientId={playlistData.userId}
          recipientName={playlistData.userName ?? undefined}
          recipientAvatar={playlistData.userAvatar ?? undefined}
          contentId={playlistData.id}
          contentType="playlist"
        />
      )}

      {showEditPlaylistModal && (
        <EditPlaylistModal
          playlistId={playlistData.id}
          onClose={() => setShowEditPlaylistModal(false)}
          onSuccess={() => {
            setShowEditPlaylistModal(false);
            onPlaylistUpdated?.();
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

export const PlaylistPlayerScreen: React.FC<PlaylistPlayerScreenProps> = ({ onPlayerVisibilityChange, onOpenMusicPlayer }) => {
  const { playlistId } = useParams<{ playlistId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const source = searchParams.get('source');
  const isListenerCurationsPlaylist = source === 'listener_curations';
  const isMixForYouPlaylist = source === 'mix_for_you';
  const [playlistData, setPlaylistData] = useState<PlaylistData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!playlistId) {
      setError('Playlist ID is required');
      return;
    }

    onPlayerVisibilityChange?.(true);

    // Try to load from cache first for instant display
    const cached = playlistCache.get(playlistId);
    if (cached) {
      setPlaylistData(cached);
      // Refresh in background
      loadPlaylistData();
    } else {
      // Load immediately if not cached
      loadPlaylistData();
    }

    return () => {
      onPlayerVisibilityChange?.(false);
    };
  }, [playlistId]);

  const loadCuratedMixData = async (mixData: any, currentUserId?: string) => {
    try {
      const { data: mixDetails } = await supabase.rpc('get_mix_with_song_details', {
        mix_id: mixData.id
      });

      if (!mixDetails || !mixDetails.songs || mixDetails.songs.length === 0) {
        throw new Error('This mix does not contain any songs');
      }

      const { data: userData } = await supabase
        .from('users')
        .select('id, display_name, avatar_url')
        .eq('id', mixData.created_by)
        .maybeSingle();

      const tracks: PlaylistTrack[] = mixDetails.songs.map((song: any, index: number) => ({
        id: song.id,
        title: song.title || 'Untitled Track',
        artist: song.artist || 'Unknown Artist',
        artistId: null,
        duration: song.duration || 0,
        audioUrl: song.audio_url || null,
        coverImageUrl: song.cover_url || mixData.cover_image_url,
        trackNumber: index + 1,
        featuredArtists: [],
        playCount: song.play_count || 0,
        addedAt: mixData.created_at
      }));

      const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);
      const playableTracks = tracks.filter(track => track.audioUrl);

      if (playableTracks.length === 0) {
        throw new Error('This mix does not contain any playable tracks');
      }

      const playlist: PlaylistData = {
        id: mixData.id,
        title: mixData.title,
        description: mixData.description,
        coverImageUrl: mixData.cover_image_url || null,
        userId: mixData.created_by,
        userName: userData?.display_name || 'Airaplay Admin',
        userAvatar: userData?.avatar_url,
        tracks: playableTracks,
        totalDuration,
        createdAt: mixData.created_at,
        updatedAt: mixData.updated_at,
        isOwner: currentUserId === mixData.created_by
      };

      setPlaylistData(playlist);
    } catch (err) {
      console.error('Failed to load curated mix:', err);
      throw err;
    }
  };

  const loadMixData = async (mixInfo: any, currentUserId?: string) => {
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('id, display_name, avatar_url')
        .eq('id', mixInfo.user_id)
        .single();

      // Extract songs from mix metadata
      const tracks: PlaylistTrack[] = [];
      if (mixInfo.metadata?.song_details && Array.isArray(mixInfo.metadata.song_details)) {
        mixInfo.metadata.song_details.forEach((song: any, index: number) => {
          tracks.push({
            id: song.id,
            title: song.title || 'Untitled Track',
            artist: song.artist || 'Unknown Artist',
            artistId: null,
            duration: song.duration || 0,
            audioUrl: song.audio_url || null,
            coverImageUrl: song.cover_url || mixInfo.metadata?.cover_url,
            trackNumber: index + 1,
            featuredArtists: [],
            playCount: 0,
            addedAt: mixInfo.created_at
          });
        });
      } else if (mixInfo.metadata?.songs && Array.isArray(mixInfo.metadata.songs)) {
        // Fallback: fetch song IDs from metadata
        const songIds = mixInfo.metadata.songs;
        const { data: songsData } = await supabase
          .from('songs')
          .select(`
            id,
            title,
            artist_id,
            cover_image_url,
            audio_url,
            duration_seconds,
            artists:artist_id (
              name
            )
          `)
          .in('id', songIds);

        if (songsData) {
          songsData.forEach((song: any, index: number) => {
            const artistName = Array.isArray(song.artists)
              ? song.artists[0]?.name || 'Unknown Artist'
              : song.artists?.name || 'Unknown Artist';

            tracks.push({
              id: song.id,
              title: song.title,
              artist: artistName,
              artistId: song.artist_id,
              duration: song.duration_seconds || 0,
              audioUrl: song.audio_url,
              coverImageUrl: song.cover_image_url,
              trackNumber: index + 1,
              featuredArtists: [],
              playCount: 0,
              addedAt: mixInfo.created_at
            });
          });
        }
      }

      const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);

      // Filter out tracks without audio URLs
      const playableTracks = tracks.filter(track => track.audioUrl);

      if (playableTracks.length === 0 && tracks.length > 0) {
        throw new Error('This mix does not contain any playable tracks. The audio files may be missing or not properly configured.');
      }

      const playlist: PlaylistData = {
        id: mixInfo.id,
        title: mixInfo.title,
        description: mixInfo.description,
        coverImageUrl: mixInfo.metadata?.cover_url || null,
        userId: mixInfo.user_id,
        userName: userData?.display_name || 'Mix Creator',
        userAvatar: userData?.avatar_url,
        tracks: playableTracks.length > 0 ? playableTracks : tracks,
        totalDuration,
        createdAt: mixInfo.created_at,
        updatedAt: mixInfo.updated_at,
        isOwner: currentUserId === mixInfo.user_id
      };

      setPlaylistData(playlist);
    } catch (err) {
      console.error('Failed to load mix:', err);
      throw err;
    }
  };

  const loadPlaylistData = async () => {
    if (!playlistId) return;

    try {
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      const currentUserId = session?.user?.id;

      // Try to load from playlists table first
      const { data: playlistInfo, error: playlistError } = await supabase
        .from('playlists')
        .select(`
          id,
          title,
          description,
          cover_image_url,
          user_id,
          created_at,
          updated_at
        `)
        .eq('id', playlistId)
        .maybeSingle();

      // If not found in playlists, try curated_mixes (admin mixes)
      if (!playlistInfo) {
        const { data: curatedMix, error: curatedMixError } = await supabase
          .from('curated_mixes')
          .select('*')
          .eq('id', playlistId)
          .maybeSingle();

        if (!curatedMixError && curatedMix) {
          await loadCuratedMixData(curatedMix, currentUserId);
          return;
        }

        // Fallback to old content_uploads format
        const { data: mixInfo, error: mixError } = await supabase
          .from('content_uploads')
          .select(`
            id,
            title,
            description,
            metadata,
            user_id,
            created_at,
            updated_at
          `)
          .eq('id', playlistId)
          .eq('content_type', 'mix')
          .eq('status', 'approved')
          .maybeSingle();

        if (mixError) throw mixError;
        if (!mixInfo) throw new Error('Playlist or mix not found');

        // Handle admin mix format
        await loadMixData(mixInfo, currentUserId);
        return;
      }

      if (playlistError) throw playlistError;

      // Fetch user data and songs in parallel for instant display
      const [userResult, songsResult] = await Promise.all([
        supabase
          .from('users')
          .select('id, display_name, username, avatar_url')
          .eq('id', playlistInfo.user_id)
          .maybeSingle(),
        supabase
          .from('playlist_songs')
          .select(`
            song_id,
            added_at,
            songs:song_id (
              id,
              title,
              artist_id,
              cover_image_url,
              audio_url,
              duration_seconds,
              play_count,
              artists:artist_id (
                name
              )
            )
          `)
          .eq('playlist_id', playlistId)
          .order('added_at', { ascending: true })
      ]);

      if (songsResult.error) throw songsResult.error;

      const userData = userResult.data;
      const playlistSongs = songsResult.data;

      const tracks: PlaylistTrack[] = (playlistSongs || [])
        .filter(ps => ps.songs)
        .map((ps: any, index) => {
          const song = ps.songs;
          const artistName = Array.isArray(song.artists)
            ? song.artists[0]?.name || 'Unknown Artist'
            : song.artists?.name || 'Unknown Artist';

          return {
            id: song.id,
            title: song.title,
            artist: artistName,
            artistId: song.artist_id,
            duration: song.duration_seconds || 0,
            audioUrl: song.audio_url,
            coverImageUrl: song.cover_image_url,
            trackNumber: index + 1,
            featuredArtists: [],
            playCount: song.play_count || 0,
            addedAt: ps.added_at
          };
        });

      const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);

      // Filter out tracks without audio URLs
      const playableTracks = tracks.filter(track => track.audioUrl);

      if (playableTracks.length === 0 && tracks.length > 0) {
        throw new Error('This playlist does not contain any playable tracks. The audio files may be missing or not properly configured.');
      }

      const playlist: PlaylistData = {
        id: playlistInfo.id,
        title: playlistInfo.title,
        description: playlistInfo.description,
        coverImageUrl: playlistInfo.cover_image_url,
        userId: playlistInfo.user_id,
        userName: userData?.display_name?.trim() || userData?.username?.trim() || 'Unknown User',
        userAvatar: userData?.avatar_url,
        tracks: playableTracks.length > 0 ? playableTracks : tracks,
        totalDuration,
        createdAt: playlistInfo.created_at,
        updatedAt: playlistInfo.updated_at,
        isOwner: currentUserId === playlistInfo.user_id
      };

      setPlaylistData(playlist);

      // Cache the loaded data for instant future access
      playlistCache.set(playlistId, playlist);
    } catch (err) {
      console.error('Failed to load playlist:', err);
      setError(err instanceof Error ? err.message : 'Playlist not found');
    }
  };

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  // Keep skeleton visible when user is offline instead of showing "Playlist Not Found"
  if (error && !isOffline) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0a] z-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <Flag className="w-8 h-8 text-red-400" />
          </div>
          <h3 className="font-bold text-white text-xl mb-4">Playlist Not Found</h3>
          <p className="text-white/60 text-sm mb-6">
            {error || 'The playlist you\'re looking for doesn\'t exist or has been removed.'}
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

  // Show loading skeleton while fetching playlist data
  if (!playlistData) {
    return (
      <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#0a0a0a] via-[#0d0d0d] to-[#111111] fixed inset-0 z-50 pb-[env(safe-area-inset-bottom,0px)] overflow-hidden">
        <div
          className="flex-1 overflow-y-auto px-4 pb-4 scrollbar-hide"
          style={{
            paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)',
            paddingBottom: 'calc(8rem + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div className="flex flex-col gap-6 pt-0 pb-4">
            {/* Playlist header card — mirrors loaded layout (hero + overlay + toolbar) */}
            <div className="relative overflow-hidden rounded-2xl">
              <div className="absolute inset-0 z-0">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.12] via-white/[0.05] to-white/[0.02] animate-pulse" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/70 to-black/90" />
              </div>
              <div className="relative z-10 p-6 pb-7 min-h-[200px] flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div className="min-w-[40px] min-h-[40px] rounded-full bg-black/40 animate-pulse" />
                  <div className="flex items-center gap-1">
                    <div className="min-w-[40px] min-h-[40px] rounded-full bg-black/35 animate-pulse" />
                    <div className="min-w-[40px] min-h-[40px] rounded-full bg-black/35 animate-pulse" />
                  </div>
                </div>
                <div>
                  <div className="h-8 w-[min(90%,20rem)] bg-white/15 rounded-lg mb-2 animate-pulse" />
                  <div className="h-4 w-[min(70%,16rem)] bg-white/10 rounded mb-3 animate-pulse" />
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3.5 h-3.5 rounded bg-white/15 animate-pulse" />
                      <div className="h-3 w-14 bg-white/10 rounded animate-pulse" />
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div
                          key={i}
                          className="w-9 h-9 rounded-full bg-white/10 animate-pulse"
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Playback controls — same spacing as loaded row */}
            <div className="flex items-center justify-center gap-6 px-2">
              <div className="w-10 h-10 rounded-full bg-white/8 animate-pulse" />
              <div className="w-10 h-10 rounded-full bg-white/8 animate-pulse" />
              <div className="w-14 h-14 rounded-full bg-white/15 animate-pulse shadow-lg" />
              <div className="w-10 h-10 rounded-full bg-white/8 animate-pulse" />
              <div className="w-10 h-10 rounded-full bg-white/8 animate-pulse" />
            </div>

            {/* Track list — label row + row layout matching real tracks */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1 mb-1">
                <div className="h-4 w-14 bg-white/12 rounded animate-pulse" />
                <div className="h-3 w-9 bg-white/8 rounded animate-pulse" />
              </div>
              <div className="flex flex-col gap-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-xl p-4 bg-white/5"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-white/10 animate-pulse flex-shrink-0" />
                      <div className="w-12 h-12 rounded-lg bg-white/10 animate-pulse flex-shrink-0 shadow" />
                      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                        <div className="h-4 w-[min(92%,240px)] bg-white/12 rounded animate-pulse" />
                        <div className="h-3 w-[min(55%,140px)] bg-white/8 rounded animate-pulse" />
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <div className="w-7 h-7 rounded-full bg-white/8 animate-pulse" />
                        <div className="w-10 h-3 bg-white/8 rounded animate-pulse" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
      <PlaylistPlayer
      playlistData={playlistData}
      autoPlay={false}
      startTrackIndex={0}
      onPlayerVisibilityChange={onPlayerVisibilityChange}
      onShowAuthModal={handleShowAuthModal}
      onOpenMusicPlayer={onOpenMusicPlayer}
      isListenerCurationsPlaylist={isListenerCurationsPlaylist || isMixForYouPlaylist}
      onPlaylistUpdated={() => {
        if (playlistId) {
          playlistCache.delete(playlistId);
        }
        loadPlaylistData();
      }}
    />
  );
};
