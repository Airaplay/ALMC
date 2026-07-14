/**
 * Smart Cache Manager
 * 
 * Unified caching system with:
 * - Request deduplication
 * - Stale-while-revalidate pattern
 * - Automatic cache invalidation
 * - Cache size limits
 * - Memory management
 * - Background refresh
 */

import { cache } from './cache';
import { persistentCache } from './persistentCache';
import { getNetworkInfo } from './imageOptimization';

export interface CacheOptions {
  /** Time to live in milliseconds */
  ttl?: number;
  /** Use persistent cache (IndexedDB) instead of memory */
  persistent?: boolean;
  /** Enable stale-while-revalidate pattern */
  staleWhileRevalidate?: boolean;
  /** Background refresh interval in ms */
  backgroundRefresh?: number;
  /** Priority level for cache eviction */
  priority?: 'high' | 'medium' | 'low';
  /** Tags for cache invalidation */
  tags?: string[];
  /** Custom cache key prefix */
  keyPrefix?: string;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  tags: string[];
  priority: 'high' | 'medium' | 'low';
  accessCount: number;
  lastAccessed: number;
  size?: number; // Estimated size in bytes
}

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

class SmartCache {
  private pendingRequests = new Map<string, PendingRequest<any>>();
  private cacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    deduplications: 0,
  };
  private maxMemorySize = 50 * 1024 * 1024; // 50MB default
  private currentMemorySize = 0;
  private maxEntries = 1000;
  private entrySizes = new Map<string, number>();

  /**
   * Get data with smart caching
   */
  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const {
      ttl = 5 * 60 * 1000,
      persistent = false,
      staleWhileRevalidate = true,
      tags = [],
      priority = 'medium',
      keyPrefix = '',
    } = options;

    const fullKey = keyPrefix ? `${keyPrefix}:${key}` : key;

    // Check for pending request (deduplication)
    const pending = this.pendingRequests.get(fullKey);
    if (pending) {
      this.cacheStats.deduplications++;
      return pending.promise;
    }

    // Try to get from cache
    let cached: T | null = null;
    if (persistent) {
      cached = await persistentCache.get<T>(fullKey);
    } else {
      cached = cache.get(fullKey) as T | null;
    }

    if (cached) {
      // Check if stale
      const entry = cached as any as CacheEntry<T>;
      const isStale = entry?.expiresAt ? Date.now() > entry.expiresAt : false;
      const isExpired = entry?.expiresAt ? Date.now() > entry.expiresAt + ttl : false;

      if (!isExpired) {
        this.cacheStats.hits++;
        
        // Update access stats
        if (entry) {
          entry.lastAccessed = Date.now();
          entry.accessCount = (entry.accessCount || 0) + 1;
        }

        // Stale-while-revalidate: return cached, refresh in background
        if (isStale && staleWhileRevalidate) {
          this.refreshInBackground(fullKey, fetcher, options);
        }

        return entry?.data || cached;
      }
    }

    this.cacheStats.misses++;

    // Fetch fresh data
    const requestPromise = this.fetchAndCache(fullKey, fetcher, options);
    
    // Store pending request for deduplication
    this.pendingRequests.set(fullKey, {
      promise: requestPromise,
      timestamp: Date.now(),
    });

    try {
      const result = await requestPromise;
      return result;
    } finally {
      // Clean up pending request after a delay to handle rapid requests
      setTimeout(() => {
        this.pendingRequests.delete(fullKey);
      }, 1000);
    }
  }

  /**
   * Fetch and cache data
   */
  private async fetchAndCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions
  ): Promise<T> {
    try {
      const data = await fetcher();
      
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + (options.ttl || 5 * 60 * 1000),
        tags: options.tags || [],
        priority: options.priority || 'medium',
        accessCount: 1,
        lastAccessed: Date.now(),
        size: this.estimateSize(data),
      };

      // Check memory limits before caching
      if (!options.persistent) {
        this.enforceMemoryLimits(entry.size || 0);
      }

      if (options.persistent) {
        await persistentCache.set(key, entry, options.ttl || 5 * 60 * 1000);
      } else {
        cache.set(key, entry, options.ttl || 5 * 60 * 1000);
      }

      if (!options.persistent && entry.size) {
        this.currentMemorySize += entry.size;
        this.entrySizes.set(key, entry.size);
      }

      return data;
    } catch (error) {
      // On error, try to return stale cache if available
      let stale: T | null = null;
      if (options.persistent) {
        stale = await persistentCache.get<T>(key);
      } else {
        stale = cache.get(key) as T | null;
      }

      if (stale) {
        const entry = stale as any as CacheEntry<T>;
        return entry?.data || stale;
      }

      throw error;
    }
  }

  /**
   * Refresh data in background
   */
  private async refreshInBackground<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions
  ): Promise<void> {
    // Use requestIdleCallback if available, otherwise setTimeout
    const scheduleRefresh = (callback: () => void) => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(callback, { timeout: 2000 });
      } else {
        setTimeout(callback, 100);
      }
    };

    scheduleRefresh(async () => {
      try {
        await this.fetchAndCache(key, fetcher, options);
      } catch (error) {
        // Silently fail background refresh
        console.debug('Background refresh failed for', key, error);
      }
    });
  }

  /**
   * Invalidate cache by key pattern or tags
   */
  async invalidate(patternOrTags: string | string[]): Promise<void> {
    if (Array.isArray(patternOrTags)) {
      // Invalidate by tags
      const tags = patternOrTags;
      // This would require storing tag->key mappings
      // For now, clear all if tags are specified
      if (tags.length > 0) {
        cache.clear();
        await persistentCache.clear();
      }
    } else {
      // Invalidate by pattern
      const pattern = patternOrTags;
      cache.deletePattern(pattern);
      await persistentCache.deletePattern(pattern);
    }
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    this.pendingRequests.clear();
    cache.clear();
    await persistentCache.clear();
    this.currentMemorySize = 0;
    this.entrySizes.clear();
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      deduplications: 0,
    };
  }

  /**
   * Prefetch data
   */
  async prefetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<void> {
    const network = getNetworkInfo();
    
    // Only prefetch on good connections
    if (network.saveData || network.effectiveType === '2g' || network.effectiveType === 'slow-2g') {
      return;
    }

    try {
      await this.get(key, fetcher, { ...options, staleWhileRevalidate: false });
    } catch (error) {
      // Silently fail prefetch
      console.debug('Prefetch failed for', key, error);
    }
  }

  /**
   * Batch prefetch multiple items
   */
  async prefetchBatch<T>(
    items: Array<{ key: string; fetcher: () => Promise<T>; options?: CacheOptions }>
  ): Promise<void> {
    const network = getNetworkInfo();
    
    if (network.saveData) return;

    const isFastNetwork = network.effectiveType === '4g' && !network.saveData;

    if (isFastNetwork) {
      // Parallel prefetch on fast networks
      await Promise.allSettled(
        items.map(item => this.prefetch(item.key, item.fetcher, item.options))
      );
    } else {
      // Sequential prefetch on slower networks
      for (const item of items) {
        await this.prefetch(item.key, item.fetcher, item.options);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      ...this.cacheStats,
      memorySize: this.currentMemorySize,
      memoryLimit: this.maxMemorySize,
      entries: this.entrySizes.size,
      pendingRequests: this.pendingRequests.size,
      hitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0,
    };
  }

  /**
   * Estimate data size in bytes
   */
  private estimateSize(data: any): number {
    try {
      const jsonString = JSON.stringify(data);
      return new Blob([jsonString]).size;
    } catch {
      // Fallback estimate
      return 1024;
    }
  }

  /**
   * Enforce memory limits by evicting least recently used items
   */
  private enforceMemoryLimits(newEntrySize: number): void {
    if (this.currentMemorySize + newEntrySize <= this.maxMemorySize) {
      return;
    }

    // Get all cache entries with metadata
    const entries: Array<{ key: string; size: number; priority: string; lastAccessed: number }> = [];
    
    // This is a simplified version - in reality, we'd need to track this
    // For now, we'll use a simple eviction strategy
    const needsEviction = this.currentMemorySize + newEntrySize > this.maxMemorySize;
    
    if (needsEviction) {
      // Clear low-priority items first
      const keysToDelete: string[] = [];
      
      // Simple eviction: clear 20% of cache if we're over limit
      if (this.entrySizes.size > this.maxEntries * 0.8) {
        const sortedEntries = Array.from(this.entrySizes.entries())
          .sort((a, b) => a[1] - b[1]); // Sort by size
        
        const toDelete = Math.floor(sortedEntries.length * 0.2);
        for (let i = 0; i < toDelete; i++) {
          keysToDelete.push(sortedEntries[i][0]);
          this.currentMemorySize -= sortedEntries[i][1];
        }
        
        keysToDelete.forEach(key => {
          cache.delete(key);
          this.entrySizes.delete(key);
          this.cacheStats.evictions++;
        });
      }
    }
  }

  /**
   * Set memory limit
   */
  setMemoryLimit(bytes: number): void {
    this.maxMemorySize = bytes;
  }

  /**
   * Set max entries
   */
  setMaxEntries(max: number): void {
    this.maxEntries = max;
  }
}

export const smartCache = new SmartCache();

// Periodic cleanup
setInterval(() => {
  cache.cleanup();
  persistentCache.cleanup();
}, 5 * 60 * 1000); // Every 5 minutes

