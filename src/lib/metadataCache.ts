/**
 * Metadata Cache Service
 * Caches frequently accessed metadata (genres, moods, artists, etc.) to reduce Supabase egress
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class MetadataCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private readonly DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes

  set<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if cache is expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  // Get or set pattern
  async getOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = this.DEFAULT_TTL
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const data = await fetchFn();
    this.set(key, data, ttl);
    return data;
  }
}

export const metadataCache = new MetadataCache();

// Cache keys for common metadata
export const METADATA_KEYS = {
  GENRES: 'genres:all',
  MOODS: 'moods:all',
  FEATURED_ARTISTS: 'featured:artists',
  APP_SECTIONS: 'app:sections',
  GENRE_IMAGES: 'genre:images',
  AD_CONFIG: 'ad:config',
};
