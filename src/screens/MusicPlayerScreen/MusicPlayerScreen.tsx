import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/Spinner';
import { Heart, ArrowDownToLine, SkipBack, SkipForward, Play, Pause, Share2, MessageCircle, Gift, Plus, Check, Flag, X, ChevronDown } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { recordPlayback } from '../../lib/playbackTracker';
import { supabase, isSongFavorited, toggleSongFavorite, recordShareEvent, isFollowing, followUser, unfollowUser, getRandomSongs, getFollowerCount, getUserPlaylistsForSong, toggleSongInPlaylist, getContentCommentsCount } from '../../lib/supabase';
import { shareSong } from '../../lib/shareService';
import { useOfflineSong } from '../../hooks/useOfflineSong';
import { deleteOfflineSong, downloadOfflineSong, isOfflineDownloadPlatformSupported } from '../../lib/offlineAudioService';
import { ensureOfflineDownloadAllowedWithPaywall } from '../../lib/offlineDownloadEntitlement';
import { useMusicPlayer } from '../../hooks/useMusicPlayer';
import { useAuth } from '../../contexts/AuthContext';
import { useAlert } from '../../contexts/AlertContext';
import { artistCache } from '../../lib/artistCache';
import { CommentsModal, prefetchContentComments } from '../../components/CommentsModal';
import { TippingModal } from '../../components/TippingModal';
import { CreatePlaylistModal } from '../../components/CreatePlaylistModal';
import { ReportModal } from '../../components/ReportModal';
import { CustomConfirmDialog } from '../../components/CustomConfirmDialog';
import { ArtistTopTracksSection } from '../../components/ArtistTopTracksSection';
import { SimilarSongsSection } from '../../components/SimilarSongsSection';
import { createSafeHtml } from '../../lib/sanitizeHtml';
import { getSmartAutoplayRecommendation } from '../../lib/smartAutoplayService';
import { getNextSongFromHistory } from '../../lib/recentlyPlayedService';
import { getTrendingFallbackSong } from '../../lib/trendingFallbackService';
import { recordContribution } from '../../lib/contributionService';
import { cn } from '../../lib/utils';
import { getNativeAdsForPlacement, NativeAdCard } from '../../lib/nativeAdService';
import { PlayerStaticAdBanner } from '../../components/PlayerStaticAdBanner';
import { favoritesCache } from '../../lib/favoritesCache';
import { followsCache } from '../../lib/followsCache';
import { useAdPlacement } from '../../hooks/useAdPlacement';
import { usePlayerBottomBanner } from '../../hooks/usePlayerBottomBanner';
import { useContentEngagementSync } from '../../hooks/useEngagementSync';

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  videoUrl?: string | null;
  duration?: number;
  playCount?: number;
  featuredArtists?: string[] | null;
}

interface AdContent {
  type: 'image' | 'html' | 'video';
  content: string;
  link?: string;
}

interface MusicPlayerScreenProps {
  song: Song;
  playlist?: Song[];
  currentIndex?: number;
  playlistContext?: string;
  isPlaying?: boolean;
  currentTime?: number;
  duration?: number;
  audioElement?: HTMLAudioElement | null;
  playerError?: string | null;
  onClose: () => void;
  onPlayPause?: () => void;
  onSeek?: (time: number) => void;
  onSongChange?: (song: Song, index?: number) => void;
  adContent?: AdContent;
  onShowAuthModal?: () => void;
  initialArtistProfile?: any;
  initialFollowerCount?: number;
}

const isDiscoveryContext = (context?: string): boolean => {
  if (!context) return true;

  const discoveryContexts = [
    'Global Trending',
    'Trending Near You',
    'New Releases',
    'Trending Albums',
    'AI Recommended',
    'Inspired By You',
    'Explore',
    'unknown'
  ];

  return discoveryContexts.includes(context);
};

export const MusicPlayerScreen: React.FC<MusicPlayerScreenProps> = ({
  song,
  playlist = [],
  currentIndex = 0,
  playlistContext: _playlistContext,
  isPlaying: externalIsPlaying,
  currentTime: externalCurrentTime,
  duration: externalDuration,
  audioElement: externalAudioElement,
  onClose,
  onPlayPause: externalOnPlayPause,
  onSeek: externalOnSeek,
  onSongChange,
  playerError,
  adContent,
  onShowAuthModal,
  initialArtistProfile,
  initialFollowerCount
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, session, isAuthenticated, isInitialized } = useAuth();
  const { showAlert, showConfirm } = useAlert();
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [internalIsPlaying, setInternalIsPlaying] = useState(false);
  const [internalCurrentTime, setInternalCurrentTime] = useState(0);
  const [internalDuration, setInternalDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [isFollowingArtist, setIsFollowingArtist] = useState(false);
  const [isLoadingFollow, setIsLoadingFollow] = useState(false);
  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [artistFollowerCount, setArtistFollowerCount] = useState(initialFollowerCount || 0);
  const [artistProfile, setArtistProfile] = useState<any>(initialArtistProfile || null);
  const [artistUserId, setArtistUserId] = useState<string | null>(initialArtistProfile?.id || null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [shuffledPlaylist, setShuffledPlaylist] = useState<Song[]>([]);
  const [originalPlaylist, setOriginalPlaylist] = useState<Song[]>([]);
  const [showTippingModal, setShowTippingModal] = useState(false);
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] = useState(false);
  const [showPlaylistsDropdown, setShowPlaylistsDropdown] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState<any[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [userCountry, setUserCountry] = useState<string | undefined>();
  const [inlineAd, setInlineAd] = useState<NativeAdCard | null>(null);
  const [showInlineAd, setShowInlineAd] = useState(false);
  const [showSongBonusPrompt, setShowSongBonusPrompt] = useState(false);
  const [currentPlayCount, setCurrentPlayCount] = useState(song.playCount || 0);
  const nativeAdTimersRef = useRef<{ show?: number; hide?: number }>({});

  const {
    repeatMode: globalRepeatMode,
  } = useMusicPlayer();

  const { showBanner, hideBanner, removeBanner, showSongBonusRewarded, showInterstitial } = useAdPlacement('MusicPlayerScreen');
  const interstitialTimeoutRef = useRef<number | null>(null);

  // Subscribe to real-time play count updates for this song
  useContentEngagementSync(song.id, useCallback((update) => {
    if (update.metric === 'play_count' && update.contentType === 'song') {
      setCurrentPlayCount(update.value);
    }
  }, []));

  const songIsDownloaded = useOfflineSong(song.id);
  const [isDownloadInProgress, setIsDownloadInProgress] = useState(false);
  const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);

  const playbackStartTimeRef = useRef<number | null>(null);
  const hasRecordedPlaybackRef = useRef(false);
  const playlistDropdownRef = useRef<HTMLDivElement>(null);
  const currentArtistIdRef = useRef<string | null>(null);
  const currentSongIdRef = useRef<string | null>(null);
  const isTogglingFavoriteRef = useRef(false);
  const initialPathnameRef = useRef(location.pathname);
  const onCloseRef = useRef(onClose);

  const isPlaying = externalIsPlaying !== undefined ? externalIsPlaying : internalIsPlaying;
  const currentTime = externalCurrentTime !== undefined ? externalCurrentTime : internalCurrentTime;
  const duration = externalDuration !== undefined ? externalDuration : internalDuration;
  const usingExternalAudio = !!externalAudioElement;

  // Update onClose ref
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // song_bonus prompt (~every 1.5 songs); auto rewarded interstitial is every 3 (separate in context).
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
    'music_player_bottom_banner',
    showBanner,
    hideBanner,
    () => ({
      contentId: song?.id,
      contentType: 'song',
    }),
    [song?.id],
    true,
    0,
    false
  );

  // Auto interstitial: trigger mid-way through every new song.
  useEffect(() => {
    if (interstitialTimeoutRef.current != null) {
      window.clearTimeout(interstitialTimeoutRef.current);
      interstitialTimeoutRef.current = null;
    }
    if (!song?.id) return;

    // "Middle" of song. Fallback if duration missing.
    const durationSeconds = typeof song.duration === 'number' && song.duration > 0 ? song.duration : undefined;
    const midMs = durationSeconds ? Math.max(12_000, Math.floor((durationSeconds * 1000) / 2)) : 30_000;

    interstitialTimeoutRef.current = window.setTimeout(() => {
      showInterstitial('during_song_playback_interstitial', {
        contentId: song.id,
        contentType: 'song',
      }, { muteAppAudio: true }).catch(() => {});
    }, midMs);

    return () => {
      if (interstitialTimeoutRef.current != null) {
        window.clearTimeout(interstitialTimeoutRef.current);
        interstitialTimeoutRef.current = null;
      }
    };
  }, [song.id, song.duration, showInterstitial]);

  // Load a single inline native ad for the player (non-blocking, does not affect audio)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ads = await getNativeAdsForPlacement('music_player', userCountry ?? null, null, 1);
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
  }, [userCountry, song.id]);

  // Delay-show the native ad (up to ~60s), then auto-hide after 30s.
  useEffect(() => {
    // Reset visibility on song change
    setShowInlineAd(false);
    if (nativeAdTimersRef.current.show) window.clearTimeout(nativeAdTimersRef.current.show);
    if (nativeAdTimersRef.current.hide) window.clearTimeout(nativeAdTimersRef.current.hide);
    nativeAdTimersRef.current = {};

    if (!inlineAd) return;

    const minDelayMs = 5_000;   // "after few seconds"
    const maxDelayMs = 60_000;  // "up to a minute"
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
  }, [inlineAd, song.id]);

  // Close player when navigating to different routes
  useEffect(() => {
    const mainRoutes = ['/', '/explore', '/library', '/create', '/profile'];
    // Only close if we're navigating away from the initial route
    if (location.pathname !== initialPathnameRef.current && mainRoutes.includes(location.pathname)) {
      onCloseRef.current();
    }
  }, [location.pathname]);

  useEffect(() => {
    currentSongIdRef.current = song.id;
    setCurrentPlayCount(song.playCount || 0);

    setOriginalPlaylist(playlist);
    setShuffledPlaylist(playlist);

    if (isInitialized && isAuthenticated && user) {
      setCurrentUserId(user.id);
      loadUserCountry();
    } else {
      setCurrentUserId(null);
      setUserCountry(undefined);
    }

    if (usingExternalAudio) {
      setIsLoading(false);
    } else if (song.videoUrl) {
      // Only create local media element for VIDEO content
      pauseAllOtherMedia();
      loadAndPlaySong();
    } else {
      // For audio-only content without external audio, this shouldn't happen
      // but set loading to false to avoid stuck state
      setIsLoading(false);
      setError('Audio player not initialized');
    }

    return () => {
      // Only cleanup local video element, never audio (that's managed by context)
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
      }
      // Banner is removed on unmount only (see dedicated effect) to avoid flicker on song change
    };
  }, [song.id, usingExternalAudio, playlist, isInitialized, isAuthenticated, user]);

  // Load static ad for player screen
  // Static inline banner ads removed from full-screen player to avoid floating banners over scrolling content

  useEffect(() => {
    console.log('[MusicPlayerScreen] Song changed:', {
      songId: song.id,
      title: song.title,
      artist: song.artist,
      artistId: song.artistId
    });

    // Reset follow status when switching to a different artist
    setIsFollowingArtist(false);

    // Update the ref to track current artist
    currentArtistIdRef.current = song.artistId || null;

    if (song.artistId) {
      console.log('[MusicPlayerScreen] Song has artistId, checking cache...');
      // Check cache first for instant display
      const cachedData = artistCache.getImmediate(song.artistId);
      console.log('[MusicPlayerScreen] Immediate cache data:', cachedData);

      if (cachedData) {
        // Display cached data instantly (even if stale)
        console.log('[MusicPlayerScreen] Using cached data for instant display');
        setArtistProfile(cachedData.profile);
        setArtistUserId(cachedData.userId);
        setArtistFollowerCount(cachedData.followerCount);
      } else if (initialArtistProfile) {
        // Fallback to initial props if no cache
        console.log('[MusicPlayerScreen] Using initial artist profile:', initialArtistProfile);
        setArtistProfile(initialArtistProfile);
        setArtistUserId(initialArtistProfile.id);
        setArtistFollowerCount(initialFollowerCount || 0);
      } else {
        // No cached or initial data
        console.log('[MusicPlayerScreen] No cached or initial data available');
        setArtistProfile(null);
        setArtistUserId(null);
        setArtistFollowerCount(0);
      }

      // Always refresh in background to ensure data is fresh
      console.log('[MusicPlayerScreen] Calling loadArtistData in background...');
      loadArtistData();
    } else {
      // No artistId, reset everything
      console.log('[MusicPlayerScreen] No artistId, resetting artist data');
      setArtistProfile(null);
      setArtistUserId(null);
      setArtistFollowerCount(0);
    }

    if (isAuthenticated && !isTogglingFavoriteRef.current) {
      checkFavoriteStatus();
      checkFollowStatus();
    }
    isTogglingFavoriteRef.current = false;
    loadCommentCount();
  }, [song.id, song.artistId]);

  // Check follow and favorite status when authentication state changes or song changes.
  // Use favoritesCache/followsCache first so heart and follow stay correct when leaving and returning (cache updated on toggle).
  useEffect(() => {
    if (isAuthenticated) {
      setIsFavorited(favoritesCache.isSongFavorited(song.id));
      if (artistUserId) {
        setIsFollowingArtist(followsCache.isFollowing(artistUserId));
        checkFollowStatus();
      }
      checkFavoriteStatus();
    } else {
      // Reset statuses when user logs out
      setIsFollowingArtist(false);
      setIsFavorited(false);
    }
  }, [isAuthenticated, artistUserId, song.id]);

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

  useEffect(() => {
    if (!isPlaying || !song?.id) return;
    prefetchContentComments(song.id, 'song').catch(() => {});
  }, [isPlaying, song?.id]);

  const loadArtistData = async () => {
    const artistId = song.artistId;
    console.log('[MusicPlayerScreen] loadArtistData called for artistId:', artistId);
    console.log('[MusicPlayerScreen] Song:', { id: song.id, title: song.title, artist: song.artist });

    if (!artistId) {
      console.log('[MusicPlayerScreen] No artistId provided');
      return;
    }

    try {
      // Use artistCache for persistent data across component unmounts
      console.log('[MusicPlayerScreen] Fetching from artistCache...');
      const cachedData = await artistCache.get(artistId);
      console.log('[MusicPlayerScreen] Cached data received:', cachedData);

      if (!cachedData) {
        // No data available
        console.log('[MusicPlayerScreen] No cached data available for artistId:', artistId);
        if (currentArtistIdRef.current === artistId && song.artistId === artistId) {
          setArtistFollowerCount(0);
          setArtistProfile(null);
          setArtistUserId(null);
        }
        return;
      }

      // Only update if the artist hasn't changed while loading
      if (currentArtistIdRef.current === artistId && song.artistId === artistId) {
        console.log('[MusicPlayerScreen] Updating state with cached data:', {
          profile: cachedData.profile,
          userId: cachedData.userId,
          followerCount: cachedData.followerCount
        });
        setArtistProfile(cachedData.profile);
        setArtistUserId(cachedData.userId);
        setArtistFollowerCount(cachedData.followerCount);
      } else {
        console.log('[MusicPlayerScreen] Artist changed during load, skipping update');
      }
    } catch (error) {
      console.error('[ArtistData] Error loading artist data:', error);
      // Reset on error only if this is still the current artist
      if (currentArtistIdRef.current === artistId && song.artistId === artistId) {
        setArtistFollowerCount(0);
        setArtistProfile(null);
        setArtistUserId(null);
      }
    }
  };

  const loadCommentCount = async () => {
    try {
      const count = await getContentCommentsCount(song.id, 'song');
      setCommentCount(count);
    } catch (error) {
      console.error('Error loading comment count:', error);
    }
  };

  const loadUserCountry = async () => {
    if (!user?.id) return;

    try {
      const { data: userData } = await supabase
        .from('users')
        .select('country')
        .eq('id', user.id)
        .maybeSingle();

      if (userData?.country) {
        setUserCountry(userData.country);
      }
    } catch (error) {
      console.error('[MusicPlayerScreen] Error loading user country:', error);
    }
  };

  const checkFavoriteStatus = async () => {
    if (!isAuthenticated) return;

    const songIdToCheck = song.id;
    try {
      const favorited = await isSongFavorited(songIdToCheck);

      if (currentSongIdRef.current === songIdToCheck) {
        setIsFavorited(favorited);
      }
    } catch (error) {
      console.error('Error checking favorite status:', error);
    }
  };

  const checkFollowStatus = async () => {
    if (!isAuthenticated || !artistUserId) return;

    try {
      const following = await isFollowing(artistUserId);
      setIsFollowingArtist(following);
    } catch (error) {
      console.error('Error checking follow status:', error);
    }
  };

  const pauseAllOtherMedia = () => {
    // Pause ALL audio elements (including external/global player)
    const audioElements = document.getElementsByTagName('audio');
    for (let i = 0; i < audioElements.length; i++) {
      audioElements[i].pause();
    }

    // Pause all video elements except our own
    const videoElements = document.getElementsByTagName('video');
    for (let i = 0; i < videoElements.length; i++) {
      if (videoElements[i] !== videoRef.current) {
        videoElements[i].pause();
      }
    }
  };

  const loadAndPlaySong = async () => {
    setIsLoading(true);
    setError(null);
    hasRecordedPlaybackRef.current = false;

    try {
      const mediaUrl = song.audioUrl || song.videoUrl;
      if (!mediaUrl) {
        throw new Error('No media URL available');
      }

      const isVideo = !!song.videoUrl;
      const mediaElement = isVideo ? videoRef.current : audioRef.current;

      if (!mediaElement) {
        throw new Error('Media element not available');
      }

      const handleLoadedMetadata = () => {
        setInternalDuration(mediaElement.duration);
        setIsLoading(false);
      };

      const handleTimeUpdate = () => {
        setInternalCurrentTime(mediaElement.currentTime);
      };

      const handlePlay = () => {
        setInternalIsPlaying(true);
        playbackStartTimeRef.current = Date.now();
        hasRecordedPlaybackRef.current = false;
      };

      const handlePause = () => {
        setInternalIsPlaying(false);
        recordPlaybackIfNeeded();
      };

      const handleEnded = () => {
        setInternalIsPlaying(false);
        recordPlaybackIfNeeded();
        handleAutoPlayNext();
      };

      const handleError = () => {
        setError('Failed to load media');
        setIsLoading(false);
      };

      mediaElement.addEventListener('loadedmetadata', handleLoadedMetadata);
      mediaElement.addEventListener('timeupdate', handleTimeUpdate);
      mediaElement.addEventListener('play', handlePlay);
      mediaElement.addEventListener('pause', handlePause);
      mediaElement.addEventListener('ended', handleEnded);
      mediaElement.addEventListener('error', handleError);

      // Use metadata preload so playback can start sooner when user taps play/next
      mediaElement.preload = 'metadata';
      mediaElement.src = mediaUrl;
      mediaElement.load();

      try {
        await mediaElement.play();
      } catch (playError) {
        console.warn('Autoplay failed:', playError);
        setIsLoading(false);
      }

      return () => {
        mediaElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
        mediaElement.removeEventListener('timeupdate', handleTimeUpdate);
        mediaElement.removeEventListener('play', handlePlay);
        mediaElement.removeEventListener('pause', handlePause);
        mediaElement.removeEventListener('ended', handleEnded);
        mediaElement.removeEventListener('error', handleError);
      };
    } catch (err) {
      console.error('Error loading song:', err);
      setError(err instanceof Error ? err.message : 'Failed to load song');
      setIsLoading(false);
    }
  };

  const handleAutoPlayNext = async () => {
    console.log('[Smart Autoplay] Song ended. Context:', _playlistContext, 'Playlist length:', playlist.length, 'Current index:', currentIndex, 'Repeat:', globalRepeatMode);
    console.log('[Smart Autoplay] globalRepeatMode:', globalRepeatMode);

    // Always use the global repeat mode from context, not the local state
    const currentRepeatMode = globalRepeatMode;
    console.log('[Smart Autoplay] Using repeat mode:', currentRepeatMode);

    if (currentRepeatMode === 'one') {
      console.log('[Smart Autoplay] Repeat mode is "one" - replaying current song');
      const mediaElement = song.videoUrl ? videoRef.current : (usingExternalAudio ? externalAudioElement : null);
      if (mediaElement) {
        mediaElement.currentTime = 0;
        mediaElement.play().catch(err => {
          console.error('Error replaying media:', err);
        });
      }
      return;
    }

    const currentPlaylist = getCurrentPlaylist();
    const isAtEndOfPlaylist = currentPlaylist.length > 0 && currentIndex >= currentPlaylist.length - 1;
    const isDiscovery = isDiscoveryContext(_playlistContext);

    console.log('[Smart Autoplay] Playlist status - Length:', currentPlaylist.length, 'At end:', isAtEndOfPlaylist, 'Discovery context:', isDiscovery);

    if (currentRepeatMode === 'all' && currentPlaylist.length > 0) {
      console.log('[Smart Autoplay] Repeat mode is "all" - restarting playlist');
      handleNextSong();
      return;
    }

    if (currentPlaylist.length > 0 && !isAtEndOfPlaylist) {
      console.log('[Smart Autoplay] More songs in playlist - playing next track');
      handleNextSong();
      return;
    }

    if (isAtEndOfPlaylist && currentPlaylist.length > 0) {
      console.log('[Autoplay] Reached end of playlist - stopping playback');
      console.log('[Autoplay] Context:', _playlistContext, '- All songs in this section have been played');
      return;
    }

    if (currentPlaylist.length === 0) {
      console.log('[Smart Autoplay] No playlist - enabling Smart Autoplay');
    } else {
      // Not at end of playlist or other edge case - don't continue
      return;
    }

    let nextSong: Song | null = null;

    try {
      console.log('[Smart Autoplay] Searching for next song...');
      
      // Try Smart Autoplay (service already has timeout, no need for duplicate wrapper)
      try {
        nextSong = await getSmartAutoplayRecommendation(
          song,
          _playlistContext,
          undefined, // albumId
          currentPlaylist // Pass playlist for duplicate checking
        );
      } catch (error) {
        console.warn('[Smart Autoplay] Smart recommendation failed:', error);
      }

      // Only try fallback if first attempt failed
      if (!nextSong) {
        try {
          console.log('[Smart Autoplay] No similar songs found, trying recently played history');
          nextSong = await getNextSongFromHistory(song);
          // Validate fallback
          if (nextSong) {
            const isDuplicate = currentPlaylist.some(s => s.id === nextSong!.id);
            const isCurrentSong = nextSong.id === song.id;
            if (isDuplicate || isCurrentSong) {
              console.warn('[Smart Autoplay] History fallback is duplicate');
              nextSong = null;
            }
          }
        } catch (error) {
          console.warn('[Smart Autoplay] History fallback failed:', error);
        }
      }

      // Only try trending if still no song
      if (!nextSong) {
        try {
          console.log('[Smart Autoplay] No recently played songs, trying trending fallback');
          const country = userCountry || 'NG'; // Fallback to default country
          nextSong = await getTrendingFallbackSong(country);
          // Validate trending fallback
          if (nextSong) {
            const isDuplicate = currentPlaylist.some(s => s.id === nextSong!.id);
            const isCurrentSong = nextSong.id === song.id;
            if (isDuplicate || isCurrentSong) {
              console.warn('[Smart Autoplay] Trending fallback is duplicate');
              nextSong = null;
            }
          }
        } catch (error) {
          console.warn('[Smart Autoplay] Trending fallback failed:', error);
        }
      }

      if (nextSong) {
        // Final validation before transitioning
        const isDuplicate = currentPlaylist.some(s => s.id === nextSong!.id);
        const isCurrentSong = nextSong.id === song.id;
        
        if (isDuplicate || isCurrentSong) {
          console.warn('[Smart Autoplay] Final validation failed - duplicate detected');
          console.log('[Smart Autoplay] No valid recommendation - stopping playback');
        } else {
          console.log('[Smart Autoplay] Transitioning to:', nextSong.title, 'by', nextSong.artist);
          onSongChange?.(nextSong);
        }
      } else {
        console.log('[Smart Autoplay] No songs available for autoplay - stopping playback');
      }
    } catch (error) {
      console.error('[Smart Autoplay] Error in autoplay chain:', error);
    }
  };

  const getCurrentPlaylist = () => {
    return originalPlaylist;
  };

  const handlePreviousSong = () => {
    const currentPlaylist = getCurrentPlaylist();

    if (currentPlaylist.length === 0) {
      return;
    }

    if (currentPlaylist.length === 1) {
      const mediaElement = song.videoUrl ? videoRef.current : (usingExternalAudio ? externalAudioElement : null);
      if (mediaElement) {
        mediaElement.currentTime = 0;
        mediaElement.play().catch(err => {
          console.error('Error replaying media:', err);
        });
      }
      return;
    }

    const previousIndex = currentIndex > 0 ? currentIndex - 1 : currentPlaylist.length - 1;

    const previousSong = currentPlaylist[previousIndex];
    if (previousSong) {
      onSongChange?.(previousSong, previousIndex);
    }
  };

  const handleNextSong = async () => {
    const currentPlaylist = getCurrentPlaylist();

    if (currentPlaylist.length === 0) {
      return;
    }

    if (currentPlaylist.length === 1) {
      if (globalRepeatMode === 'one') {
        const mediaElement = song.videoUrl ? videoRef.current : (usingExternalAudio ? externalAudioElement : null);
        if (mediaElement) {
          mediaElement.currentTime = 0;
          mediaElement.play().catch(err => {
            console.error('Error replaying media:', err);
          });
        }
      }
      return;
    }

    let nextIndex;
    if (currentIndex === currentPlaylist.length - 1) {
      if (globalRepeatMode === 'all') {
        nextIndex = 0;
      } else {
        return;
      }
    } else {
      nextIndex = currentIndex + 1;
    }

    const nextSong = currentPlaylist[nextIndex];
    if (nextSong) {
      onSongChange?.(nextSong, nextIndex);
    }
  };

  const recordPlaybackIfNeeded = () => {
    if (playbackStartTimeRef.current && !hasRecordedPlaybackRef.current) {
      const durationListened = Math.floor((Date.now() - playbackStartTimeRef.current) / 1000);
      recordPlayback(song.id, durationListened, !!song.videoUrl, false, session ?? undefined);
      hasRecordedPlaybackRef.current = true;
      playbackStartTimeRef.current = null;
    }
  };

  const togglePlayPause = () => {
    if (externalOnPlayPause) {
      // Use external play/pause handler when available (preserves audio element and position)
      externalOnPlayPause();
    } else if (song.videoUrl && videoRef.current) {
      // Only handle video playback internally
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(err => {
          console.error('Error playing video:', err);
          setError('Failed to play video');
        });
      }
    } else {
      // For audio content, external handler must be provided
      console.error('No external play/pause handler for audio content');
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);

    if (externalOnSeek) {
      // Use external seek handler when available (preserves audio element and updates position)
      externalOnSeek(newTime);
    } else if (song.videoUrl && videoRef.current) {
      // Only handle video seeking internally
      videoRef.current.currentTime = newTime;
      setInternalCurrentTime(newTime);
    } else {
      // For audio content, external handler must be provided
      console.error('No external seek handler for audio content');
    }
  };

  const handleToggleFavorite = async () => {
    if (!isAuthenticated) {
      if (onShowAuthModal) {
        onShowAuthModal();
      } else {
        alert('Please sign in to add songs to your favorites');
      }
      return;
    }

    isTogglingFavoriteRef.current = true;
    const previousState = isFavorited;
    setIsFavorited(!isFavorited);

    try {
      const newFavoriteStatus = await toggleSongFavorite(song.id);
      setIsFavorited(newFavoriteStatus);

      // Track engagement contribution when user likes content
      if (newFavoriteStatus && !previousState) {
        recordContribution('song_like', song.id, 'song').catch(console.error);
      }
    } catch (error) {
      setIsFavorited(previousState);
      console.error('Error toggling favorite:', error);
      alert('Failed to update favorite status');
    } finally {
      isTogglingFavoriteRef.current = false;
    }
  };

  const handleToggleDownload = async () => {
    if (!isAuthenticated) {
      onShowAuthModal?.();
      return;
    }
    if (!song.audioUrl) {
      showAlert({
        title: 'Cannot Download',
        message: 'This song cannot be downloaded',
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

    if (songIsDownloaded) {
      await deleteOfflineSong(song.id);
      showAlert({
        title: 'Download Removed',
        message: 'Song removed from offline downloads',
        type: 'success'
      });
      return;
    }

    setShowDownloadConfirm(true);
  };

  const handleConfirmDownload = async () => {
    setShowDownloadConfirm(false);
    setIsDownloadInProgress(true);
    try {
      const allowed = await ensureOfflineDownloadAllowedWithPaywall(showConfirm, showAlert);
      if (!allowed) return;

      await downloadOfflineSong(
        {
          songId: song.id,
          title: song.title,
          artist: song.artist,
          coverImageUrl: song.coverImageUrl || null,
          durationSeconds: typeof song.duration === 'number' ? song.duration : null,
        },
        song.audioUrl!
      );
      showAlert({
        title: 'Download Complete',
        message: 'Song saved for offline listening on this device.',
        type: 'success'
      });
    } catch (error) {
      console.error('Error downloading song:', error);
      showAlert({
        title: 'Download Failed',
        message: error instanceof Error ? error.message : 'Failed to download song. Please try again.',
        type: 'error'
      });
    } finally {
      setIsDownloadInProgress(false);
    }
  };

  const handleToggleFollow = async () => {
    if (!isAuthenticated) {
      // Show auth modal for non-authenticated users
      onShowAuthModal?.();
      return;
    }

    if (!artistUserId) {
      console.warn('No artistUserId available for follow action');
      return;
    }

    setIsLoadingFollow(true);
    try {
      if (isFollowingArtist) {
        await unfollowUser(artistUserId);
        setIsFollowingArtist(false);
        setArtistFollowerCount(prev => Math.max(0, prev - 1));
        // Update cache
        if (song.artistId) {
          artistCache.updateFollowerCount(song.artistId, -1);
        }
      } else {
        await followUser(artistUserId);
        setIsFollowingArtist(true);
        setArtistFollowerCount(prev => prev + 1);
        // Update cache
        if (song.artistId) {
          artistCache.updateFollowerCount(song.artistId, 1);
        }
        // Track artist follow for contribution rewards
        recordContribution('artist_follow', artistUserId, 'artist').catch(console.error);
      }
    } catch (error) {
      console.error('Error toggling follow status:', error);
      // Show user-friendly error message
      if (error instanceof Error && error.message.includes('not authenticated')) {
        onShowAuthModal?.();
      } else {
        alert('Failed to update follow status. Please try again.');
      }
    } finally {
      setIsLoadingFollow(false);
    }
  };

  const handleShare = () => {
    // Open share sheet immediately; log analytics in background
    shareSong(song.id, song.title, song.artist).catch((error) => {
      console.error('Error sharing song:', error);
    });
    recordShareEvent(song.id, 'song').catch((error) => {
      console.error('Error recording share event:', error);
    });
    recordContribution('content_share', song.id, 'song').catch(console.error);
  };

  const handleAdClick = () => {
    if (adContent?.link) {
      window.open(adContent.link, '_blank', 'noopener,noreferrer');
    }
  };

  const handleAddToPlaylist = async () => {
    if (!isAuthenticated) {
      onShowAuthModal?.();
      return;
    }

    setIsLoadingPlaylists(true);
    try {
      const playlists = await getUserPlaylistsForSong(song.id);
      setUserPlaylists(playlists);
      setShowPlaylistsDropdown(true);
    } catch (error) {
      console.error('Error loading playlists:', error);
    } finally {
      setIsLoadingPlaylists(false);
    }
  };

  const handleToggleSongInPlaylist = async (playlistId: string) => {
    try {
      await toggleSongInPlaylist(playlistId, song.id);

      // Update playlists state to reflect the change
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
    if (showPlaylistsDropdown) {
      handleAddToPlaylist();
    }
  };

  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  const handleClose = () => {
    // Just close the player; rely on the global playback ad logic and cooldown
    // so we never stack fullscreen ads when leaving this screen.
    onClose();
  };

  const shouldShowFollowButton = Boolean(song.artistId) && Boolean(currentUserId) && currentUserId !== artistUserId;

  return (
    <div className="music-player-root fixed inset-0 z-50 flex flex-col bg-[#0a0a0a] animate-in fade-in duration-300 touch-manipulation overflow-hidden pb-[env(safe-area-inset-bottom,0px)]">
      {/* Main Content — scrollable, seamless with header */}
      <div
        className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide"
        style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div
          className="flex-1 flex flex-col px-3 pb-4"
          style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)' }}
        >
          {/* Player block — seamless, no card background */}
          <div className="min-h-0 flex flex-col overflow-hidden">
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
                  onClick={() => {
                    if (artistUserId) {
                      handleClose();
                      navigate(`/user/${artistUserId}`);
                    }
                  }}
                >
                  <Avatar className="w-9 h-9 flex-shrink-0">
                    <AvatarImage src={artistProfile?.avatar_url || artistProfile?.profile_photo_url || undefined} />
                    <AvatarFallback className="bg-[#00ad74] text-white font-semibold text-xs">
                      {(song.artist || 'A').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 text-left">
                    <h3 className="font-bold text-white text-sm truncate leading-tight">
                      {song.artist || 'Unknown Artist'}
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

            {/* Artwork / Inline Native Ad Slot */}
            <div className="px-3 py-4 flex-1 min-h-0">
              {inlineAd && showInlineAd ? (
                <PlayerStaticAdBanner
                  ad={inlineAd}
                  className="w-full rounded-2xl shadow-lg"
                />
              ) : (
                <div className="relative rounded-2xl overflow-hidden bg-white/5 w-full aspect-square shadow-lg">
                  {song.coverImageUrl ? (
                    <img src={song.coverImageUrl} alt={song.title} className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-white/5">
                      <span className="text-4xl font-bold text-white/30">♪</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Track info */}
            <div className="px-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-white truncate leading-tight">
                  {song.title}
                </h2>
                <p className="text-sm text-white/70 mt-0.5 truncate">
                  {song.artist}
                  {song.featuredArtists && song.featuredArtists.length > 0 && ` · Ft ${song.featuredArtists.join(', ')}`}
                </p>
              </div>
              <button
                onClick={() => {
                  if (!isAuthenticated) onShowAuthModal?.();
                  else setShowTippingModal(true);
                }}
                className="flex-shrink-0 p-1.5 mt-0.5 text-white/70 hover:text-white transition-colors"
              >
                <Gift className="w-5 h-5" />
              </button>
            </div>

            {/* song_bonus ~every 1.5 songs; rewarded interstitial every 3 — separate counters. Claim → VITE_ADMOB_REWARDED_ID */}
            {showSongBonusPrompt && (
              <div className="mx-3 mt-3 mb-1 flex items-center justify-between gap-3 rounded-2xl bg-white/10 border border-white/15 px-3 py-2 shadow-lg">
                <div className="flex flex-col">
                  <span className="text-[11px] font-semibold text-white">Get bonus score</span>
                  <span className="text-[10px] text-white/70">Watch a short ad to earn extra listener score.</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowSongBonusPrompt(false);
                    if (!song?.id) return;
                    showSongBonusRewarded({ contentId: song.id }).catch(() => {});
                  }}
                  className="px-3 py-1.5 rounded-full bg-white text-[11px] font-semibold text-black active:scale-95 hover:opacity-90 transition-all"
                >
                  Claim
                </button>
              </div>
            )}

            {/* Progress */}
            <div className="px-3 mt-4">
              <div className="relative mb-2">
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  value={currentTime}
                  onChange={handleSeek}
                  aria-label="Seek track position"
                  className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer slider focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]"
                />
              </div>
              <div className="flex justify-between mt-1 text-[11px] text-white/60 tabular-nums select-none">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Playback controls */}
            <div className="flex items-center justify-center gap-6 px-3 pt-4 pb-2">
              <button
                onClick={handleToggleFavorite}
                className={cn(
                  'hover:scale-110 p-1 transition-all',
                  isFavorited ? 'text-red-500' : 'text-white/80 hover:text-white'
                )}
                aria-label={isFavorited ? 'Unlike song' : 'Like song'}
              >
                <Heart className={cn('w-5 h-5', isFavorited && 'fill-red-500')} />
              </button>
              <button onClick={handlePreviousSong} className="text-white hover:scale-110 active:scale-95 transition-transform p-1" aria-label="Previous track">
                <SkipBack className="w-6 h-6 fill-current" />
              </button>
              <button
                onClick={togglePlayPause}
                disabled={isLoading || !!error}
                className="w-14 h-14 rounded-full flex items-center justify-center bg-white text-[#0a0a0a] hover:scale-[1.06] active:scale-95 transition-all duration-200 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isLoading ? (
                  <Spinner size={20} className="text-[#0a0a0a]" />
                ) : isPlaying ? (
                  <Pause className="w-6 h-6" />
                ) : (
                  <Play className="w-6 h-6 ml-0.5" />
                )}
              </button>
              <button onClick={handleNextSong} className="text-white hover:scale-110 active:scale-95 transition-transform p-1" aria-label="Next track">
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
                            {userPlaylists.map(pl => (
                              <button
                                key={pl.id}
                                onClick={() => handleToggleSongInPlaylist(pl.id)}
                                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-white hover:bg-white/10 active:bg-white/15 transition-colors text-left rounded-xl mx-2"
                              >
                                <span className="truncate font-medium">{pl.title}</span>
                                {pl.hasSong && <Check className="w-5 h-5 text-[#00ad74] flex-shrink-0" />}
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
                {song.audioUrl ? (
                  <button
                    type="button"
                    onClick={() => void handleToggleDownload()}
                    disabled={isDownloadInProgress}
                    className={cn(
                      'p-2 rounded-full transition-colors disabled:opacity-50',
                      songIsDownloaded
                        ? 'shrink-0 hover:bg-red-500/20 active:bg-red-500/25'
                        : 'text-white/80 hover:text-white hover:bg-white/10'
                    )}
                    title={songIsDownloaded ? 'Remove offline download' : 'Download for offline'}
                  >
                    {isDownloadInProgress ? (
                      <Spinner size={18} className="text-white" />
                    ) : songIsDownloaded ? (
                      <X className="w-3.5 h-3.5 text-white/50" aria-hidden />
                    ) : (
                      <ArrowDownToLine className="w-[18px] h-[18px]" />
                    )}
                  </button>
                ) : null}
                <button
                  onClick={handleShare}
                  className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all"
                  title="Share"
                >
                  <Share2 className="w-[18px] h-[18px]" />
                </button>
                <button
                  onClick={() => setShowReportModal(true)}
                  className="p-2 rounded-full text-red-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title="Report"
                >
                  <Flag className="w-[18px] h-[18px]" />
                </button>
              </div>
              {currentPlayCount != null && currentPlayCount > 0 && (
                <div className="flex items-center gap-1.5 text-white/60 text-xs">
                  <Play className="w-3.5 h-3.5" fill="currentColor" />
                  <span className="font-semibold text-white">{formatNumber(currentPlayCount)}</span>
                  <span>plays</span>
                </div>
              )}
            </div>
          </div>

          {/* More from — no border */}
          {song.artistId && (
            <div className="rounded-2xl bg-white/[0.04] overflow-hidden mb-5">
              <div className="px-5 py-4">
                <ArtistTopTracksSection
                artistId={song.artistId}
                artistName={song.artist}
                currentSongId={song.id}
                onSongSelect={(selectedSong) => {
                  onSongChange?.(selectedSong);
                }}
                onAlbumSelect={(albumId) => {
                  handleClose();
                  navigate(`/album/${albumId}`);
                }}
              />
            </div>
          </div>
        )}

        {/* Similar to this song — no border */}
        <div className="rounded-2xl bg-white/[0.04] overflow-hidden mb-5">
          <div className="px-5 py-4">
            <SimilarSongsSection
              currentSong={song}
              onSongSelect={(selectedSong) => {
                onSongChange?.(selectedSong);
              }}
            />
          </div>
        </div>

        {/* Ad Space */}
        {adContent && (
          <div
            className="w-full max-w-sm mx-auto h-20 rounded-2xl overflow-hidden cursor-pointer shadow-lg"
            onClick={handleAdClick}
          >
            {adContent.type === 'image' && (
              <img
                src={adContent.content}
                alt="Advertisement"
                className="w-full h-full object-cover"
              />
            )}
            {adContent.type === 'html' && (
              <div
                className="w-full h-full"
                dangerouslySetInnerHTML={createSafeHtml(adContent.content)}
              />
            )}
            {adContent.type === 'video' && (
              <video
                src={adContent.content}
                className="w-full h-full object-cover"
                muted
                loop
              />
            )}
          </div>
        )}

        {/* Error Message */}
        {(playerError || error) && (
          <div className="w-full max-w-sm mx-auto mt-4 p-4 bg-red-500/10 rounded-2xl backdrop-blur-sm">
            <p className="text-red-400 text-sm text-center font-medium">
              {playerError || error}
            </p>
          </div>
        )}
        </div>
      </div>

      {/* Video element for video content only */}
      {song.videoUrl && (
        <video ref={videoRef} preload="none" className="hidden" />
      )}

      {/* Comments Modal */}
      {showCommentsModal && (
        <CommentsModal
          contentId={song.id}
          contentType="song"
          contentTitle={song.title}
          onClose={() => {
            setShowCommentsModal(false);
            loadCommentCount();
          }}
        />
      )}

      {/* Tipping Modal */}
      {showTippingModal && (
        <TippingModal
          onClose={() => setShowTippingModal(false)}
          onSuccess={() => setShowTippingModal(false)}
          recipientId={song.artistId}
          contentId={song.id}
          contentType="song"
          recipientName={artistProfile?.display_name || song.artist}
          recipientAvatar={artistProfile?.avatar_url || null}
        />
      )}

      {/* Create Playlist Modal */}
      {showCreatePlaylistModal && (
        <CreatePlaylistModal
          onClose={() => setShowCreatePlaylistModal(false)}
          onSuccess={handleCreatePlaylistSuccess}
          initialSongId={song.id}
        />
      )}

      {/* Report Modal */}
      {showReportModal && (
        <ReportModal
          contentType="song"
          contentId={song.id}
          contentTitle={song.title}
          reportedUserId={song.artistId}
          onClose={() => setShowReportModal(false)}
          onSuccess={() => {
            setShowReportModal(false);
          }}
        />
      )}

      {/* Download Confirmation */}
      <CustomConfirmDialog
        isOpen={showDownloadConfirm}
        title="Download for Offline?"
        message={`Download "${song.title}" by ${song.artist} for offline listening? This will use storage space on your device.`}
        confirmText="Download"
        cancelText="Cancel"
        variant="info"
        onConfirm={handleConfirmDownload}
        onCancel={() => setShowDownloadConfirm(false)}
        isLoading={isDownloadInProgress}
      />

      <style>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #ffffff;
          cursor: pointer;
          border: 2px solid #ffffff;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        }

        .slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #ffffff;
          cursor: pointer;
          border: 2px solid #ffffff;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        }

        .slider::-webkit-slider-track {
          background: linear-gradient(to right, #ffffff 0%, #ffffff ${duration ? (currentTime / duration) * 100 : 0}%, rgba(255, 255, 255, 0.3) ${duration ? (currentTime / duration) * 100 : 0}%, rgba(255, 255, 255, 0.3) 100%);
          border-radius: 10px;
        }

        .music-player-root, .music-player-root * {
          -webkit-tap-highlight-color: transparent;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -khtml-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
        }

        .music-player-root .touch-manipulation {
          touch-action: manipulation;
        }
      `}</style>

    </div>
  );
};
