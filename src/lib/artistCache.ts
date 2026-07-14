import { supabase, getFollowerCount } from './supabase';

interface ArtistCacheData {
  artistId: string;
  userId: string;
  profile: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    profile_photo_url?: string | null;
  };
  followerCount: number;
  timestamp: number;
}

class ArtistCacheService {
  private cache: Map<string, ArtistCacheData> = new Map();
  private loadingPromises: Map<string, Promise<ArtistCacheData | null>> = new Map();
  private readonly CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
  private readonly MAX_CACHE_SIZE = 100;

  /**
   * Get artist data from cache or load it
   */
  async get(artistId: string): Promise<ArtistCacheData | null> {
    // Check if we have valid cached data
    const cached = this.cache.get(artistId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached;
    }

    // Check if already loading
    if (this.loadingPromises.has(artistId)) {
      return this.loadingPromises.get(artistId)!;
    }

    // Load fresh data
    const loadingPromise = this.loadArtistData(artistId);
    this.loadingPromises.set(artistId, loadingPromise);

    try {
      const data = await loadingPromise;
      if (data) {
        this.set(artistId, data);
      }
      return data;
    } finally {
      this.loadingPromises.delete(artistId);
    }
  }

  /**
   * Get cached data immediately (without waiting for refresh)
   */
  getImmediate(artistId: string): ArtistCacheData | null {
    const cached = this.cache.get(artistId);
    if (!cached) return null;

    // Return even if expired - better to show stale data than loading state
    return cached;
  }

  /**
   * Set artist data in cache
   */
  set(artistId: string, data: Omit<ArtistCacheData, 'timestamp'>): void {
    // Implement LRU-style eviction
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(artistId, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /**
   * Update follower count in cache
   */
  updateFollowerCount(artistId: string, delta: number): void {
    const cached = this.cache.get(artistId);
    if (cached) {
      cached.followerCount = Math.max(0, cached.followerCount + delta);
      this.cache.set(artistId, cached);
    }
  }

  /**
   * Load artist data from database
   */
  private async loadArtistData(artistId: string): Promise<ArtistCacheData | null> {
    try {
      const { data: artistProfile } = await supabase
        .from('artist_profiles')
        .select('artist_id, user_id, profile_photo_url, users:user_id(id, display_name, avatar_url)')
        .eq('artist_id', artistId)
        .maybeSingle();

      let userId: string | null = null;
      let profile: any = null;
      let profilePhotoUrl: string | null = null;

      if (artistProfile?.user_id) {
        userId = artistProfile.user_id;
        profile = artistProfile.users;
        profilePhotoUrl = artistProfile.profile_photo_url;
      } else {
        const { data: userData } = await supabase
          .from('users')
          .select('id, display_name, avatar_url')
          .eq('id', artistId)
          .maybeSingle();

        if (userData) {
          userId = userData.id;
          profile = userData;
        }
      }

      if (!userId || !profile) {
        return null;
      }

      const followerCount = await getFollowerCount(userId);

      return {
        artistId,
        userId,
        profile: {
          id: profile.id,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url || profilePhotoUrl,
          profile_photo_url: profilePhotoUrl,
        },
        followerCount,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Error loading artist data:', error);
      return null;
    }
  }

  /**
   * Prefetch artist data in the background
   */
  async prefetch(artistId: string): Promise<void> {
    const cached = this.cache.get(artistId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return; // Already have fresh data
    }

    // Load in background without blocking
    this.get(artistId).catch(error => {
      console.error('Error prefetching artist data:', error);
    });
  }

  /**
   * Clear expired cache entries
   */
  clearExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_DURATION) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.loadingPromises.clear();
  }
}

export const artistCache = new ArtistCacheService();
