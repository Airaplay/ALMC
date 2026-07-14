/**
 * Ensures only one primary media stream plays at a time (song, video, or audio ad).
 * Music and audio ads use detached `HTMLAudioElement` instances (not in the DOM), so we
 * track them explicitly; videos are paused via DOM queries as well.
 */

let activeMusicElement: HTMLAudioElement | null = null;
let activeAdElement: HTMLAudioElement | null = null;
let musicStateSyncCallback: (() => void) | null = null;

/** Sync React player state when music is paused by video / another surface. */
export function registerMusicPlaybackStateSync(callback: () => void): () => void {
  musicStateSyncCallback = callback;
  return () => {
    if (musicStateSyncCallback === callback) {
      musicStateSyncCallback = null;
    }
  };
}

export function setActiveMusicElement(element: HTMLAudioElement | null): void {
  activeMusicElement = element;
}

export function clearActiveMusicElementIf(element: HTMLAudioElement): void {
  if (activeMusicElement === element) {
    activeMusicElement = null;
  }
}

export function setActiveAdElement(element: HTMLAudioElement | null): void {
  activeAdElement = element;
}

/**
 * Pause every known media element except `except` (if provided).
 * When music is paused externally, optional state sync runs once.
 */
export function pauseAllMediaExcept(except?: HTMLMediaElement | null): void {
  const shouldSyncMusicState =
    activeMusicElement != null && activeMusicElement !== except;

  if (activeMusicElement && activeMusicElement !== except) {
    try {
      activeMusicElement.pause();
    } catch {
      // ignore
    }
  }

  if (activeAdElement && activeAdElement !== except) {
    try {
      activeAdElement.pause();
    } catch {
      // ignore
    }
  }

  if (shouldSyncMusicState) {
    musicStateSyncCallback?.();
  }

  if (typeof document === 'undefined') return;

  document.querySelectorAll('audio, video').forEach((el) => {
    if (except && el === except) return;
    try {
      el.pause();
    } catch {
      // ignore
    }
  });
}

/** Call immediately before starting music playback. */
export function claimMusicPlayback(audio: HTMLAudioElement): void {
  setActiveMusicElement(audio);
  pauseAllMediaExcept(audio);
}

/** Call immediately before starting video playback. */
export function claimVideoPlayback(video: HTMLVideoElement): void {
  pauseAllMediaExcept(video);
}

/** Call immediately before starting an audio ad. */
export function claimAudioAdPlayback(adAudio: HTMLAudioElement): void {
  setActiveAdElement(adAudio);
  pauseAllMediaExcept(adAudio);
}

export function releaseAudioAdPlayback(adAudio: HTMLAudioElement): void {
  if (activeAdElement === adAudio) {
    activeAdElement = null;
  }
}

export function isAnyVideoPlaying(): boolean {
  if (typeof document === 'undefined') return false;
  return Array.from(document.querySelectorAll('video')).some(
    (video) => !video.paused && !video.ended
  );
}
