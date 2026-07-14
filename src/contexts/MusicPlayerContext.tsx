import React, { createContext, useContext, ReactNode, useEffect, useRef } from 'react';
import { useMusicPlayer as useLocalMusicPlayer } from '../hooks/useMusicPlayer';
import { useAdPlacement } from '../hooks/useAdPlacement';

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

interface MusicPlayerContextType {
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
  playSong: (_song: Song, _expandFullPlayer?: boolean, _playlist?: Song[], _index?: number, _context?: string, _albumId?: string | null, _playlistId?: string | null) => void;
  switchPlaybackContext: (_playlist: Song[], _indexInPlaylist: number, _context: string, _albumId: string | null, _playlistId: string | null) => void;
  changeSong: (_song: Song, _index?: number) => void;
  togglePlayPause: () => void;
  expandFullPlayer: () => void;
  hideFullPlayer: () => void;
  hideAllPlayers: () => void;
  seekTo: (_time: number) => void;
  showMiniPlayer: (_song: Song, _playlist?: Song[], _context?: string, _playlistId?: string | null) => void;
  hideMiniPlayer: () => void;
  playNext: () => void;
  playPrevious: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  savePlaybackState: () => void;
  restorePlaybackState: () => Promise<boolean>;
}

const MusicPlayerContext = createContext<MusicPlayerContextType | undefined>(undefined);

export const MusicPlayerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const musicPlayer = useLocalMusicPlayer();
 
  // Global fullscreen ads + bonus prompts tied to song transitions.
  // - Interstitial: mid-song auto-trigger rules while mini player is visible (subject to global 2‑minute cooldown).
  // - Bonus rewarded: after 3 songs, emit an event; UI surfaces a user‑initiated “Get bonus score” button.
  const { showRewarded, showInterstitial } = useAdPlacement('GlobalPlayback');
  const lastSongIdRef = useRef<string | null>(null);
  const songsSinceBonusRef = useRef(0);
  const songsSinceInterstitialRef = useRef(0);
  const interstitialTimeoutRef = useRef<number | null>(null);
  const showRewardedRef = useRef(showRewarded);
  const showInterstitialRef = useRef(showInterstitial);
  showRewardedRef.current = showRewarded;
  showInterstitialRef.current = showInterstitial;

  useEffect(() => {
    const song = musicPlayer.currentSong;
    if (!song?.id) return;

    // Only react when the current song actually changes.
    if (lastSongIdRef.current === song.id) return;
    lastSongIdRef.current = song.id;

    // 1) Interstitial auto-trigger while mini player is visible.
    // Avoid double-trigger when any full-screen player is open (those screens handle their own rules).
    if (interstitialTimeoutRef.current != null) {
      window.clearTimeout(interstitialTimeoutRef.current);
      interstitialTimeoutRef.current = null;
    }

    const shouldRunGlobalInterstitialRules =
      musicPlayer.isMiniPlayerVisible && !musicPlayer.isFullPlayerVisible;

    if (shouldRunGlobalInterstitialRules) {
      // Rules:
      // - Music: every song
      // - Album/Playlist/Daily Mix: every 2 songs
      const ctx = musicPlayer.playlistContext || '';
      const isAlbum = ctx.startsWith('album-');
      const isPlaylist = ctx.startsWith('playlist-');
      const isDailyMix = ctx.startsWith('daily-mix-');
      const every2 = isAlbum || isPlaylist || isDailyMix;

      songsSinceInterstitialRef.current += 1;
      const shouldTrigger = every2 ? songsSinceInterstitialRef.current >= 2 : true;
      if (shouldTrigger) {
        songsSinceInterstitialRef.current = 0;

        const durationSeconds =
          typeof song.duration === 'number' && song.duration > 0 ? song.duration : undefined;
        const midMs = durationSeconds
          ? Math.max(12_000, Math.floor((durationSeconds * 1000) / 2))
          : 30_000;

        const placementKey = isAlbum
          ? 'album_midplay_interstitial'
          : isPlaylist
            ? 'playlist_midplay_interstitial'
            : isDailyMix
              ? 'daily_mix_midplay_interstitial'
              : 'during_song_playback_interstitial';

        interstitialTimeoutRef.current = window.setTimeout(() => {
          showInterstitialRef.current(
            placementKey,
            { contentId: song.id, contentType: 'song' },
            { muteAppAudio: true }
          ).catch(() => {
            // Interstitial failures must never impact playback.
          });
        }, midMs);
      }
    } else {
      // If rules are not active (e.g., mini player hidden), keep counter in sync but don't trigger.
      songsSinceInterstitialRef.current = 0;
    }

    // 2) Bonus rewarded prompt every 3 songs — user‑initiated only via UI.
    songsSinceBonusRef.current += 1;
    if (songsSinceBonusRef.current >= 3) {
      songsSinceBonusRef.current = 0;
      // Emit a global event: full‑screen player UIs can show a small "Get bonus score" card.
      try {
        window.dispatchEvent(
          new CustomEvent('globalSongBonusAvailable', {
            detail: { songId: song.id },
          })
        );
      } catch {
        // Event dispatch should never break playback.
      }
    }
  }, [musicPlayer.currentSong?.id]);

  // Cleanup: ensure we don't fire an interstitial after playback context changes/unmount.
  useEffect(() => {
    return () => {
      if (interstitialTimeoutRef.current != null) {
        window.clearTimeout(interstitialTimeoutRef.current);
        interstitialTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <MusicPlayerContext.Provider value={musicPlayer}>
      {children}
    </MusicPlayerContext.Provider>
  );
};

export const useMusicPlayer = (): MusicPlayerContextType => {
  const context = useContext(MusicPlayerContext);
  if (context === undefined) {
    throw new Error('useMusicPlayer must be used within a MusicPlayerProvider');
  }
  return context;
};
