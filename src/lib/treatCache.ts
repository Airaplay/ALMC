interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresIn: number;
}

class TreatCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private readonly DEFAULT_TTL = 5 * 60 * 1000;

  set<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresIn: ttl,
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const isExpired = Date.now() - entry.timestamp > entry.expiresIn;

    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    const isExpired = Date.now() - entry.timestamp > entry.expiresIn;

    if (isExpired) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidatePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    const keysToDelete: string[] = [];

    this.cache.forEach((_, key) => {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.cache.delete(key));
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export const treatCache = new TreatCache();

export const CACHE_KEYS = {
  WALLET: (userId: string) => `wallet:${userId}`,
  TREAT_PACKAGES: 'treat:packages',
  WITHDRAWAL_SETTINGS: 'treat:withdrawal-settings',
  ACTIVE_PROMOTIONS: (userId: string) => `promotions:active:${userId}`,
  RECENT_TIPS: (userId: string) => `tips:recent:${userId}`,
  RECENT_RECIPIENTS: (userId: string) => `recipients:recent:${userId}`,
  CURRENCY_DATA: (userId: string) => `currency:${userId}`,
  TREAT_TRANSACTIONS: (userId: string, page: number) => `transactions:${userId}:${page}`,
};

export const getCachedData = async <T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl?: number
): Promise<T> => {
  const cached = treatCache.get<T>(key);

  if (cached !== null) {
    return cached;
  }

  const data = await fetchFn();
  treatCache.set(key, data, ttl);

  return data;
};
