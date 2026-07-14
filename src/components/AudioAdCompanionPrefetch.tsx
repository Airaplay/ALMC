import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useMusicPlayer } from '../contexts/MusicPlayerContext';
import { prefetchAudioAdCompanionForPlacement } from '../lib/nativeAdService';
import { resolveUserCountryCodeForAds } from '../hooks/useUserCountry';

function resolvePlacementFromContext(context: string | undefined): string {
  if (!context) return 'music_player';
  if (context.startsWith('album-') || context === 'Album') return 'album_player';
  if (context.startsWith('playlist-') || context === 'Playlist') return 'playlist_player';
  if (context.startsWith('daily-mix-')) return 'daily_mix_player';
  return 'music_player';
}

/**
 * Warms companion art for the next audio ad when playback context is active.
 */
export function AudioAdCompanionPrefetch(): null {
  const { user } = useAuth();
  const { playlistContext, isPlaying, currentSong } = useMusicPlayer();

  useEffect(() => {
    if (!currentSong || !isPlaying) return;
    const placement = resolvePlacementFromContext(playlistContext);
    let cancelled = false;
    void (async () => {
      const country = await resolveUserCountryCodeForAds(user?.id ?? null);
      if (cancelled) return;
      await prefetchAudioAdCompanionForPlacement(placement, country);
    })();
    return () => {
      cancelled = true;
    };
  }, [playlistContext, isPlaying, currentSong?.id]);

  return null;
}
