/**
 * Configuration Cache Service
 * Provides aggressive caching for config tables that rarely change
 * Reduces PostgREST egress by caching config data locally
 */

interface CacheItem<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

interface CacheConfig {
  key: string;
  ttl: number; // Time to live in milliseconds
}

class ConfigCache {
  private static instance: ConfigCache;
  private memoryCache: Map<string, CacheItem<any>> = new Map();

  private constructor() {}

  static getInstance(): ConfigCache {
    if (!ConfigCache.instance) {
      ConfigCache.instance = new ConfigCache();
    }
    return ConfigCache.instance;
  }

  /**
   * Get cached data or return null if expired/missing
   */
  get<T>(key: string): T | null {
    // Try memory cache first (fastest)
    const memCached = this.memoryCache.get(key);
    if (memCached && Date.now() < memCached.expiresAt) {
      return memCached.data as T;
    }

    // Try localStorage (persists across sessions)
    try {
      const stored = localStorage.getItem(`config_cache_${key}`);
      if (stored) {
        const parsed: CacheItem<T> = JSON.parse(stored);
        if (Date.now() < parsed.expiresAt) {
          // Restore to memory cache
          this.memoryCache.set(key, parsed);
          return parsed.data;
        } else {
          // Expired, clean up
          localStorage.removeItem(`config_cache_${key}`);
        }
      }
    } catch (error) {
      console.warn('Error reading from cache:', error);
    }

    return null;
  }

  /**
   * Store data in cache with TTL
   */
  set<T>(key: string, data: T, ttl: number): void {
    const cacheItem: CacheItem<T> = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl,
    };

    // Store in memory cache
    this.memoryCache.set(key, cacheItem);

    // Store in localStorage for persistence
    try {
      localStorage.setItem(`config_cache_${key}`, JSON.stringify(cacheItem));
    } catch (error) {
      console.warn('Error writing to cache:', error);
    }
  }

  /**
   * Invalidate a specific cache key
   */
  invalidate(key: string): void {
    this.memoryCache.delete(key);
    try {
      localStorage.removeItem(`config_cache_${key}`);
    } catch (error) {
      console.warn('Error invalidating cache:', error);
    }
  }

  /**
   * Clear all config cache
   */
  clearAll(): void {
    this.memoryCache.clear();
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith('config_cache_')) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Error clearing cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    memorySize: number;
    localStorageSize: number;
    keys: string[];
  } {
    const keys: string[] = [];
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('config_cache_')) {
          keys.push(key.replace('config_cache_', ''));
        }
      });
    } catch (error) {
      // Ignore
    }

    return {
      memorySize: this.memoryCache.size,
      localStorageSize: keys.length,
      keys,
    };
  }
}

// Cache TTL configurations
export const CACHE_TTL = {
  ONE_HOUR: 60 * 60 * 1000,
  SIX_HOURS: 6 * 60 * 60 * 1000,
  TWELVE_HOURS: 12 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

// Cache keys
export const CACHE_KEYS = {
  DAILY_MIX_CONFIG: 'daily_mix_config',
  GLOBAL_DAILY_MIXES: 'global_daily_mixes',
  EXCHANGE_RATES: 'withdrawal_exchange_rates',
  MOOD_CATEGORIES: 'mood_categories',
  PAYMENT_CHANNELS: 'payment_channels',
  COLLABORATION_UNLOCK_SETTINGS: 'collaboration_unlock_settings',
  AD_PLACEMENT_CONFIG: 'ad_placement_config',
  GENRE_LIST: 'genre_list',
} as const;

// Export singleton instance
export const configCache = ConfigCache.getInstance();

/**
 * Helper function to fetch with cache
 */
export async function fetchWithCache<T>(
  cacheKey: string,
  ttl: number,
  fetchFn: () => Promise<T>,
  forceRefresh = false
): Promise<T> {
  if (!forceRefresh) {
    const cached = configCache.get<T>(cacheKey);
    if (cached !== null) {
      return cached;
    }
  }

  const data = await fetchFn();
  configCache.set(cacheKey, data, ttl);
  return data;
}
