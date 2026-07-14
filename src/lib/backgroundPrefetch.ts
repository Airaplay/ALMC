import { persistentCache } from './persistentCache';

interface PrefetchQueueItem {
  key: string;
  fetcher: () => Promise<any>;
  priority: 'high' | 'medium' | 'low';
  ttl: number;
}

class BackgroundPrefetcher {
  private queue: PrefetchQueueItem[] = [];
  private isProcessing = false;
  private refreshInterval: number = 10 * 60 * 1000; // Increased to 10 minutes
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Removed aggressive event listeners - components load on demand
  }

  private handleVisibilityChange = () => {
    // Disabled - no automatic refresh on visibility change
  };

  private handleFocus = () => {
    // Disabled - no automatic refresh on focus
  };

  enqueue(item: PrefetchQueueItem): void {
    const existing = this.queue.findIndex(q => q.key === item.key);
    if (existing !== -1) {
      this.queue[existing] = item;
    } else {
      this.queue.push(item);
    }

    this.queue.sort((a, b) => {
      const priorityMap = { high: 3, medium: 2, low: 1 };
      return priorityMap[b.priority] - priorityMap[a.priority];
    });

    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      try {
        const cached = await persistentCache.get(item.key);
        if (!cached) {
          const data = await item.fetcher();
          await persistentCache.set(item.key, data, item.ttl);
        }
      } catch (error) {
        console.error(`Prefetch failed for ${item.key}:`, error);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.isProcessing = false;
  }

  private startBackgroundRefresh(): void {
    if (this.refreshTimer) return;

    this.refreshTimer = setInterval(() => {
      this.refreshHomeScreenData();
    }, this.refreshInterval);
  }

  private stopBackgroundRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async refreshHomeScreenData(): Promise<void> {
    const homeScreenKeys = [
      'home-trending-songs',
      'home-new-releases',
      'home-trending-albums',
      'home-must-watch',
      'home-loops',
      'home-top-artists',
      'home-mix-for-you',
    ];

    for (const key of homeScreenKeys) {
      this.enqueue({
        key,
        fetcher: () => this.fetchSectionData(key),
        priority: 'low',
        ttl: 5 * 60 * 1000,
      });
    }
  }

  private async fetchSectionData(key: string): Promise<any> {
    // Individual sections handle their own data fetching
    // This prevents errors from non-existent tables/columns during background prefetch
    return [];
  }

  async processPriorityPrefetch(): Promise<void> {
    const priorityItems = [
      {
        key: 'home-trending-songs',
        fetcher: () => this.fetchSectionData('home-trending-songs'),
        priority: 'high' as const,
        ttl: 5 * 60 * 1000,
      },
      {
        key: 'home-new-releases',
        fetcher: () => this.fetchSectionData('home-new-releases'),
        priority: 'high' as const,
        ttl: 5 * 60 * 1000,
      },
    ];

    for (const item of priorityItems) {
      this.enqueue(item);
    }
  }

  async prefetchProfileData(userId: string): Promise<void> {
    // Prefetching disabled - individual components handle their own data fetching
    return;
  }

  async prefetchVideoData(videoId: string): Promise<void> {
    // Prefetching disabled - individual components handle their own data fetching
    return;
  }

  clearQueue(): void {
    this.queue = [];
  }

  destroy(): void {
    this.stopBackgroundRefresh();
    this.clearQueue();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('focus', this.handleFocus);
  }
}

export const backgroundPrefetcher = new BackgroundPrefetcher();
