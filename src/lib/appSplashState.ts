import {
  dismissBootSplash,
  isBootSplashVisible,
  setBootDismissBlocked,
  setShareBootLoaderHeld,
} from "./bootSplash";

/** Tracks React splash visibility and share-link boot loader (HTML #boot-splash). */

const SHARE_SPLASH_HOLD_EVENT = "aira-share-splash-hold";
const SHARE_SPLASH_RELEASE_EVENT = "aira-share-splash-release";

let appSplashVisible = false;
let shareSplashHeld = false;

export function setAppSplashVisible(visible: boolean): void {
  appSplashVisible = visible;
}

export function isAppSplashVisible(): boolean {
  return appSplashVisible;
}

export function isShareContentSplashHeld(): boolean {
  return shareSplashHeld;
}

/** Keep the boot / splash loader up while shared content is loading (idempotent). */
export function holdSplashForShareContent(): void {
  if (shareSplashHeld) return;
  shareSplashHeld = true;
  setShareBootLoaderHeld(true);
  window.dispatchEvent(new CustomEvent(SHARE_SPLASH_HOLD_EVENT));
}

/** Dismiss share boot loader after content is ready (idempotent). */
export function releaseSplashForShareContent(): void {
  if (!shareSplashHeld) return;
  shareSplashHeld = false;
  setShareBootLoaderHeld(false);
  setBootDismissBlocked(false);
  window.dispatchEvent(new CustomEvent(SHARE_SPLASH_RELEASE_EVENT));
  dismissBootSplash({ force: true });
}

const MUSIC_PLAYER_ROOT_SELECTOR = ".music-player-root";

/** Wait until full player DOM is painted, then dismiss boot spinner. */
export function releaseShareBootWhenPlayerReady(): void {
  if (!shareSplashHeld) return;

  let attempts = 0;
  const maxAttempts = 120;

  const tick = () => {
    if (!shareSplashHeld) return;
    attempts += 1;
    const root = document.querySelector(MUSIC_PLAYER_ROOT_SELECTOR);
    const rect = root?.getBoundingClientRect();
    const playerPainted = !!rect && rect.width > 0 && rect.height > 0;

    if (playerPainted || attempts >= maxAttempts) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => releaseSplashForShareContent());
      });
      return;
    }
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

export function subscribeShareSplashHold(onHold: () => void, onRelease: () => void): () => void {
  const hold = () => onHold();
  const release = () => onRelease();
  window.addEventListener(SHARE_SPLASH_HOLD_EVENT, hold);
  window.addEventListener(SHARE_SPLASH_RELEASE_EVENT, release);
  return () => {
    window.removeEventListener(SHARE_SPLASH_HOLD_EVENT, hold);
    window.removeEventListener(SHARE_SPLASH_RELEASE_EVENT, release);
  };
}

/** True when a loader already covers the screen (skip duplicate ScreenLoader). */
export function shouldUseSplashInsteadOfScreenLoader(): boolean {
  return isAppSplashVisible() || isShareContentSplashHeld() || isBootSplashVisible();
}
