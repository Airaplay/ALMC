/** Dismiss the static HTML boot splash (#boot-splash / legacy #initial-loader). No heavy imports. */
let dismissed = false;
let shareBootLoaderHeld = false;
let bootDismissBlocked = false;

/** Blocks dismiss while a share link is loading (see appSplashState). */
export function setShareBootLoaderHeld(held: boolean): void {
  shareBootLoaderHeld = held;
}

/** Block early dismiss until the app decides splash vs share flow (see mountApp). */
export function setBootDismissBlocked(blocked: boolean): void {
  bootDismissBlocked = blocked;
}

export function dismissBootSplash(options?: { force?: boolean }): void {
  if (dismissed || typeof document === "undefined") return;
  if (!options?.force && (shareBootLoaderHeld || bootDismissBlocked)) return;
  dismissed = true;

  const loader =
    document.getElementById("boot-splash") ??
    document.getElementById("initial-loader");

  const markLoaded = () => {
    document.getElementById("app")?.classList.add("app-loaded");
  };

  if (!loader) {
    markLoaded();
    return;
  }

  loader.style.opacity = "0";
  loader.style.transition = "opacity 0.25s ease-out";
  window.setTimeout(() => {
    loader.remove();
    markLoaded();
  }, 250);
}

export function isBootSplashVisible(): boolean {
  if (typeof document === "undefined") return false;
  return !!(
    document.getElementById("boot-splash") ??
    document.getElementById("initial-loader")
  );
}
