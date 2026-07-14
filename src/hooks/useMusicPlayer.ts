import { useState, useRef, useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useAuth } from '../contexts/AuthContext';
import { recordPlayback } from '../lib/playbackTracker';
import { supabase } from '../lib/supabase';
import { loadPlaybackState, getSongsFromIds } from '../lib/playbackState';
import { getSmartAutoplayRecommendation } from '../lib/smartAutoplayService';
import { getNextSongFromHistory } from '../lib/recentlyPlayedService';
import { getTrendingFallbackSong } from '../lib/trendingFallbackService';
import { generateContextKey, loadContextSettings, saveContextSettings } from '../lib/contextSettings';
import { trackListeningEngagement } from '../lib/contributionService';
import { logger } from '../lib/logger';
import { resolveSongForPlayback } from '../lib/offlineAudioService';
import {
  updateMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
  setMediaSessionActionHandlers,
} from '../lib/mediaSession';
import { playNativeAudioAdForPlacement, resetNativeAudioAdCadenceForPlacement } from '../lib/nativeAdService';

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  duration?: number;
  playCount?: number;
  featuredArtists?: string[] | null;
}

interface MusicPlayerState {
  currentSong: Song | null;
  playlist: Song[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  audioElement: HTMLAudioElement | null;
  isFullPlayerVisible: boolean;
  isMiniPlayerVisible: boolean;
  error: string | null;
  playlistContext: string;
  albumId: string | null;
  playlistId: string | null;
  isShuffleEnabled: boolean;
  repeatMode: 'off' | 'one' | 'all';
  shuffledPlaylist: Song[];
}


const isDiscoveryContext = (context?: string): boolean => {
  if (!context) return true;

  // Explicitly check for non-discovery contexts first
  // These are curated collections that should NOT use Smart Autoplay
  if (context.startsWith('playlist-') ||
      context.startsWith('album-') ||
      context.startsWith('mix-') ||
      context.startsWith('profile-') ||
      context === 'Album' ||
      context === 'Playlist') {
    return false;
  }

  const discoveryContexts = [
    'Global Trending',
    'Trending Near You',
    'New Releases',
    'Trending Albums',
    'AI Recommended',
    'Inspired By You',
    'Explore',
    'unknown',
    'smart-autoplay'  // Smart Autoplay is a discovery context that should continue playing
  ];

  return discoveryContexts.includes(context);
};

function isPlaybackAudioUrl(url: string): boolean {
  if (url.startsWith('https://')) return true;
  if (url.startsWith('blob:')) return true;
  if (url.startsWith('http://localhost')) return true;
  if (url.includes('/_capacitor_file_/')) return true;
  return false;
}

function resolveNativePlayerPlacementFromContext(context: string | undefined): string {
  if (!context) return 'music_player';
  if (context.startsWith('album-') || context === 'Album') return 'album_player';
  if (context.startsWith('playlist-') || context === 'Playlist') return 'playlist_player';
  if (context.startsWith('daily-mix-')) return 'daily_mix_player';
  return 'music_player';
}

function resolveNativePlayerPlacement(state: Pick<MusicPlayerState, 'playlistContext' | 'albumId' | 'playlistId'>): string {
  const fromContext = resolveNativePlayerPlacementFromContext(state.playlistContext);
  if (fromContext !== 'music_player') return fromContext;
  // Fallback to explicit identifiers when context is unavailable/stale.
  if (state.playlistId) return 'playlist_player';
  if (state.albumId) return 'album_player';
  return 'music_player';
}

export const useMusicPlayer = () => {
  const { session } = useAuth();

  const [state, setState] = useState<MusicPlayerState>({
    currentSong: null,
    playlist: [],
    currentIndex: 0,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    audioElement: null,
    isFullPlayerVisible: false,
    isMiniPlayerVisible: false,
    error: null,
    playlistContext: 'unknown',
    albumId: null,
    playlistId: null,
    isShuffleEnabled: false,
    repeatMode: 'off',
    shuffledPlaylist: [],
  });

  const playbackStartTimeRef = useRef<number | null>(null);
  const hasRecordedPlaybackRef = useRef(false);
  const audioCleanupRef = useRef<(() => void) | null>(null);
  // True when the user explicitly hit pause; false means any pause was system-initiated (screen lock, audio focus loss).
  const intentionalPauseRef = useRef(false);
  const lastSaveTimeRef = useRef<number>(0);
  const playNextSongRef = useRef<(() => void) | null>(null);
  const isAudioAdPlayingRef = useRef(false);
  const stateRef = useRef<MusicPlayerState>(state);
  const togglePlayPauseRef = useRef<(() => void) | null>(null);
  const playNextRef = useRef<(() => void) | null>(null);
  const playPreviousRef = useRef<(() => void) | null>(null);
  const lastPositionUpdateRef = useRef<number>(0);
  const currentContextKeyRef = useRef<string>('');
  const hasTrackedSongStartRef = useRef(false);
  const hasTrackedSongCompleteRef = useRef(false);
  const currentSongGenreRef = useRef<string | null>(null);
  const currentSongArtistPlaysRef = useRef<number | null>(null);

  // Keep stateRef in sync with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Cleanup effect for when the hook unmounts
  useEffect(() => {
    return () => {
      // Clean up any active audio element when the hook unmounts
      if (audioCleanupRef.current) {
        audioCleanupRef.current();
        audioCleanupRef.current = null;
      }
    };
  }, []);

  // Auto-save playback state
  useEffect(() => {
    const saveInterval = setInterval(() => {
      if (state.currentSong && state.isPlaying) {
        savePlaybackState();
      }
    }, 10000); // Save every 10 seconds

    return () => clearInterval(saveInterval);
  }, [state.currentSong, state.currentTime, state.isPlaying, state.currentIndex, state.playlist]);

  // Removed redundant useEffect that was causing performance issues
  // shuffledPlaylist is now updated directly in playSong() and toggleShuffle()

  // Load context-specific settings when context changes
  useEffect(() => {
    const loadSettings = async () => {
      const contextKey = generateContextKey(state.playlistContext, state.albumId);

      if (contextKey !== currentContextKeyRef.current) {
        currentContextKeyRef.current = contextKey;

        // Reset audio ad song counters when the playback context changes so
        // "Play this audio ad after N songs" starts counting fresh in the new session.
        try {
          const placementType = resolveNativePlayerPlacement(state);
          resetNativeAudioAdCadenceForPlacement(placementType);
        } catch {
          // Must never block playback.
        }

        const settings = await loadContextSettings(contextKey);

        setState(prev => ({
          ...prev,
          isShuffleEnabled: settings.shuffle_enabled,
          repeatMode: settings.repeat_mode,
          shuffledPlaylist: settings.shuffle_enabled && prev.playlist.length > 1
            ? [...prev.playlist].sort(() => Math.random() - 0.5)
            : [...prev.playlist],
        }));
      }
    };

    if (state.playlistContext && state.currentSong) {
      loadSettings();
    }
  }, [state.playlistContext, state.albumId, state.currentSong]);

  const createAudioElement = useCallback((song: Song): { audio: HTMLAudioElement; cleanup: () => void } | null => {
    if (!song.audioUrl) {
      logger.error('Cannot create audio element: song.audioUrl is missing', song);
      return null;
    }

    const url = song.audioUrl;
    if (!isPlaybackAudioUrl(url)) {
      logger.error('Invalid audio URL for playback:', song.audioUrl);
      setState(prev => ({ ...prev, error: 'Invalid audio URL format. Please re-upload this song.' }));
      return null;
    }

    // Check if URL is malformed (missing CDN domain) - only for https URLs, not blob/local
    if (url.startsWith('https://') && url.includes('https://airaplay/')) {
      logger.error('Malformed audio URL detected: missing .b-cdn.net domain', song.audioUrl);
      setState(prev => ({ ...prev, error: 'Audio file URL is malformed. Please re-upload this song.' }));
      return null;
    }

    const audio = new Audio();
    audio.src = url;

    audio.preload = 'metadata';

    // Only set crossOrigin if the URL is from a different origin
    // Blob / Capacitor local URLs don't need CDN CORS
    if (!url.startsWith('blob:') && !url.startsWith('http://localhost') && !url.includes('/_capacitor_file_/')) {
      const audioUrl = new URL(url, window.location.href);
      const isCrossOrigin = audioUrl.origin !== window.location.origin;

      if (isCrossOrigin) {
        audio.crossOrigin = 'anonymous';
      }
    }

    // Create event handler functions so we can remove them later
    const handleLoadedMetadata = () => {
      setState(prev => ({ ...prev, duration: audio.duration }));
    };

    const handleTimeUpdate = () => {
      setState(prev => ({ ...prev, currentTime: audio.currentTime }));
    };

    const handlePlay = async () => {
      setState(prev => ({ ...prev, isPlaying: true, error: null }));
      playbackStartTimeRef.current = Date.now();
      hasRecordedPlaybackRef.current = false;
      hasTrackedSongCompleteRef.current = false;

      // Track song start for contribution rewards (only once per song)
      if (!hasTrackedSongStartRef.current) {
        hasTrackedSongStartRef.current = true;

        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            // Fetch song details for genre and artist total plays
            const { data: songData } = await supabase
              .from('songs')
              .select('genre, artist_id')
              .eq('id', song.id)
              .single();

            if (songData) {
              currentSongGenreRef.current = songData.genre || null;

              // Get artist total plays if artist_id exists
              if (songData.artist_id) {
                const { count } = await supabase
                  .from('playback_history')
                  .select('*', { count: 'exact', head: true })
                  .eq('artist_id', songData.artist_id);

                currentSongArtistPlaysRef.current = count || null;
              }

              // Track song started
              await trackListeningEngagement(
                user.id,
                song.id,
                false,
                currentSongGenreRef.current || undefined,
                currentSongArtistPlaysRef.current || undefined
              );
            }
          }
        } catch (error) {
          logger.error('Error tracking song start', error);
        }
      }
    };

    const handleCanPlay = () => {
      setState(prev => ({ ...prev, error: null }));
    };

    const handlePause = async () => {
      setState(prev => ({ ...prev, isPlaying: false }));
      // Record playback when paused
      if (playbackStartTimeRef.current && !hasRecordedPlaybackRef.current) {
        const durationListened = Math.floor((Date.now() - playbackStartTimeRef.current) / 1000);
        recordPlayback(song.id, durationListened, false, false, session ?? undefined);
        hasRecordedPlaybackRef.current = true;
      }

      // Track song completion for contribution rewards (if 80%+ listened)
      if (!hasTrackedSongCompleteRef.current && audio.duration > 0) {
        const completionPercentage = (audio.currentTime / audio.duration) * 100;

        if (completionPercentage >= 80) {
          hasTrackedSongCompleteRef.current = true;

          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              await trackListeningEngagement(
                user.id,
                song.id,
                true,
                currentSongGenreRef.current || undefined,
                currentSongArtistPlaysRef.current || undefined
              );
            }
          } catch (error) {
            logger.error('Error tracking song completion on pause', error);
          }
        }
      }
    };

    const handleEnded = async () => {
      // Record playback when song ends
      if (playbackStartTimeRef.current && !hasRecordedPlaybackRef.current) {
        const durationListened = Math.floor((Date.now() - playbackStartTimeRef.current) / 1000);
        recordPlayback(song.id, durationListened, false, false, session ?? undefined);
        hasRecordedPlaybackRef.current = true;
      }

      // Track song completion for contribution rewards (song ended = 100% completion)
      if (!hasTrackedSongCompleteRef.current) {
        hasTrackedSongCompleteRef.current = true;

        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await trackListeningEngagement(
              user.id,
              song.id,
              true,
              currentSongGenreRef.current || undefined,
              currentSongArtistPlaysRef.current || undefined
            );
          }
        } catch (error) {
          logger.error('Error tracking song completion on end', error);
        }
      }

      setState(prev => ({ ...prev, isPlaying: false }));

      // Use stateRef to get current state, not stale closure state
      const currentState = stateRef.current;

      // Handle repeat one mode
      if (currentState.repeatMode === 'one') {
        if (currentState.audioElement) {
          currentState.audioElement.currentTime = 0;
          currentState.audioElement.play().catch(err => {
            if (err.name !== 'AbortError') {
              logger.error('Error replaying audio', err);
            }
          });
        }
        return;
      }

      // Attempt to play native audio ads between songs for player placements.
      // Audio ad cadence is configured per audio ad (2/3/5/6/8/10 songs).
      // Any ad failure must not block autoplay progression.
      try {
        isAudioAdPlayingRef.current = true;
        const placementType = resolveNativePlayerPlacement(currentState);
        // Fresh user metadata — createAudioElement is memoized with [] and would otherwise read a stale session.
        let userCountry: string | null = null;
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && typeof user.user_metadata?.country === 'string') {
            userCountry = user.user_metadata.country;
          }
        } catch {
          // Ignore; ads still work without country targeting.
        }

        await playNativeAudioAdForPlacement(
          placementType,
          userCountry,
          undefined,
          {
            maxDurationMs: 30_000,
            // Per-ad song interval controls insertion timing.
            minIntervalMs: 0,
          }
        );
      } catch (adError) {
        logger.warn('Audio ad between songs failed; continuing playback', adError);
      } finally {
        isAudioAdPlayingRef.current = false;
      }

      const getCurrentPlaylist = () => {
        return currentState.isShuffleEnabled ? currentState.shuffledPlaylist : currentState.playlist;
      };

      const currentPlaylist = getCurrentPlaylist();
      const isAtEndOfPlaylist = currentPlaylist.length > 0 && currentState.currentIndex >= currentPlaylist.length - 1;
      const isDiscovery = isDiscoveryContext(currentState.playlistContext);

      // Handle repeat all mode - restart playlist from beginning
      if (currentState.repeatMode === 'all' && currentPlaylist.length > 0) {
        playNextSongRef.current?.();
        return;
      }

      // PRIORITY: If there are more songs in the playlist, play next (regardless of context type)
      if (currentPlaylist.length > 0 && !isAtEndOfPlaylist) {
        if (playNextSongRef.current) {
          playNextSongRef.current();
        }
        return;
      }

      // At end of playlist - behavior depends on context
      if (isAtEndOfPlaylist && currentPlaylist.length > 0) {
        // Check for creator profile context - transition from singles to albums
        if (currentState.playlistContext.startsWith('profile-') && currentState.playlistContext.endsWith('-singles')) {

          const userId = currentState.playlistContext.replace('profile-', '').replace('-singles', '');

          try {
            const { getCreatorAlbumTracks } = await import('../lib/creatorPlaybackHelper');
            const { tracks: albumTracks } = await getCreatorAlbumTracks(userId);

            if (albumTracks.length > 0) {
              const firstAlbumTrack = albumTracks[0];
              const albumContext = `profile-${userId}-albums`;

              // Update state with album playlist
              setState(prev => ({
                ...prev,
                currentSong: firstAlbumTrack,
                playlist: albumTracks,
                currentIndex: 0,
                playlistContext: albumContext,
                isPlaying: false,
                shuffledPlaylist: prev.isShuffleEnabled && albumTracks.length > 1
                  ? [...albumTracks].sort(() => Math.random() - 0.5)
                  : [...albumTracks],
              }));

              const resolvedFirst = await resolveSongForPlayback(firstAlbumTrack);
              const result = createAudioElement(resolvedFirst);
              if (result) {
                const { audio, cleanup } = result;

                if (audioCleanupRef.current) {
                  audioCleanupRef.current();
                }
                audioCleanupRef.current = cleanup;

                setState(prev => ({ ...prev, audioElement: audio }));

                audio.play().catch(err => {
                  if (err.name !== 'AbortError') {
                    logger.error('handleEnded: Error playing first album track', err);
                  }
                });
              }

              return;
            } else {
              // No more content from this creator, stop playback
              return;
            }
          } catch (error) {
            logger.error('handleEnded: Error fetching album tracks', error);
            // On error, stop playback
            return;
          }
        }
        // Check for creator profile albums context - all content has been played, stop playback
        else if (currentState.playlistContext.startsWith('profile-') && currentState.playlistContext.endsWith('-albums')) {
          // All creator content exhausted, stop playback
          return;
        }
        // For non-discovery contexts (albums, playlists), ALWAYS stop playback - never use Smart Autoplay
        else if (!isDiscovery) {
          return;
        }
        else if (currentState.repeatMode !== 'off') {
          return;
        } else {
          // Fall through to Smart Autoplay logic below
        }
      } else if (currentPlaylist.length === 0) {
        return;
      } else {
        return;
      }

      // Smart Autoplay logic (only reached for discovery contexts at end of playlist with repeat off)
      let nextSong: Song | null = null;
      nextSong = await getSmartAutoplayRecommendation(
        song, 
        currentState.playlistContext, 
        currentState.albumId,
        currentPlaylist // Pass current playlist for duplicate checking
      );

      if (nextSong) {
      } else {
        nextSong = await getNextSongFromHistory(song);
        // Validate fallback recommendation
        if (nextSong) {
          const isDuplicate = currentPlaylist.some(s => s.id === nextSong!.id);
          const isCurrentSong = nextSong.id === song.id;
          if (isDuplicate || isCurrentSong) {
            nextSong = null;
          }
        }
      }

      if (nextSong) {
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const userCountry = user?.user_metadata?.country || 'NG';
        nextSong = await getTrendingFallbackSong(userCountry);
        // Validate trending fallback recommendation
        if (nextSong) {
          const isDuplicate = currentPlaylist.some(s => s.id === nextSong!.id);
          const isCurrentSong = nextSong.id === song.id;
          if (isDuplicate || isCurrentSong) {
            nextSong = null;
          }
        }
      }

      if (nextSong) {
        // Final validation before appending to playlist
        const isDuplicate = currentPlaylist.some(s => s.id === nextSong!.id);
        const isCurrentSong = nextSong.id === song.id;

        if (isDuplicate || isCurrentSong) {
          return;
        }

        // Append the recommended song to the playlist for continuous discovery
        // Limit playlist to last 30 songs to prevent accumulation and improve performance
        setState(prev => {
          const updatedPlaylist = [...prev.playlist, nextSong];
          // Keep only last 30 songs to prevent playlist from growing indefinitely
          const limitedPlaylist = updatedPlaylist.slice(-30);
          const newIndex = limitedPlaylist.length - 1;
          const newContext = prev.playlistContext || 'smart-autoplay';

          return {
            ...prev,
            currentSong: nextSong,
            currentIndex: newIndex,
            playlist: limitedPlaylist,
            playlistContext: newContext,
            isPlaying: false,
            // Update shuffled playlist if shuffle is enabled (also limit to 30)
            shuffledPlaylist: prev.isShuffleEnabled
              ? [...prev.shuffledPlaylist, nextSong].slice(-30)
              : limitedPlaylist
          };
        });

        const resolvedNext = await resolveSongForPlayback(nextSong);
        const result = createAudioElement(resolvedNext);
        if (result) {
          const { audio, cleanup } = result;

          if (audioCleanupRef.current) {
            audioCleanupRef.current();
          }
          audioCleanupRef.current = cleanup;

          setState(prev => ({ ...prev, audioElement: audio }));

          audio.play().catch(err => {
            if (err.name !== 'AbortError') {
              logger.error('useMusicPlayer: Error playing smart autoplay song', err);
            }
          });
        }
      }
    };

    const handleError = (e: Event) => {
      const target = e.target as HTMLAudioElement;
      const mediaError = target.error;
      let errorMessage = 'Failed to load audio';

      if (mediaError) {
        switch (mediaError.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            errorMessage = 'Audio loading was aborted';
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            errorMessage = 'Check your connection or skip to the next song.';
            break;
          case MediaError.MEDIA_ERR_DECODE:
            errorMessage = 'Check your connection or skip to the next song.';
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMessage = 'Check your connection or skip to the next song.';
            break;
          default:
            errorMessage = 'Check your connection or skip to the next song.';
        }
      }

      logger.error('Audio playback error', {
        message: errorMessage,
        mediaErrorCode: mediaError?.code,
        songId: song.id,
        songTitle: song.title
      });

      if (song.audioUrl?.startsWith('https://')) {
        fetch(song.audioUrl, { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
      }

      setState(prev => ({ ...prev, isPlaying: false, error: errorMessage }));
    };

    // Add event listeners
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    // Create cleanup function
    const cleanup = () => {
      try {
        // Record playback before cleanup if needed
        if (playbackStartTimeRef.current && !hasRecordedPlaybackRef.current) {
          const durationListened = Math.floor((Date.now() - playbackStartTimeRef.current) / 1000);
          recordPlayback(song.id, durationListened, false, false, session ?? undefined);
          hasRecordedPlaybackRef.current = true;
        }

        // Pause the audio first
        audio.pause();
        
        // Clear the source to stop any ongoing loading
        audio.src = '';
        audio.load(); // This will abort any ongoing network requests
        
        // Remove all event listeners
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('canplay', handleCanPlay);
        audio.removeEventListener('play', handlePlay);
        audio.removeEventListener('pause', handlePause);
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
      } catch (cleanupError) {
        logger.warn('Error during audio cleanup', cleanupError);
      }
    };

    return { audio, cleanup };
  }, []);

  // Update playNext ref to always use the latest state
  useEffect(() => {
    playNextSongRef.current = () => {
      void (async () => {
        const getCurrentPlaylist = () => {
          return state.isShuffleEnabled ? state.shuffledPlaylist : state.playlist;
        };

        const currentPlaylist = getCurrentPlaylist();
        if (currentPlaylist.length === 0) return;

        let nextIndex: number;
        let nextSongInOriginalPlaylist: number;

        if (state.isShuffleEnabled) {
          const currentShuffledIndex = state.shuffledPlaylist.findIndex(s => s.id === state.currentSong?.id);
          if (currentShuffledIndex === state.shuffledPlaylist.length - 1) {
            if (state.repeatMode === 'all') {
              nextIndex = 0;
            } else {
              return;
            }
          } else {
            nextIndex = currentShuffledIndex + 1;
          }

          const nextSongId = state.shuffledPlaylist[nextIndex]?.id;
          nextSongInOriginalPlaylist = state.playlist.findIndex(s => s.id === nextSongId);
        } else {
          if (state.currentIndex === currentPlaylist.length - 1) {
            if (state.repeatMode === 'all') {
              nextIndex = 0;
            } else {
              return;
            }
          } else {
            nextIndex = state.currentIndex + 1;
          }
          nextSongInOriginalPlaylist = nextIndex;
        }

        const nextSong = currentPlaylist[nextIndex];
        if (!nextSong) return;

        if (audioCleanupRef.current) {
          audioCleanupRef.current();
          audioCleanupRef.current = null;
        }

        const resolved = await resolveSongForPlayback(nextSong);
        const audioResult = createAudioElement(resolved);
        if (!audioResult) return;

        const { audio: newAudio, cleanup } = audioResult;
        audioCleanupRef.current = cleanup;

        setState(prev => ({
          ...prev,
          currentSong: nextSong,
          currentIndex: nextSongInOriginalPlaylist >= 0 ? nextSongInOriginalPlaylist : nextIndex,
          audioElement: newAudio,
          currentTime: 0,
          duration: 0,
          error: null,
        }));

        newAudio.play().catch(err => {
          if (err.name !== 'AbortError') {
            logger.error('Error playing audio', err);
          }
        });
      })();
    };
  }, [state, createAudioElement]);

  const savePlaybackState = useCallback(async () => {
    const now = Date.now();
    if (now - lastSaveTimeRef.current < 5000) return; // Throttle saves
    lastSaveTimeRef.current = now;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user || !state.currentSong) return;

      const { error } = await supabase
        .from('user_playback_state')
        .upsert({
          user_id: session.user.id,
          song_id: state.currentSong.id,
          playback_position: Math.floor(state.currentTime),
          playlist: state.playlist.map(s => s.id),
          current_index: state.currentIndex,
          playlist_context: state.playlistContext,
          is_shuffle_enabled: state.isShuffleEnabled,
          repeat_mode: state.repeatMode,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (error) {
        logger.warn('Failed to save playback state', error);
      }
    } catch (error) {
      logger.warn('Error saving playback state', error);
    }
  }, [state.currentSong, state.currentTime, state.currentIndex, state.playlist, state.playlistContext, state.isShuffleEnabled, state.repeatMode]);

  // Removed preloadNextSong function - preloading disabled to save bandwidth


  const playNext = useCallback(() => {
    const getCurrentPlaylist = () => {
      return state.isShuffleEnabled ? state.shuffledPlaylist : state.playlist;
    };

    const currentPlaylist = getCurrentPlaylist();

    if (currentPlaylist.length === 0) {
      logger.warn('playNext: Cannot play next - playlist is empty');
      return;
    }

    void (async () => {
      // Ensure no song audio is playing while an audio ad is playing.
      // If the user taps "Next" mid-song, pause immediately before attempting the ad.
      try {
        const currentAudio = stateRef.current.audioElement;
        if (currentAudio && !currentAudio.paused) {
          currentAudio.pause();
        }
      } catch {
        // Ignore pause failures; ad flow should continue.
      }
      setState((prev) => ({ ...prev, isPlaying: false }));

      let nextIndex: number;
      if (state.isShuffleEnabled) {
        const currentShuffledIndex = state.shuffledPlaylist.findIndex(s => s.id === state.currentSong?.id);
        if (currentShuffledIndex === state.shuffledPlaylist.length - 1) {
          if (state.repeatMode === 'all') {
            nextIndex = 0;
          } else {
            return;
          }
        } else {
          nextIndex = currentShuffledIndex + 1;
        }
      } else {
        if (state.currentIndex === currentPlaylist.length - 1) {
          if (state.repeatMode === 'all') {
            nextIndex = 0;
          } else {
            return;
          }
        } else {
          nextIndex = state.currentIndex + 1;
        }
      }

      const nextSong = currentPlaylist[nextIndex];
      if (!nextSong) {
        logger.error('playNext: Next song not found at index', nextIndex);
        return;
      }

      // Also run between-song audio ads for manual Next, so album/playlist players don't bypass ad insertion.
      try {
        isAudioAdPlayingRef.current = true;
        const placementType = resolveNativePlayerPlacement(stateRef.current);
        let userCountry: string | null = null;
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && typeof user.user_metadata?.country === 'string') {
            userCountry = user.user_metadata.country;
          }
        } catch {
          // Ignore; ads still work without country targeting.
        }
        await playNativeAudioAdForPlacement(
          placementType,
          userCountry,
          undefined,
          {
            maxDurationMs: 30_000,
            minIntervalMs: 0,
          }
        );
      } catch (adError) {
        logger.warn('Audio ad on manual next failed; continuing playback', adError);
      } finally {
        isAudioAdPlayingRef.current = false;
      }

      if (audioCleanupRef.current) {
        audioCleanupRef.current();
        audioCleanupRef.current = null;
      }

      const resolved = await resolveSongForPlayback(nextSong);
      const audioResult = createAudioElement(resolved);
      if (!audioResult) return;

      const { audio: newAudio, cleanup } = audioResult;
      audioCleanupRef.current = cleanup;

      setState(prev => ({
        ...prev,
        currentSong: nextSong,
        currentIndex: state.isShuffleEnabled ? prev.currentIndex : nextIndex,
        audioElement: newAudio,
        currentTime: 0,
        duration: 0,
        error: null,
      }));

      newAudio.play().catch(err => {
        if (err.name !== 'AbortError') {
          logger.error('Error playing audio', err);
        }
      });
    })();
  }, [state.currentIndex, state.playlist, state.currentSong, state.isShuffleEnabled, state.shuffledPlaylist, state.repeatMode, state.playlistContext, createAudioElement]);

  const playPrevious = useCallback(() => {
    // If current song has been playing for more than 5 seconds, restart it
    if (state.currentTime > 5 && state.audioElement) {
      state.audioElement.currentTime = 0;
      setState(prev => ({ ...prev, currentTime: 0 }));
      return;
    }

    const getCurrentPlaylist = () => {
      return state.isShuffleEnabled ? state.shuffledPlaylist : state.playlist;
    };

    const currentPlaylist = getCurrentPlaylist();
    if (currentPlaylist.length === 0) return;

    let previousIndex: number;
    if (state.isShuffleEnabled) {
      const currentShuffledIndex = state.shuffledPlaylist.findIndex(s => s.id === state.currentSong?.id);
      previousIndex = currentShuffledIndex > 0 ? currentShuffledIndex - 1 : state.shuffledPlaylist.length - 1;
    } else {
      previousIndex = state.currentIndex > 0 ? state.currentIndex - 1 : currentPlaylist.length - 1;
    }

    const previousSong = currentPlaylist[previousIndex];
    if (previousSong) {
      changeSong(previousSong, state.isShuffleEnabled ? undefined : previousIndex);
    }
  }, [state.currentTime, state.currentIndex, state.playlist, state.audioElement, state.currentSong, state.isShuffleEnabled, state.shuffledPlaylist]);

  const toggleShuffle = useCallback(() => {
    setState(prev => {
      const newShuffleState = !prev.isShuffleEnabled;
      const newShuffledPlaylist = newShuffleState && prev.playlist.length > 1
        ? [...prev.playlist].sort(() => Math.random() - 0.5)
        : [...prev.playlist];

      const contextKey = currentContextKeyRef.current || generateContextKey(prev.playlistContext, prev.albumId);
      if (contextKey) {
        saveContextSettings(contextKey, {
          shuffle_enabled: newShuffleState,
          repeat_mode: prev.repeatMode
        });
      } else {
        logger.warn('toggleShuffle: No context key available');
      }

      return {
        ...prev,
        isShuffleEnabled: newShuffleState,
        shuffledPlaylist: newShuffledPlaylist
      };
    });
  }, []);

  const toggleRepeat = useCallback(() => {
    setState(prev => {
      const modes: ('off' | 'one' | 'all')[] = ['off', 'one', 'all'];
      const currentModeIndex = modes.indexOf(prev.repeatMode);
      const nextMode = modes[(currentModeIndex + 1) % modes.length];

      const contextKey = currentContextKeyRef.current || generateContextKey(prev.playlistContext, prev.albumId);
      if (contextKey) {
        saveContextSettings(contextKey, {
          shuffle_enabled: prev.isShuffleEnabled,
          repeat_mode: nextMode
        });
      } else {
        logger.warn('toggleRepeat: No context key available');
      }

      return { ...prev, repeatMode: nextMode };
    });
  }, []);

  const restorePlaybackState = useCallback(async () => {
    try {
      const savedState = await loadPlaybackState();
      if (!savedState || !savedState.songId) return false;

      const songs = await getSongsFromIds([savedState.songId, ...savedState.playlist]);
      if (songs.length === 0) return false;

      const currentSong = songs.find(s => s.id === savedState.songId);
      if (!currentSong) return false;

      const playlist = savedState.playlist.length > 0
        ? await getSongsFromIds(savedState.playlist)
        : songs;

      const resolvedCurrent = await resolveSongForPlayback(currentSong);
      const audioResult = createAudioElement(resolvedCurrent);
      if (!audioResult) return false;

      const { audio: newAudio, cleanup } = audioResult;
      audioCleanupRef.current = cleanup;

      // Set the playback position
      newAudio.currentTime = savedState.playbackPosition;

      // Update state with restored data
      setState(prev => ({
        ...prev,
        currentSong,
        playlist,
        currentIndex: savedState.currentIndex,
        audioElement: newAudio,
        isMiniPlayerVisible: true,
        isFullPlayerVisible: false,
        currentTime: savedState.playbackPosition,
        playlistContext: savedState.playlistContext,
        isShuffleEnabled: savedState.isShuffleEnabled,
        repeatMode: savedState.repeatMode,
      }));

      return true;
    } catch (error) {
      logger.error('Error restoring playback state', error);
      return false;
    }
  }, [createAudioElement]);

  const showMiniPlayer = useCallback((song: Song, playlist: Song[] = [], context: string = 'unknown', playlistId: string | null = null) => {
    if (audioCleanupRef.current) {
      audioCleanupRef.current();
      audioCleanupRef.current = null;
    }

    void (async () => {
      const resolved = await resolveSongForPlayback(song);
      const audioResult = createAudioElement(resolved);
      if (!audioResult) return;

      const { audio: newAudio, cleanup } = audioResult;
      audioCleanupRef.current = cleanup;

      setState(prev => ({
        ...prev,
        currentSong: song,
        playlist,
        currentIndex: playlist.findIndex(s => s.id === song.id) !== -1 ? playlist.findIndex(s => s.id === song.id) : 0,
        audioElement: newAudio,
        isMiniPlayerVisible: true,
        isFullPlayerVisible: false,
        currentTime: 0,
        duration: 0,
        error: null,
        playlistContext: context,
        playlistId,
      }));

      newAudio.play().catch(err => {
        if (err.name !== 'AbortError') {
          logger.error('Error playing audio', err);
        }
      });
    })();
  }, [createAudioElement]);

  const hideMiniPlayer = useCallback(() => {
    // Clean up current audio if it exists
    if (audioCleanupRef.current) {
      audioCleanupRef.current();
      audioCleanupRef.current = null;
    }

    setState(prev => ({
      ...prev,
      currentSong: null,
      audioElement: null,
      isMiniPlayerVisible: false,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      error: null,
    }));
  }, []);

  const playSong = useCallback((
    song: Song,
    expandFullPlayer: boolean = true,
    playlist: Song[] = [],
    index: number = 0,
    context: string = 'unknown',
    albumId: string | null = null,
    playlistId: string | null = null,
    autoPlay: boolean = true
  ) => {
    if (audioCleanupRef.current) {
      audioCleanupRef.current();
      audioCleanupRef.current = null;
    }

    hasTrackedSongStartRef.current = false;
    hasTrackedSongCompleteRef.current = false;
    currentSongGenreRef.current = null;
    currentSongArtistPlaysRef.current = null;
    intentionalPauseRef.current = false;

    void (async () => {
      const resolved = await resolveSongForPlayback(song);
      const audioResult = createAudioElement(resolved);
      if (!audioResult) return;

      const { audio: newAudio, cleanup } = audioResult;
      audioCleanupRef.current = cleanup;

      setState(prev => ({
        ...prev,
        currentSong: song,
        playlist,
        currentIndex: index,
        audioElement: newAudio,
        isFullPlayerVisible: expandFullPlayer,
        isMiniPlayerVisible: true,
        currentTime: 0,
        duration: 0,
        error: null,
        playlistContext: context,
        albumId,
        playlistId,
        shuffledPlaylist: prev.isShuffleEnabled && playlist.length > 1
          ? [...playlist].sort(() => Math.random() - 0.5)
          : [...playlist],
      }));

      newAudio.load();
      if (autoPlay) {
        newAudio.play().catch(err => {
          if (err.name !== 'AbortError') {
            logger.error('Error playing audio', err);
            setState(prev => ({ ...prev, error: 'Failed to play audio. Please try again.' }));
          }
        });
      }
    })();
  }, [createAudioElement]);

  const changeSong = useCallback((song: Song, index?: number) => {
    if (audioCleanupRef.current) {
      audioCleanupRef.current();
      audioCleanupRef.current = null;
    }

    void (async () => {
      const resolved = await resolveSongForPlayback(song);
      const audioResult = createAudioElement(resolved);
      if (!audioResult) return;

      const { audio: newAudio, cleanup } = audioResult;
      audioCleanupRef.current = cleanup;

      setState(prev => ({
        ...prev,
        currentSong: song,
        currentIndex: index !== undefined ? index : prev.currentIndex,
        audioElement: newAudio,
        currentTime: 0,
        duration: 0,
        error: null,
        isMiniPlayerVisible: true,
      }));

      newAudio.play().catch(err => {
        if (err.name !== 'AbortError') {
          logger.error('Error playing audio', err);
        }
      });
    })();
  }, [createAudioElement]);

  const togglePlayPause = useCallback(() => {
    if (!state.audioElement) return;
    if (isAudioAdPlayingRef.current) return;

    if (state.isPlaying) {
      intentionalPauseRef.current = true; // User-initiated pause — don't auto-resume on unlock
      state.audioElement.pause();
    } else {
      intentionalPauseRef.current = false; // User is resuming — clear the flag
      state.audioElement.play().catch(err => {
        // Only log errors that aren't AbortError (play interrupted by pause)
        if (err.name !== 'AbortError') {
          logger.error('Error playing audio', err);
        }
      });
    }
  }, [state.audioElement, state.isPlaying]);

  const expandFullPlayer = useCallback(() => {
    // When expanding to full player, hide the mini player to avoid showing both at once
    setState(prev => ({
      ...prev,
      isFullPlayerVisible: true,
      isMiniPlayerVisible: false,
    }));
  }, []);

  const hideFullPlayer = useCallback(() => {
    setState(prev => ({
      ...prev,
      isFullPlayerVisible: false,
      // Show mini player again when closing full player if a song is playing
      isMiniPlayerVisible: !!prev.currentSong,
    }));
  }, []);

  const hideAllPlayers = useCallback(() => {
    // Hide both players without stopping playback
    // Useful when a custom player UI (like AlbumPlayerScreen) is active
    setState(prev => ({
      ...prev,
      isFullPlayerVisible: false,
      isMiniPlayerVisible: false,
    }));
  }, []);

  const seekTo = useCallback((time: number) => {
    if (state.audioElement) {
      state.audioElement.currentTime = time;
      setState(prev => ({ ...prev, currentTime: time }));
    }
  }, [state.audioElement]);

  // Refs for Media Session action handlers (so they always call latest callbacks)
  useEffect(() => {
    togglePlayPauseRef.current = togglePlayPause;
    playNextRef.current = playNext;
    playPreviousRef.current = playPrevious;
  }, [togglePlayPause, playNext, playPrevious]);

  // Resume audio after phone unlock / app-foreground on native platforms.
  // When the screen locks, Android may pause the HTMLAudioElement even though the foreground service
  // keeps the process alive. We detect "app active again" and resume if the pause was not user-initiated.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let appStateHandle: { remove: () => void } | null = null;

    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && !intentionalPauseRef.current && !isAudioAdPlayingRef.current) {
        const el = stateRef.current.audioElement;
        const hasSong = !!stateRef.current.currentSong;
        if (el && hasSong && el.paused) {
          el.play().catch(() => {});
        }
      }
    }).then(handle => {
      appStateHandle = handle;
    }).catch(() => {});

    // visibilitychange fires on Android when the screen turns off/on (WebView visibility)
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        !intentionalPauseRef.current &&
        !isAudioAdPlayingRef.current
      ) {
        const el = stateRef.current.audioElement;
        const hasSong = !!stateRef.current.currentSong;
        if (el && hasSong && el.paused) {
          el.play().catch(() => {});
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      appStateHandle?.remove();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Media Session: lock screen / notification (native plugin on Android so notification actually shows)
  useEffect(() => {
    updateMediaSessionMetadata(state.currentSong ?? null);
  }, [state.currentSong]);

  useEffect(() => {
    if (!state.currentSong) return;
    setMediaSessionPlaybackState(state.isPlaying ? 'playing' : 'paused');
  }, [state.currentSong?.id, state.isPlaying]);

  useEffect(() => {
    setMediaSessionActionHandlers({
      onPlay: () => { if (!stateRef.current.isPlaying) togglePlayPauseRef.current?.(); },
      onPause: () => { if (stateRef.current.isPlaying) togglePlayPauseRef.current?.(); },
      onNext: () => playNextRef.current?.(),
      onPrevious: () => playPreviousRef.current?.(),
    });
    return () => {
      setMediaSessionActionHandlers(null);
    };
  }, []);

  useEffect(() => {
    if (!state.currentSong || state.duration <= 0) return;
    const now = Date.now();
    if (now - lastPositionUpdateRef.current < 250) return;
    lastPositionUpdateRef.current = now;
    setMediaSessionPositionState(state.currentTime, state.duration);
  }, [state.currentSong?.id, state.currentTime, state.duration]);

  return {
    currentSong: state.currentSong,
    playlist: state.playlist,
    currentIndex: state.currentIndex,
    isPlaying: state.isPlaying,
    currentTime: state.currentTime,
    duration: state.duration,
    audioElement: state.audioElement,
    isFullPlayerVisible: state.isFullPlayerVisible,
    isMiniPlayerVisible: state.isMiniPlayerVisible,
    error: state.error,
    playlistContext: state.playlistContext,
    albumId: state.albumId,
    playlistId: state.playlistId,
    isShuffleEnabled: state.isShuffleEnabled,
    repeatMode: state.repeatMode,
    playSong,
    changeSong,
    togglePlayPause,
    expandFullPlayer,
    hideFullPlayer,
    hideAllPlayers,
    seekTo,
    showMiniPlayer,
    hideMiniPlayer,
    playNext,
    playPrevious,
    toggleShuffle,
    toggleRepeat,
    savePlaybackState,
    restorePlaybackState,
  };
};