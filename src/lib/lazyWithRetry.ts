import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const CHUNK_RELOAD_KEY = "airaplay-chunk-reload-attempted";
const CHUNK_RELOAD_PENDING_KEY = "airaplay-chunk-reload-pending";

/** Call once at web boot after an auto-reload from a stale chunk. */
export function acknowledgeChunkReloadBoot(): void {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_PENDING_KEY) === "1") {
      sessionStorage.removeItem(CHUNK_RELOAD_PENDING_KEY);
    }
  } catch {
    /* private browsing / disabled storage */
  }
}

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("importing a module script failed")
  );
}

function hasChunkReloadBeenAttempted(): boolean {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1";
  } catch {
    return false;
  }
}

function markChunkReloadAttempted(): void {
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
    sessionStorage.setItem(CHUNK_RELOAD_PENDING_KEY, "1");
  } catch {
    /* ignore */
  }
}

function clearChunkReloadAttempt(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    /* ignore */
  }
}

/** Reload once when a hashed Vite chunk 404s after a deploy. */
export function tryReloadForChunkError(error: unknown): boolean {
  if (!isChunkLoadError(error) || hasChunkReloadBeenAttempted()) {
    return false;
  }
  markChunkReloadAttempted();
  window.location.reload();
  return true;
}

/** Reload once when a hashed Vite chunk 404s after a deploy; rethrow if already retried. */
export async function importWithChunkRetry<T>(importFn: () => Promise<T>): Promise<T> {
  try {
    const result = await importFn();
    clearChunkReloadAttempt();
    return result;
  } catch (error) {
    if (tryReloadForChunkError(error)) {
      return new Promise<T>(() => {});
    }
    throw error;
  }
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  importFn: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(() => importWithChunkRetry(importFn));
}
