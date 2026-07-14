import { cacheManager } from './cache';
import { getNetworkInfo } from './imageOptimization';
import { getRequestTimeoutMs, getRetryConfig } from './networkAwareConfig';
import { persistentCache } from './persistentCache';
import { releaseDatePublicFilter, isReleased } from './releaseDateUtils';

export interface PaginationOptions {
  page: number;
  pageSize: number;
}

export interface FetchOptions {
  enableCache?: boolean;
  cacheDuration?: number;
  enablePagination?: boolean;
  pagination?: PaginationOptions;
}

const DEFAULT_PAGE_SIZE = 20;
const LOW_NETWORK_PAGE_SIZE = 10;

export const getOptimalPageSize = (): number => {
  const network = getNetworkInfo();

  if (network.saveData) return LOW_NETWORK_PAGE_SIZE;

  switch (network.effectiveType) {
    case '4g':
      return 30;
    case '3g':
      return 20;
    case '2g':
    case 'slow-2g':
      return 10;
    default:
      return DEFAULT_PAGE_SIZE;
  }
};

export const createPaginatedQuery = (
  query: any,
  options: FetchOptions = {}
) => {
  const { enablePagination = true, pagination } = options;

  if (!enablePagination) {
    return query;
  }

  const pageSize = pagination?.pageSize || getOptimalPageSize();
  const page = pagination?.page || 0;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  return query.range(from, to);
};

export const fetchWithCache = async <T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
  options: FetchOptions = {}
): Promise<T> => {
  const { enableCache = true, cacheDuration = 5 * 60 * 1000 } = options;

  if (enableCache) {
    const cached = cacheManager.get(cacheKey);
    if (cached) {
      return cached as T;
    }
  }

  const data = await fetchFn();

  if (enableCache) {
    cacheManager.set(cacheKey, data, cacheDuration);
  }

  return data;
};

export const prefetchData = async <T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
  cacheDuration: number = 5 * 60 * 1000
): Promise<void> => {
  try {
    const data = await fetchFn();
    cacheManager.set(cacheKey, data, cacheDuration);
  } catch (error) {
    console.error('Prefetch failed:', error);
  }
};

export const batchFetchData = async <T>(
  requests: Array<{ cacheKey: string; fetchFn: () => Promise<T> }>,
  options: FetchOptions = {}
): Promise<T[]> => {
  const network = getNetworkInfo();
  const isFastNetwork = network.effectiveType === '4g' && !network.saveData;

  if (isFastNetwork) {
    return Promise.all(requests.map(req =>
      fetchWithCache(req.cacheKey, req.fetchFn, options)
    ));
  }

  const results: T[] = [];
  for (const req of requests) {
    const result = await fetchWithCache(req.cacheKey, req.fetchFn, options);
    results.push(result);
  }
  return results;
};

export const shouldLoadAdditionalData = (): boolean => {
  const network = getNetworkInfo();
  return !network.saveData && (network.effectiveType === '4g' || network.effectiveType === '3g');
};

export const getDataPriority = (): 'high' | 'medium' | 'low' => {
  const network = getNetworkInfo();

  if (network.saveData || network.effectiveType === '2g' || network.effectiveType === 'slow-2g') {
    return 'low';
  }

  if (network.effectiveType === '3g') {
    return 'medium';
  }

  return 'high';
};

interface InfiniteScrollOptions {
  threshold?: number;
  rootMargin?: string;
  onLoadMore: () => Promise<void>;
  hasMore: boolean;
  loading: boolean;
}

export const useInfiniteScrollObserver = (
  options: InfiniteScrollOptions
): { observerRef: React.RefObject<HTMLDivElement> } => {
  const observerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const { onLoadMore, hasMore, loading, threshold = 0.5, rootMargin = '100px' } = options;

    if (!hasMore || loading) return;

    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (entry.isIntersecting) {
          await onLoadMore();
        }
      },
      { threshold, rootMargin }
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => observer.disconnect();
  }, [options.hasMore, options.loading]);

  return { observerRef };
};

export const compressPayload = (data: any): any => {
  if (Array.isArray(data)) {
    return data.map(item => compressPayload(item));
  }

  if (typeof data === 'object' && data !== null) {
    const compressed: any = {};
    for (const key in data) {
      if (data[key] !== null && data[key] !== undefined && data[key] !== '') {
        compressed[key] = compressPayload(data[key]);
      }
    }
    return compressed;
  }

  return data;
};

import React from 'react';

const HOME_SCREEN_CACHE_KEY = 'home_screen_data_v3_optimized';
const HOME_SCREEN_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
const HOME_REVALIDATE_AFTER_MS = 10 * 60 * 1000; // Only background-revalidate when cache is older than 10 min (reduces egress/DB load)

export const fetchHomeScreenData = async (forceRefresh = false) => {
  try {
    if (!forceRefresh) {
      const cached = await persistentCache.get(HOME_SCREEN_CACHE_KEY);
      if (cached) {
        const ts = (cached as { timestamp?: number }).timestamp;
        if (typeof ts === 'number') {
          const age = Date.now() - ts;
          if (age >= HOME_REVALIDATE_AFTER_MS) {
            setTimeout(() => fetchHomeScreenData(true).catch(() => {}), 100);
          }
        }
        return cached;
      }
    }

    // Lazy-load supabase to avoid circular dependency / TDZ (index -> appInitializer -> dataFetching -> supabase)
    const { supabase } = await import('./supabase');

    // Build fresh promise array so each retry makes new requests (required for real retries)
    const buildFetchPromises = () => [
      supabase.rpc('get_shuffled_trending_songs', { days_param: null, limit_param: 20 }),
      supabase
        .from('songs')
        .select('id, title, duration_seconds, audio_url, cover_image_url, play_count, created_at, featured_artists, artists:artist_id(id, name, artist_profiles(stage_name, user_id, users:user_id(display_name)))')
        .is('album_id', null)
        .not('audio_url', 'is', null)
        .or(releaseDatePublicFilter())
        .order('created_at', { ascending: false })
        .limit(15),
      supabase
        .from('content_uploads')
        .select('id, title, description, content_type, metadata, play_count, created_at, user_id, users(id, display_name, avatar_url)')
        .eq('content_type', 'video')
        .eq('status', 'approved')
        .not('metadata->video_url', 'is', null)
        .order('play_count', { ascending: false })
        .limit(20),
      supabase
        .from('content_uploads')
        .select('id, title, metadata, play_count, created_at, user_id, users(id, display_name, avatar_url)')
        .eq('content_type', 'short_clip')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(12),
      supabase
        .from('albums')
        .select('id, title, cover_image_url, release_date, created_at, artists:artist_id(id, name, artist_profiles(stage_name))')
        .or(releaseDatePublicFilter())
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('artist_profiles')
        .select('id, stage_name, profile_photo_url, is_verified, user_id, users:user_id(display_name, country)')
        .limit(10),
      supabase
        .from('songs')
        .select('id, title, duration_seconds, audio_url, cover_image_url, play_count, country, featured_artists, artists:artist_id(id, name, artist_profiles(stage_name, user_id, users:user_id(display_name)))')
        .not('audio_url', 'is', null)
        .or(releaseDatePublicFilter())
        .gte('play_count', 50)
        .order('play_count', { ascending: false })
        .limit(15),
      supabase
        .from('songs')
        .select('id, title, duration_seconds, audio_url, cover_image_url, play_count, featured_artists, artists:artist_id(id, name, artist_profiles(stage_name, user_id, users:user_id(display_name)))')
        .not('audio_url', 'is', null)
        .or(releaseDatePublicFilter())
        .order('play_count', { ascending: false })
        .range(25, 40)
        .limit(15),
    ];

    // Execute with network-aware timeout and retries (2G: longer timeout + fresh retries)
    const timeoutMs = getRequestTimeoutMs(10000);
    const { attempts, delayMs, backoff } = getRetryConfig();
    let results: Array<PromiseSettledResult<{ data?: unknown[] }>> | null = null;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const allPromises = buildFetchPromises();
        results = (await Promise.race([
          Promise.allSettled(allPromises),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Home screen data fetch timeout')), timeoutMs)
          )
        ])) as Array<PromiseSettledResult<{ data?: unknown[] }>>;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < attempts) {
          const delay = backoff === 'exponential' ? delayMs * Math.pow(2, attempt - 1) : delayMs;
          await new Promise((r) => setTimeout(r, delay));
        } else {
          throw err;
        }
      }
    }
    if (!results) throw lastErr;

    // Extract results with fallbacks
    const [
      trendingSongsResult,
      newReleasesResult,
      mustWatchVideosResult,
      loopsResult,
      trendingAlbumsResult,
      topArtistsResult,
      trendingNearYouResult,
      aiRecommendedResult,
    ] = results;

    const rawTrendingSongs = (trendingSongsResult.status === 'fulfilled' ? trendingSongsResult.value?.data : null) ?? [];
    const trendingSongsArray = Array.isArray(rawTrendingSongs) ? rawTrendingSongs : [];
    const rawMustWatch = mustWatchVideosResult.status === 'fulfilled' ? (mustWatchVideosResult.value?.data || []) : [];
    const mustWatchVideos = rawMustWatch.filter((v: { metadata?: { release_date?: string | null } }) => isReleased(v.metadata?.release_date));
    const data = {
      trendingSongs: trendingSongsArray.filter((s) => isReleased((s as { release_date?: string | null }).release_date)),
      newReleases: newReleasesResult.status === 'fulfilled' ? (newReleasesResult.value?.data || []) : [],
      mustWatchVideos: mustWatchVideos.slice(0, 12),
      loops: loopsResult.status === 'fulfilled' ? (loopsResult.value?.data || []) : [],
      trendingAlbums: trendingAlbumsResult.status === 'fulfilled' ? (trendingAlbumsResult.value?.data || []) : [],
      topArtists: topArtistsResult.status === 'fulfilled' ? (topArtistsResult.value?.data || []) : [],
      mixes: [],
      trendingNearYou: trendingNearYouResult.status === 'fulfilled' ? (trendingNearYouResult.value?.data || []) : [],
      aiRecommended: aiRecommendedResult.status === 'fulfilled' ? (aiRecommendedResult.value?.data || []) : [],
      timestamp: Date.now(),
    };

    // Cache the data
    await persistentCache.set(HOME_SCREEN_CACHE_KEY, data, HOME_SCREEN_CACHE_DURATION);

    return data;
  } catch (error) {
    console.error('Error fetching home screen data:', error);

    // Try to return cached data on error
    const cached = await persistentCache.get(HOME_SCREEN_CACHE_KEY);
    if (cached) {
      return cached;
    }

    throw error;
  }
};

export const clearHomeScreenCache = async () => {
  await persistentCache.clear();
};
