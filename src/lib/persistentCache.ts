interface CacheItem<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

class PersistentCache {
  private memoryCache = new Map<string, CacheItem<any>>();
  private dbName = 'airaplay-cache';
  private storeName = 'cache-store';
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }

  async set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): Promise<void> {
    const item: CacheItem<T> = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };

    this.memoryCache.set(key, item);

    if (this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        store.put(item, key);
      } catch (error) {
        console.error('Failed to persist cache:', error);
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const memItem = this.memoryCache.get(key);
    if (memItem && Date.now() < memItem.expiresAt) {
      return memItem.data;
    }

    if (this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        return new Promise((resolve) => {
          request.onsuccess = () => {
            const item = request.result as CacheItem<T> | undefined;
            if (item && Date.now() < item.expiresAt) {
              this.memoryCache.set(key, item);
              resolve(item.data);
            } else {
              resolve(null);
            }
          };
          request.onerror = () => resolve(null);
        });
      } catch (error) {
        console.error('Failed to retrieve from cache:', error);
      }
    }

    return null;
  }

  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);

    if (this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        store.delete(key);
      } catch (error) {
        console.error('Failed to delete from cache:', error);
      }
    }
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();

    if (this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        store.clear();
      } catch (error) {
        console.error('Failed to clear cache:', error);
      }
    }
  }

  async deletePattern(pattern: string): Promise<void> {
    const regex = new RegExp(pattern);

    for (const key of this.memoryCache.keys()) {
      if (regex.test(key)) {
        await this.delete(key);
      }
    }
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, item] of this.memoryCache.entries()) {
      if (now > item.expiresAt) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      await this.delete(key);
    }
  }

  getMemoryStats(): { size: number; keys: string[] } {
    return {
      size: this.memoryCache.size,
      keys: Array.from(this.memoryCache.keys())
    };
  }
}

export const persistentCache = new PersistentCache();

if (typeof window !== 'undefined') {
  persistentCache.init();

  setInterval(() => {
    persistentCache.cleanup();
  }, 5 * 60 * 1000);
}
