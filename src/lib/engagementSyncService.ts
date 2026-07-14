/**
 * Engagement Sync Service
 *
 * Manages real-time synchronization of engagement metrics (play counts, likes, views, etc.)
 * across all sections and components in the app.
 *
 * This prevents inconsistent display of metrics when content is cached differently
 * across various sections of the Home Screen.
 */

type EngagementMetric = 'play_count' | 'like_count' | 'view_count' | 'comment_count';

interface EngagementUpdate {
  contentId: string;
  contentType: 'song' | 'video' | 'album' | 'playlist';
  metric: EngagementMetric;
  value: number;
  timestamp: number;
}

type EngagementListener = (update: EngagementUpdate) => void;

class EngagementSyncService {
  private listeners: Map<string, Set<EngagementListener>> = new Map();
  private metricCache: Map<string, Map<EngagementMetric, number>> = new Map();

  /**
   * Subscribe to engagement updates for specific content
   * Returns an unsubscribe function
   */
  subscribe(contentId: string, listener: EngagementListener): () => void {
    if (!this.listeners.has(contentId)) {
      this.listeners.set(contentId, new Set());
    }

    this.listeners.get(contentId)!.add(listener);

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(contentId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.listeners.delete(contentId);
        }
      }
    };
  }

  /**
   * Subscribe to all engagement updates (useful for sections with multiple items)
   * Returns an unsubscribe function
   */
  subscribeToAll(listener: EngagementListener): () => void {
    const globalKey = '__all__';
    if (!this.listeners.has(globalKey)) {
      this.listeners.set(globalKey, new Set());
    }

    this.listeners.get(globalKey)!.add(listener);

    return () => {
      const listeners = this.listeners.get(globalKey);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.listeners.delete(globalKey);
        }
      }
    };
  }

  /**
   * Emit an engagement update
   * This will notify all subscribers
   */
  emit(update: EngagementUpdate): void {
    // Update cache
    if (!this.metricCache.has(update.contentId)) {
      this.metricCache.set(update.contentId, new Map());
    }
    this.metricCache.get(update.contentId)!.set(update.metric, update.value);

    // Notify specific content listeners
    const contentListeners = this.listeners.get(update.contentId);
    if (contentListeners) {
      contentListeners.forEach(listener => {
        try {
          listener(update);
        } catch (error) {
          console.error('Error in engagement listener:', error);
        }
      });
    }

    // Notify global listeners
    const globalListeners = this.listeners.get('__all__');
    if (globalListeners) {
      globalListeners.forEach(listener => {
        try {
          listener(update);
        } catch (error) {
          console.error('Error in global engagement listener:', error);
        }
      });
    }

    console.log(`[EngagementSync] Updated ${update.contentType} ${update.contentId}: ${update.metric} = ${update.value}`);
  }

  /**
   * Get cached metric value
   */
  getCachedValue(contentId: string, metric: EngagementMetric): number | null {
    return this.metricCache.get(contentId)?.get(metric) ?? null;
  }

  /**
   * Update play count for a song/video
   */
  updatePlayCount(contentId: string, contentType: 'song' | 'video', newCount: number): void {
    this.emit({
      contentId,
      contentType,
      metric: 'play_count',
      value: newCount,
      timestamp: Date.now()
    });
  }

  /**
   * Increment play count by 1 (optimistic update)
   */
  incrementPlayCount(contentId: string, contentType: 'song' | 'video'): void {
    const currentCount = this.getCachedValue(contentId, 'play_count') ?? 0;
    this.updatePlayCount(contentId, contentType, currentCount + 1);
  }

  /**
   * Update like count
   */
  updateLikeCount(contentId: string, contentType: 'song' | 'video' | 'album' | 'playlist', newCount: number): void {
    this.emit({
      contentId,
      contentType,
      metric: 'like_count',
      value: newCount,
      timestamp: Date.now()
    });
  }

  /**
   * Update view count
   */
  updateViewCount(contentId: string, contentType: 'song' | 'video', newCount: number): void {
    this.emit({
      contentId,
      contentType,
      metric: 'view_count',
      value: newCount,
      timestamp: Date.now()
    });
  }

  /**
   * Update comment count
   */
  updateCommentCount(contentId: string, contentType: 'song' | 'video', newCount: number): void {
    this.emit({
      contentId,
      contentType,
      metric: 'comment_count',
      value: newCount,
      timestamp: Date.now()
    });
  }

  /**
   * Clear all listeners and cache
   */
  clear(): void {
    this.listeners.clear();
    this.metricCache.clear();
  }

  /**
   * Get number of active listeners (for debugging)
   */
  getListenerCount(): number {
    let count = 0;
    this.listeners.forEach(set => count += set.size);
    return count;
  }
}

// Export singleton instance
export const engagementSync = new EngagementSyncService();

// Export types for use in components
export type { EngagementUpdate, EngagementMetric };
