/**
 * Query Result Caching System
 *
 * Caches expensive query results to reduce database egress
 * Uses both memory and localStorage for persistence
 *
 * Use Cases:
 * - Trending songs (cache for 5 minutes)
 * - New releases (cache for 10 minutes)
 * - User playlists (cache for 2 minutes)
 * - Artist details (cache for 5 minutes)
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  key: string;
}

interface QueryCacheOptions {
  ttl: number; // Time to live in milliseconds
  staleWhileRevalidate?: boolean; // Serve stale data while fetching fresh
  prefix?: string; // Cache key prefix for namespacing
}

class QueryCache {
  private static instance: QueryCache;
  private memoryCache: Map<string, CacheEntry<any>> = new Map();
  private pendingRequests: Map<string, Promise<any>> = new Map();

  private constructor() {
    // Clean up expired cache entries periodically
    if (typeof window !== 'undefined') {
      setInterval(() => this.cleanupExpired(), 60000); // Every minute
    }
  }

  static getInstance(): QueryCache {
    if (!QueryCache.instance) {
      QueryCache.instance = new QueryCache();
    }
    return QueryCache.instance;
  }

  /**
   * Get cached data if available and not expired
   */
  get<T>(key: string): T | null {
    // Check memory cache first
    const memCached = this.memoryCache.get(key);
    if (memCached && Date.now() < memCached.expiresAt) {
      return memCached.data as T;
    }

    // Check localStorage
    try {
      const stored = localStorage.getItem(`query_cache_${key}`);
      if (stored) {
        const parsed: CacheEntry<T> = JSON.parse(stored);
        if (Date.now() < parsed.expiresAt) {
          // Restore to memory cache
          this.memoryCache.set(key, parsed);
          return parsed.data;
        } else {
          // Expired, clean up
          localStorage.removeItem(`query_cache_${key}`);
        }
      }
    } catch (error) {
      console.warn('Error reading query cache:', error);
    }

    return null;
  }

  /**
   * Store data in cache
   */
  set<T>(key: string, data: T, ttl: number): void {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl,
      key,
    };

    // Store in memory
    this.memoryCache.set(key, entry);

    // Store in localStorage (with size limit check)
    try {
      const serialized = JSON.stringify(entry);
      if (serialized.length < 1000000) { // Limit to ~1MB per entry
        localStorage.setItem(`query_cache_${key}`, serialized);
      }
    } catch (error) {
      console.warn('Error writing query cache:', error);
    }
  }

  /**
   * Invalidate specific cache entry
   */
  invalidate(key: string): void {
    this.memoryCache.delete(key);
    try {
      localStorage.removeItem(`query_cache_${key}`);
    } catch (error) {
      console.warn('Error invalidating cache:', error);
    }
  }

  /**
   * Invalidate all entries with a given prefix
   */
  invalidateByPrefix(prefix: string): void {
    // Clear memory cache
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        this.memoryCache.delete(key);
      }
    }

    // Clear localStorage
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(`query_cache_${prefix}`)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Error invalidating cache by prefix:', error);
    }
  }

  /**
   * Clear all cached queries
   */
  clearAll(): void {
    this.memoryCache.clear();
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith('query_cache_')) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Error clearing query cache:', error);
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now();

    // Clean memory cache
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now >= entry.expiresAt) {
        this.memoryCache.delete(key);
      }
    }

    // Clean localStorage (sample, not all)
    try {
      const keys = Object.keys(localStorage);
      const sampleKeys = keys.filter(k => k.startsWith('query_cache_')).slice(0, 10);

      sampleKeys.forEach(key => {
        try {
          const stored = localStorage.getItem(key);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (now >= parsed.expiresAt) {
              localStorage.removeItem(key);
            }
          }
        } catch {
          // Remove corrupt entries
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Error during cache cleanup:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    memoryEntries: number;
    memorySize: number;
    storageEntries: number;
    keys: string[];
  } {
    const keys: string[] = [];
    let storageCount = 0;

    try {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('query_cache_')) {
          keys.push(key.replace('query_cache_', ''));
          storageCount++;
        }
      });
    } catch (error) {
      // Ignore
    }

    return {
      memoryEntries: this.memoryCache.size,
      memorySize: Array.from(this.memoryCache.values())
        .reduce((sum, entry) => sum + JSON.stringify(entry).length, 0),
      storageEntries: storageCount,
      keys,
    };
  }

  /**
   * Fetch with cache and de-duplication
   * If the same query is in-flight, return the existing promise
   */
  async fetchWithCache<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: QueryCacheOptions = { ttl: 300000 } // Default 5 minutes
  ): Promise<T> {
    // Check cache first
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Check if request is in-flight
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key) as Promise<T>;
    }

    // Create new request
    const requestPromise = fetchFn()
      .then(data => {
        this.set(key, data, options.ttl);
        this.pendingRequests.delete(key);
        return data;
      })
      .catch(error => {
        this.pendingRequests.delete(key);
        throw error;
      });

    this.pendingRequests.set(key, requestPromise);
    return requestPromise;
  }
}

// Cache TTL presets
export const QUERY_CACHE_TTL = {
  ONE_MINUTE: 60 * 1000,
  TWO_MINUTES: 2 * 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
  TEN_MINUTES: 10 * 60 * 1000,
  FIFTEEN_MINUTES: 15 * 60 * 1000,
  THIRTY_MINUTES: 30 * 60 * 1000,
} as const;

// Export singleton
export const queryCache = QueryCache.getInstance();

/**
 * Helper function for common query caching pattern
 */
export async function cachedQuery<T>(
  cacheKey: string,
  queryFn: () => Promise<T>,
  ttl: number = QUERY_CACHE_TTL.FIVE_MINUTES
): Promise<T> {
  return queryCache.fetchWithCache(cacheKey, queryFn, { ttl });
}
