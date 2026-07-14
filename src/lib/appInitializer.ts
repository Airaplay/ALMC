import { persistentCache } from './persistentCache';
import { backgroundPrefetcher } from './backgroundPrefetch';
import { fetchHomeScreenData } from './dataFetching';
import { getRequestTimeoutMs, shouldSkipBackgroundPrefetch } from './networkAwareConfig';
import { refreshFullscreenAdCooldownConfig } from './fullscreenAdCooldownConfig';

class AppInitializer {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Longer init timeout on 2G so cache can load
      const initTimeoutMs = getRequestTimeoutMs(8000);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Initialization timeout')), initTimeoutMs)
      );

      await Promise.race([
        persistentCache.init(),
        timeoutPromise
      ]).catch(err => {
        console.warn('Cache initialization failed, continuing without cache:', err);
      });

      // Skip aggressive prefetch on 2G to avoid blocking and save bandwidth
      if (!shouldSkipBackgroundPrefetch()) {
        this.startBackgroundPrefetch();
      }

      void refreshFullscreenAdCooldownConfig();

      this.setupVisibilityHandlers();

      this.setupConnectionMonitoring();

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize app:', error);
      this.initialized = true;
    }
  }

  /** Prefetch public data (home, explore) so first navigation is instant. Low egress: only fills cache. */
  private startBackgroundPrefetch(): void {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        fetchHomeScreenData(true).catch(() => {});
      }, { timeout: 4000 });
    } else {
      setTimeout(() => fetchHomeScreenData(true).catch(() => {}), 1500);
    }
  }

  private setupVisibilityHandlers(): void {
    // Disabled - prefetch only when user explicitly navigates
    // No automatic refreshing on visibility change
  }

  private setupConnectionMonitoring(): void {
    // Disabled - let components handle their own loading
    // No automatic prefetching on network changes
  }

  async clearAllCaches(): Promise<void> {
    await persistentCache.clear();
    backgroundPrefetcher.clearQueue();
  }
}

export const appInitializer = new AppInitializer();
