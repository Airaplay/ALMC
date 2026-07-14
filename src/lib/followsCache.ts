class FollowsCache {
  private readonly STORAGE_KEY = 'airaplay_follows';
  private readonly TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  private memoryCache: {
    followingIds: Set<string>;
    timestamp: number;
  };

  constructor() {
    this.memoryCache = {
      followingIds: new Set(),
      timestamp: Date.now()
    };
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Date.now() - parsed.timestamp < this.TTL) {
          this.memoryCache = {
            followingIds: new Set(parsed.followingIds || []),
            timestamp: parsed.timestamp
          };
        }
      }
    } catch (error) {
      console.error('Error loading follows cache:', error);
    }
  }

  private saveToStorage(): void {
    try {
      if (!this.memoryCache) return;

      const toStore = {
        followingIds: Array.from(this.memoryCache.followingIds),
        timestamp: Date.now()
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(toStore));
    } catch (error) {
      console.error('Error saving follows cache:', error);
    }
  }

  isFollowing(userId: string): boolean {
    return this.memoryCache.followingIds.has(userId);
  }

  setFollowing(userId: string, following: boolean): void {
    if (following) {
      this.memoryCache.followingIds.add(userId);
    } else {
      this.memoryCache.followingIds.delete(userId);
    }
    this.memoryCache.timestamp = Date.now();
    this.saveToStorage();
  }

  updateFromServer(followingIds: string[]): void {
    this.memoryCache = {
      followingIds: new Set(followingIds),
      timestamp: Date.now()
    };
    this.saveToStorage();
  }

  clear(): void {
    this.memoryCache = {
      followingIds: new Set(),
      timestamp: Date.now()
    };
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      console.error('Error clearing follows cache:', error);
    }
  }
}

export const followsCache = new FollowsCache();
