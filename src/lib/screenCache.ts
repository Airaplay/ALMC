/**
 * Screen performance: cache-first + background revalidate.
 * Use for: LOW SUPABASE EGRESS, MINIMAL POSTGRES LOAD, FAST NAVIGATION.
 *
 * Edge-cache-friendly (long TTL): public playlists, trending, artist lists.
 * Do NOT long-cache: authenticated dashboards, wallets, earnings.
 */

import { useState, useEffect, useCallback } from 'react';
import { persistentCache } from './persistentCache';
import { supabase } from './supabase';

/** TTL for public/edge-cacheable data (trending, playlists, artists) */
export const CACHE_TTL_PUBLIC = 20 * 60 * 1000; // 20 min

/** TTL for user-scoped data (library, profile) - shorter */
export const CACHE_TTL_USER = 5 * 60 * 1000; // 5 min

/** TTL for home screen aggregated data */
export const CACHE_TTL_HOME = 30 * 60 * 1000; // 30 min

export interface UseScreenCacheOptions<T> {
  cacheKey: string;
  ttlMs?: number;
  fetcher: () => Promise<T>;
  /** If true, show loading only when no cache; otherwise always show loading on first run */
  loadingOnlyWhenNoCache?: boolean;
  /** Skip fetch when no user (e.g. library) */
  requireAuth?: boolean;
}

export interface UseScreenCacheResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Cache-first hook: show cached data immediately on navigation, refetch in background.
 * Preserves UI/UX; minimizes Supabase/Postgres load and bandwidth.
 */
export function useScreenCache<T>(options: UseScreenCacheOptions<T>): UseScreenCacheResult<T> {
  const {
    cacheKey,
    ttlMs = CACHE_TTL_USER,
    fetcher,
    loadingOnlyWhenNoCache = true,
    requireAuth = false,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(
    async (forceRefresh = false) => {
      if (requireAuth) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setData(null);
          setIsLoading(false);
          return;
        }
      }

      if (!forceRefresh) {
        const cached = await persistentCache.get<T>(cacheKey);
        if (cached) {
          setData(cached);
          setError(null);
          if (loadingOnlyWhenNoCache) setIsLoading(false);
          // Revalidate in background
          fetcher()
            .then((fresh) => {
              persistentCache.set(cacheKey, fresh, ttlMs);
              setData(fresh);
            })
            .catch(() => {});
          if (!loadingOnlyWhenNoCache) setIsLoading(false);
          return;
        }
      }

      setIsLoading(true);
      setError(null);
      try {
        const fresh = await fetcher();
        setData(fresh);
        await persistentCache.set(cacheKey, fresh, ttlMs);
      } catch (err) {
        const fallback = await persistentCache.get<T>(cacheKey);
        if (fallback) setData(fallback);
        setError(err instanceof Error ? err : new Error('Failed to load'));
      } finally {
        setIsLoading(false);
      }
    },
    [cacheKey, ttlMs, fetcher, loadingOnlyWhenNoCache, requireAuth]
  );

  useEffect(() => {
    load();
  }, [load]);

  const refetch = useCallback(() => load(true), [load]);

  return { data, isLoading, error, refetch };
}

/**
 * Prefetch data into cache without updating any state. Call on app start or after login.
 */
export async function prefetchToCache<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttlMs: number = CACHE_TTL_PUBLIC
): Promise<void> {
  try {
    const data = await fetcher();
    await persistentCache.set(cacheKey, data, ttlMs);
  } catch {
    // Silent; consumer will fetch on demand
  }
}
