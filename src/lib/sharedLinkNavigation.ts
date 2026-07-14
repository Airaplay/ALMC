import type { Location, NavigateFunction } from 'react-router-dom';
import { holdSplashForShareContent, isShareContentSplashHeld } from './appSplashState';

const SESSION_KEY = 'aira_shared_link_entry';
const PENDING_LAUNCH_KEY = 'aira_share_launch_pending';
const MUSIC_FLOW_KEY = 'aira_shared_link_music';
/** User left shared content intentionally — block cold-start launch URL replays. */
const DISMISSED_KEY = 'aira_shared_link_dismissed';
const HANDLED_SONG_ID_KEY = 'aira_shared_link_handled_song_id';

/** Persist share-link entry so redirects (e.g. /o/v/:id → /video/:id) keep escape behavior. */
export function markSharedLinkEntry(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearSharedLinkEntry(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Song opened from a share link: full player first, Home + mini player after minimize. */
export function markSharedLinkMusicFlow(): void {
  markSharedLinkEntry();
  try {
    sessionStorage.setItem(MUSIC_FLOW_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function isSharedLinkMusicFlow(): boolean {
  try {
    return sessionStorage.getItem(MUSIC_FLOW_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearSharedLinkMusicFlow(): void {
  try {
    sessionStorage.removeItem(MUSIC_FLOW_KEY);
  } catch {
    /* ignore */
  }
  clearSharedLinkEntry();
}

export function markSharedLinkSongHandled(songId: string): void {
  try {
    sessionStorage.setItem(HANDLED_SONG_ID_KEY, songId);
  } catch {
    /* ignore */
  }
}

export function markSharedLinkDismissed(): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function isSharedLinkDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function getSharedLinkHandledSongId(): string | null {
  try {
    return sessionStorage.getItem(HANDLED_SONG_ID_KEY);
  } catch {
    return null;
  }
}

/** Cold-start share detected but router has not reached content yet (blocks Home flash). */
export function markShareLinkLaunchPending(): void {
  try {
    sessionStorage.setItem(PENDING_LAUNCH_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function clearShareLinkLaunchPending(): void {
  try {
    sessionStorage.removeItem(PENDING_LAUNCH_KEY);
  } catch {
    /* ignore */
  }
}

export function isShareLinkLaunchPending(): boolean {
  try {
    return sessionStorage.getItem(PENDING_LAUNCH_KEY) === '1';
  } catch {
    return false;
  }
}

export type AppSplashMode = 'pending' | 'show' | 'skip';

/** Hide tab routes so Home does not paint during shared-song cold start. */
export function shouldHideAppShellForShareLink(
  pathname: string,
  splashMode: AppSplashMode,
  isFullPlayerVisible: boolean,
): boolean {
  if (splashMode === 'pending') return true;
  if (isShareContentSplashHeld()) return true;
  if (isShareLinkLaunchPending()) return true;
  if (pathname.startsWith('/song/') && !isSharedLinkDismissed()) return true;
  if (isSharedLinkMusicFlow() && pathname.startsWith('/song/') && isFullPlayerVisible) {
    return true;
  }
  if (
    splashMode === 'skip' &&
    isSharedLinkEntry() &&
    (pathname === '/' || pathname === '') &&
    !isFullPlayerVisible
  ) {
    return true;
  }
  return false;
}

/** New share link opened while app is running (not a stale cold-start URL). */
export function clearSharedLinkDismissed(): void {
  try {
    sessionStorage.removeItem(DISMISSED_KEY);
    sessionStorage.removeItem(HANDLED_SONG_ID_KEY);
  } catch {
    /* ignore */
  }
}

/** Minimize shared-link playback: Home tab + mini player, playback continues. */
export function finishSharedLinkMusicFlow(
  navigate: NavigateFunction,
  options?: { replace?: boolean }
): void {
  markSharedLinkDismissed();
  clearSharedLinkMusicFlow();
  navigate('/', { replace: options?.replace ?? true });
}

export function isSharedLinkEntry(location?: Pick<Location, 'state'>): boolean {
  if ((location?.state as { fromSharedLink?: boolean } | null)?.fromSharedLink) {
    return true;
  }
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/** Leave a shared-content screen and return to the home tab. */
export function exitSharedLinkScreen(
  navigate: NavigateFunction,
  options?: { replace?: boolean }
): void {
  clearSharedLinkEntry();
  navigate('/', { replace: options?.replace ?? true });
}

export function navigateWithSharedLinkState(
  navigate: NavigateFunction,
  to: string,
  options?: { replace?: boolean }
): void {
  markSharedLinkEntry();
  clearShareLinkLaunchPending();
  if (to.startsWith("/song/")) {
    holdSplashForShareContent();
  }
  navigate(to, {
    replace: options?.replace ?? true,
    state: { fromSharedLink: true },
  });
}
