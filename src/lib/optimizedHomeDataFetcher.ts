/**
 * Optimized Home Data Fetcher
 * Consolidates queries, caches metadata, and reduces Supabase egress
 */

import { supabase } from './supabase';
import { metadataCache, METADATA_KEYS } from './metadataCache';

interface HomeDataCache {
  trendingSongs: any[];
  newReleases: any[];
  mustWatchVideos: any[];
  trendingAlbums: any[];
  featuredArtists: any[];
  trendingNearYou: any[];
  tracksBlowingUp: any[];
  dailyMixes: any[];
  lastFetched: number;
}

let homeDataCache: HomeDataCache | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all home screen data in a single optimized batch
 */
export async function fetchOptimizedHomeData(userId?: string, userCountry?: string) {
  // Return cached data if still fresh
  if (homeDataCache && Date.now() - homeDataCache.lastFetched < CACHE_DURATION) {
    return homeDataCache;
  }

  try {
    // Fetch all sections in parallel with minimal columns
    const [
      trendingSongs,
      newReleases,
      mustWatchVideos,
      trendingAlbums,
      featuredArtists,
      trendingNearYou,
      tracksBlowingUp,
    ] = await Promise.all([
      // Trending Songs - only essential columns
      supabase
        .from('songs')
        .select('id, title, artist_id, cover_image_url, play_count, created_at, duration_seconds')
        .eq('is_approved', true)
        .order('play_count', { ascending: false })
        .limit(20)
        .then(({ data }) => data || []),

      // New Releases - only essential columns
      supabase
        .from('songs')
        .select('id, title, artist_id, cover_image_url, created_at, duration_seconds')
        .eq('is_approved', true)
        .order('created_at', { ascending: false })
        .limit(15)
        .then(({ data }) => data || []),

      // Must Watch Videos - only essential columns
      supabase
        .from('content_uploads')
        .select('id, title, user_id, thumbnail_url, play_count, created_at, duration')
        .eq('content_type', 'video')
        .eq('is_approved', true)
        .order('play_count', { ascending: false })
        .limit(12)
        .then(({ data }) => data || []),

      // Trending Albums - only essential columns
      supabase
        .from('albums')
        .select('id, title, artist_id, cover_image_url, play_count, created_at')
        .eq('is_published', true)
        .order('play_count', { ascending: false })
        .limit(10)
        .then(({ data }) => data || []),

      // Featured Artists - cached
      metadataCache.getOrFetch(
        METADATA_KEYS.FEATURED_ARTISTS,
        async () => {
          const { data } = await supabase
            .from('featured_artists')
            .select('id, user_id, featured_until, weekly_growth_percentage')
            .gt('featured_until', new Date().toISOString())
            .order('weekly_growth_percentage', { ascending: false })
            .limit(10);
          return data || [];
        },
        10 * 60 * 1000 // Cache for 10 minutes
      ),

      // Trending Near You (if country provided)
      userCountry
        ? supabase
            .from('songs')
            .select('id, title, artist_id, cover_image_url, play_count, created_at, duration_seconds')
            .eq('country', userCountry)
            .eq('is_approved', true)
            .order('play_count', { ascending: false })
            .limit(15)
            .then(({ data }) => data || [])
        : Promise.resolve([]),

      // Tracks Blowing Up - only essential columns
      supabase
        .from('songs')
        .select('id, title, artist_id, cover_image_url, play_count, created_at, duration_seconds')
        .eq('is_approved', true)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('play_count', { ascending: false })
        .limit(20)
        .then(({ data }) => data || []),
    ]);

    // Cache the results
    homeDataCache = {
      trendingSongs,
      newReleases,
      mustWatchVideos,
      trendingAlbums,
      featuredArtists,
      trendingNearYou,
      tracksBlowingUp,
      dailyMixes: [], // Daily mixes are user-specific, not cached here
      lastFetched: Date.now(),
    };

    return homeDataCache;
  } catch (error) {
    console.error('Error fetching optimized home data:', error);
    // Return cached data even if expired, better than nothing
    return homeDataCache || {
      trendingSongs: [],
      newReleases: [],
      mustWatchVideos: [],
      trendingAlbums: [],
      featuredArtists: [],
      trendingNearYou: [],
      tracksBlowingUp: [],
      dailyMixes: [],
      lastFetched: 0,
    };
  }
}

/**
 * Fetch artist details in batch (reduces N+1 queries)
 */
export async function fetchArtistsBatch(artistIds: string[]) {
  if (artistIds.length === 0) return new Map();

  const uniqueIds = [...new Set(artistIds)];
  const cacheKey = `artists:batch:${uniqueIds.sort().join(',')}`;

  return await metadataCache.getOrFetch(
    cacheKey,
    async () => {
      const { data } = await supabase
        .from('users')
        .select('id, display_name, avatar_url, username')
        .in('id', uniqueIds);

      const artistMap = new Map();
      (data || []).forEach((artist) => {
        artistMap.set(artist.id, artist);
      });
      return artistMap;
    },
    5 * 60 * 1000 // Cache for 5 minutes
  );
}

/**
 * Fetch genres with caching
 */
export async function fetchGenresMetadata() {
  return await metadataCache.getOrFetch(
    METADATA_KEYS.GENRES,
    async () => {
      const { data } = await supabase
        .from('genres')
        .select('id, name, image_url')
        .order('name');
      return data || [];
    },
    30 * 60 * 1000 // Cache for 30 minutes
  );
}

/**
 * Fetch moods with caching
 */
export async function fetchMoodsMetadata() {
  return await metadataCache.getOrFetch(
    METADATA_KEYS.MOODS,
    async () => {
      const { data } = await supabase
        .from('moods')
        .select('id, name, color')
        .order('name');
      return data || [];
    },
    30 * 60 * 1000 // Cache for 30 minutes
  );
}

/**
 * Invalidate home data cache (call when user uploads content or on significant changes)
 */
export function invalidateHomeDataCache() {
  homeDataCache = null;
}

/**
 * Pre-warm cache (call on app init)
 */
export async function prewarmCache(userId?: string, userCountry?: string) {
  // Fetch in background, don't await
  Promise.all([
    fetchOptimizedHomeData(userId, userCountry),
    fetchGenresMetadata(),
    fetchMoodsMetadata(),
  ]).catch((error) => {
    console.error('Error prewarming cache:', error);
  });
}
