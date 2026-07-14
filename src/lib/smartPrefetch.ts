/**
 * Smart Prefetching Utility
 *
 * Intelligently prefetches data based on user behavior and network conditions
 * Reduces perceived latency without wasting bandwidth
 */

import { getNetworkInfo } from './imageOptimization';
import { queryCache, QUERY_CACHE_TTL } from './queryCache';

interface PrefetchTask {
  key: string;
  fetchFn: () => Promise<any>;
  priority: 'high' | 'medium' | 'low';
  ttl: number;
}

class SmartPrefetch {
  private static instance: SmartPrefetch;
  private pendingTasks: Map<string, PrefetchTask> = new Map();
  private executingTasks: Set<string> = new Set();
  private prefetchQueue: PrefetchTask[] = [];
  private isProcessing = false;

  private constructor() {
    // Start processing queue when browser is idle
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      this.startIdleProcessing();
    }
  }

  static getInstance(): SmartPrefetch {
    if (!SmartPrefetch.instance) {
      SmartPrefetch.instance = new SmartPrefetch();
    }
    return SmartPrefetch.instance;
  }

  /**
   * Add a prefetch task to the queue
   */
  addTask(
    key: string,
    fetchFn: () => Promise<any>,
    priority: 'high' | 'medium' | 'low' = 'medium',
    ttl: number = QUERY_CACHE_TTL.FIVE_MINUTES
  ): void {
    // Check if already cached
    const cached = queryCache.get(key);
    if (cached !== null) {
      return; // Already cached, no need to prefetch
    }

    // Check if already in queue or executing
    if (this.pendingTasks.has(key) || this.executingTasks.has(key)) {
      return; // Already queued or executing
    }

    const task: PrefetchTask = { key, fetchFn, priority, ttl };
    this.pendingTasks.set(key, task);
    this.prefetchQueue.push(task);

    // Sort by priority
    this.prefetchQueue.sort((a, b) => {
      const priorityMap = { high: 3, medium: 2, low: 1 };
      return priorityMap[b.priority] - priorityMap[a.priority];
    });

    // Trigger processing if not already running
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Prefetch data for trending content
   */
  prefetchTrending(): void {
    // Only prefetch on good connections
    const network = getNetworkInfo();
    if (network.saveData || network.effectiveType === '2g' || network.effectiveType === 'slow-2g') {
      return;
    }

    this.addTask(
      'trending_songs_prefetch',
      async () => {
        const { getTrendingSongs } = await import('./supabase');
        return getTrendingSongs(20);
      },
      'medium',
      QUERY_CACHE_TTL.FIVE_MINUTES
    );
  }

  /**
   * Prefetch user's playlists
   */
  prefetchUserPlaylists(userId: string): void {
    const network = getNetworkInfo();
    if (network.saveData) return;

    this.addTask(
      `user_playlists_${userId}`,
      async () => {
        const { getUserPlaylists } = await import('./supabase');
        return getUserPlaylists();
      },
      'low',
      QUERY_CACHE_TTL.TWO_MINUTES
    );
  }

  /**
   * Prefetch artist details when hovering/viewing artist lists
   */
  prefetchArtistDetails(artistId: string): void {
    const network = getNetworkInfo();
    if (network.saveData) return;

    this.addTask(
      `artist_details_${artistId}`,
      async () => {
        const { getArtistProfile } = await import('./supabase');
        return getArtistProfile(artistId);
      },
      'medium',
      QUERY_CACHE_TTL.FIVE_MINUTES
    );
  }

  /**
   * Prefetch album tracks when viewing album
   */
  prefetchAlbumTracks(albumId: string): void {
    this.addTask(
      `album_tracks_${albumId}`,
      async () => {
        const { getAlbumTracks } = await import('./supabase');
        return getAlbumTracks(albumId);
      },
      'high',
      QUERY_CACHE_TTL.FIVE_MINUTES
    );
  }

  /**
   * Process the prefetch queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.prefetchQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    const network = getNetworkInfo();
    const maxConcurrent = this.getMaxConcurrentTasks(network.effectiveType);

    while (this.prefetchQueue.length > 0 && this.executingTasks.size < maxConcurrent) {
      const task = this.prefetchQueue.shift();
      if (!task) break;

      this.pendingTasks.delete(task.key);
      this.executingTasks.add(task.key);

      // Execute task
      this.executeTask(task)
        .finally(() => {
          this.executingTasks.delete(task.key);
          // Continue processing queue
          this.processQueue();
        });
    }

    if (this.prefetchQueue.length === 0 && this.executingTasks.size === 0) {
      this.isProcessing = false;
    }
  }

  /**
   * Execute a single prefetch task
   */
  private async executeTask(task: PrefetchTask): Promise<void> {
    try {
      const data = await task.fetchFn();
      // Cache the result
      queryCache.set(task.key, data, task.ttl);
    } catch (error) {
      console.warn(`Prefetch failed for ${task.key}:`, error);
    }
  }

  /**
   * Get max concurrent tasks based on network
   */
  private getMaxConcurrentTasks(networkType: string): number {
    switch (networkType) {
      case '4g':
        return 3;
      case '3g':
        return 2;
      case '2g':
      case 'slow-2g':
        return 1;
      default:
        return 2;
    }
  }

  /**
   * Start processing queue during browser idle time
   */
  private startIdleProcessing(): void {
    const processIdle = () => {
      if (this.prefetchQueue.length > 0 && !this.isProcessing) {
        this.processQueue();
      }

      // Schedule next idle callback
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (window as any).requestIdleCallback(processIdle, { timeout: 2000 });
      }
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(processIdle, { timeout: 2000 });
    }
  }

  /**
   * Clear all pending prefetch tasks
   */
  clearQueue(): void {
    this.prefetchQueue = [];
    this.pendingTasks.clear();
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    pending: number;
    executing: number;
    totalQueued: number;
  } {
    return {
      pending: this.prefetchQueue.length,
      executing: this.executingTasks.size,
      totalQueued: this.pendingTasks.size,
    };
  }
}

// Export singleton instance
export const smartPrefetch = SmartPrefetch.getInstance();

/**
 * Hook for prefetching on component mount/hover
 */
export function usePrefetch() {
  return {
    prefetchTrending: () => smartPrefetch.prefetchTrending(),
    prefetchArtist: (artistId: string) => smartPrefetch.prefetchArtistDetails(artistId),
    prefetchAlbum: (albumId: string) => smartPrefetch.prefetchAlbumTracks(albumId),
    prefetchPlaylists: (userId: string) => smartPrefetch.prefetchUserPlaylists(userId),
  };
}

/**
 * Prefetch common data on app initialization
 */
export function prefetchCommonData(): void {
  const network = getNetworkInfo();

  // Only prefetch on good connections
  if (network.saveData || network.effectiveType === '2g' || network.effectiveType === 'slow-2g') {
    return;
  }

  // Prefetch trending content
  smartPrefetch.prefetchTrending();
}
