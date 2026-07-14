/**
 * Enhanced Data Fetching Utilities
 * 
 * Provides unified interface for fetching data with:
 * - Smart caching
 * - Request deduplication
 * - Network-aware fetching
 * - Error handling and retries
 * - Request queuing
 */

import { smartCache } from './smartCache';
import { getNetworkInfo } from './imageOptimization';
import { isSlowNetwork } from './networkAwareConfig';
import type { CacheOptions } from './smartCache';

export interface FetchConfig<T> extends CacheOptions {
  /** Retry configuration */
  retry?: {
    attempts: number;
    delay: number;
    backoff?: 'exponential' | 'linear';
  };
  /** Network requirements */
  networkRequirement?: 'any' | 'wifi' | '4g' | '3g';
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Transform function for response */
  transform?: (data: any) => T;
  /** Validate response before caching */
  validate?: (data: any) => boolean;
}

interface RequestQueue {
  priority: 'high' | 'medium' | 'low';
  request: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

class RequestQueueManager {
  private queue: RequestQueue[] = [];
  private processing = false;
  private maxConcurrent = 3;
  private currentConcurrent = 0;

  async enqueue<T>(
    request: () => Promise<T>,
    priority: 'high' | 'medium' | 'low' = 'medium'
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        priority,
        request,
        resolve,
        reject,
      });

      // Sort by priority
      this.queue.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });

      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.currentConcurrent >= this.maxConcurrent) {
      return;
    }

    if (this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && this.currentConcurrent < this.maxConcurrent) {
      const item = this.queue.shift();
      if (!item) break;

      this.currentConcurrent++;

      item.request()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this.currentConcurrent--;
          this.processQueue();
        });
    }

    this.processing = false;
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max;
  }
}

const requestQueue = new RequestQueueManager();

/**
 * Enhanced fetch with smart caching and error handling
 */
export async function enhancedFetch<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  config: FetchConfig<T> = {}
): Promise<T> {
  const {
    retry,
    networkRequirement = 'any',
    signal,
    transform,
    validate,
    ...cacheOptions
  } = config;

  // Check network requirements
  if (networkRequirement !== 'any') {
    const network = getNetworkInfo();
    const canProceed = checkNetworkRequirement(network, networkRequirement);
    
    if (!canProceed) {
      // Try to return cached data
      const cached = await smartCache.get(cacheKey, fetcher, {
        ...cacheOptions,
        staleWhileRevalidate: false,
      });
      return cached;
    }
  }

  // Retry wrapper
  const fetchWithRetry = async (attempt = 1): Promise<T> => {
    try {
      let data = await fetcher();

      // Transform if provided
      if (transform) {
        data = transform(data) as Awaited<T>;
      }

      // Validate if provided
      if (validate && !validate(data)) {
        throw new Error('Data validation failed');
      }

      // Abort check
      if (signal?.aborted) {
        throw new Error('Request aborted');
      }

      return data;
    } catch (error) {
      // Retry logic
      if (retry && attempt < retry.attempts) {
        const delay = calculateRetryDelay(attempt, retry.delay, retry.backoff);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchWithRetry(attempt + 1);
      }
      throw error;
    }
  };

  // Use smart cache with retry wrapper
  return smartCache.get(cacheKey, fetchWithRetry, cacheOptions);
}

/**
 * Batch fetch multiple items with priority queuing
 */
export async function batchFetch<T>(
  requests: Array<{
    cacheKey: string;
    fetcher: () => Promise<T>;
    config?: FetchConfig<T>;
    priority?: 'high' | 'medium' | 'low';
  }>
): Promise<T[]> {
  const network = getNetworkInfo();
  const isFastNetwork = network.effectiveType === '4g' && !network.saveData;
  // On 2G, run one request at a time to avoid overwhelming the connection
  requestQueue.setMaxConcurrent(isSlowNetwork() ? 1 : 3);

  if (isFastNetwork && requests.length <= 10) {
    // Parallel fetch on fast networks for small batches
    return Promise.all(
      requests.map(req =>
        enhancedFetch(req.cacheKey, req.fetcher, req.config || {})
      )
    );
  }

  // Sequential with priority queuing for slower networks or large batches
  const results: T[] = [];
  for (const req of requests) {
    const result = await requestQueue.enqueue(
      () => enhancedFetch(req.cacheKey, req.fetcher, req.config || {}),
      req.priority || 'medium'
    );
    results.push(result);
  }

  return results;
}

/**
 * Prefetch data for better UX
 */
export async function prefetchData<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  config: FetchConfig<T> = {}
): Promise<void> {
  const network = getNetworkInfo();
  
  // Only prefetch on good connections
  if (network.saveData || network.effectiveType === '2g') {
    return;
  }

  // Use requestIdleCallback for non-blocking prefetch
  const schedulePrefetch = (callback: () => void) => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(callback, { timeout: 3000 });
    } else {
      setTimeout(callback, 100);
    }
  };

  schedulePrefetch(async () => {
    try {
      await smartCache.prefetch(cacheKey, fetcher, config);
    } catch (error) {
      // Silently fail prefetch
      console.debug('Prefetch failed:', error);
    }
  });
}

/**
 * Cache invalidation helpers
 */
export const cacheInvalidation = {
  /**
   * Invalidate cache by pattern
   */
  async byPattern(pattern: string): Promise<void> {
    await smartCache.invalidate(pattern);
  },

  /**
   * Invalidate cache by tags
   */
  async byTags(tags: string[]): Promise<void> {
    await smartCache.invalidate(tags);
  },

  /**
   * Invalidate user-specific cache
   */
  async byUser(userId: string): Promise<void> {
    await smartCache.invalidate(`user:${userId}:*`);
  },

  /**
   * Invalidate song-related cache
   */
  async bySong(songId: string): Promise<void> {
    await smartCache.invalidate(`song:${songId}:*`);
  },

  /**
   * Invalidate artist-related cache
   */
  async byArtist(artistId: string): Promise<void> {
    await smartCache.invalidate(`artist:${artistId}:*`);
  },

  /**
   * Clear all cache
   */
  async clearAll(): Promise<void> {
    await smartCache.clear();
  },
};

/**
 * Check network requirement
 */
function checkNetworkRequirement(
  network: ReturnType<typeof getNetworkInfo>,
  requirement: string
): boolean {
  switch (requirement) {
    case 'wifi':
      return !network.saveData && (network.effectiveType === '4g' || network.effectiveType === '3g');
    case '4g':
      return network.effectiveType === '4g' && !network.saveData;
    case '3g':
      return (network.effectiveType === '4g' || network.effectiveType === '3g') && !network.saveData;
    default:
      return true;
  }
}

/**
 * Calculate retry delay
 */
function calculateRetryDelay(
  attempt: number,
  baseDelay: number,
  backoff?: 'exponential' | 'linear'
): number {
  if (backoff === 'exponential') {
    return baseDelay * Math.pow(2, attempt - 1);
  }
  return baseDelay * attempt;
}

/**
 * Network-aware batch size
 */
export function getOptimalBatchSize(): number {
  const network = getNetworkInfo();
  
  if (network.saveData) return 1;
  
  switch (network.effectiveType) {
    case '4g':
      return 10;
    case '3g':
      return 5;
    case '2g':
    case 'slow-2g':
      return 2;
    default:
      return 3;
  }
}

/**
 * Check if data should be refreshed
 */
export function shouldRefreshData(
  lastFetchTime: number,
  maxAge: number
): boolean {
  return Date.now() - lastFetchTime > maxAge;
}

export default {
  enhancedFetch,
  batchFetch,
  prefetchData,
  cacheInvalidation,
  getOptimalBatchSize,
  shouldRefreshData,
};

