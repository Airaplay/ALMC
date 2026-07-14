/**
 * Media Session: lock screen / notification controls.
 * On native (Capacitor Android/iOS) uses @capgo/capacitor-media-session so the
 * system notification actually appears. On web uses navigator.mediaSession.
 */

import { Capacitor } from '@capacitor/core';

export type PlaybackState = 'none' | 'paused' | 'playing';

export interface MediaSessionSong {
  title: string;
  artist: string;
  coverImageUrl?: string | null;
  featuredArtists?: string[] | null;
}

export interface MediaSessionHandlers {
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
}

let plugin: typeof import('@capgo/capacitor-media-session').MediaSession | null = null;
let pluginReady: Promise<boolean> | null = null;

function isNative(): boolean {
  return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
}

async function getPlugin(): Promise<typeof import('@capgo/capacitor-media-session').MediaSession | null> {
  if (!isNative()) return null;
  if (plugin != null) return plugin;
  if (pluginReady != null) return pluginReady.then(() => plugin);

  pluginReady = (async () => {
    try {
      const mod = await import('@capgo/capacitor-media-session');
      plugin = mod.MediaSession;
      return true;
    } catch {
      return false;
    }
  })();
  await pluginReady;
  return plugin;
}

function artistString(song: MediaSessionSong): string {
  return [song.artist, ...(song.featuredArtists ?? [])].filter(Boolean).join(', ');
}

function artwork(song: MediaSessionSong): { src: string; sizes: string; type: string }[] {
  return song.coverImageUrl
    ? [{ src: song.coverImageUrl, sizes: '512x512', type: 'image/jpeg' }]
    : [];
}

/** Set metadata (title, artist, artwork). Call when the current track changes. */
export async function updateMediaSessionMetadata(song: MediaSessionSong | null): Promise<void> {
  const p = await getPlugin();
  if (p) {
    if (!song) {
      await p.setPlaybackState({ playbackState: 'none' }).catch(() => {});
      return;
    }
    await p.setMetadata({
      title: song.title,
      artist: artistString(song),
      album: '',
      artwork: artwork(song),
    }).catch(() => {});
    return;
  }
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    if (!song) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: artistString(song),
      artwork: artwork(song),
    });
  }
}

/** Set playback state. Must set to 'playing' for the notification to show on Android. */
export async function setMediaSessionPlaybackState(state: PlaybackState): Promise<void> {
  const p = await getPlugin();
  if (p) {
    await p.setPlaybackState({ playbackState: state }).catch(() => {});
    return;
  }
  // Web API has no setPlaybackState; notification follows media element state.
}

/** Update position/duration for the notification progress bar. */
export async function setMediaSessionPositionState(position: number, duration: number): Promise<void> {
  if (duration <= 0) return;
  const p = await getPlugin();
  if (p) {
    await p.setPositionState({ position, duration, playbackRate: 1 }).catch(() => {});
    return;
  }
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position });
    } catch {
      // ignore
    }
  }
}

/** Register play/pause/next/previous handlers. Call once on init. */
export async function setMediaSessionActionHandlers(handlers: MediaSessionHandlers | null): Promise<void> {
  const p = await getPlugin();
  if (p) {
    if (!handlers) {
      await p.setActionHandler({ action: 'play' }, null).catch(() => {});
      await p.setActionHandler({ action: 'pause' }, null).catch(() => {});
      await p.setActionHandler({ action: 'nexttrack' }, null).catch(() => {});
      await p.setActionHandler({ action: 'previoustrack' }, null).catch(() => {});
      return;
    }
    await p.setActionHandler({ action: 'play' }, () => handlers.onPlay()).catch(() => {});
    await p.setActionHandler({ action: 'pause' }, () => handlers.onPause()).catch(() => {});
    await p.setActionHandler({ action: 'nexttrack' }, () => handlers.onNext()).catch(() => {});
    await p.setActionHandler({ action: 'previoustrack' }, () => handlers.onPrevious()).catch(() => {});
    return;
  }
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const { onPlay, onPause, onNext, onPrevious } = handlers ?? {};
  navigator.mediaSession.setActionHandler('play', onPlay ?? null);
  navigator.mediaSession.setActionHandler('pause', onPause ?? null);
  navigator.mediaSession.setActionHandler('nexttrack', onNext ?? null);
  navigator.mediaSession.setActionHandler('previoustrack', onPrevious ?? null);
}
