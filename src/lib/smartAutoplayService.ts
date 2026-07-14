import { supabase } from './supabase';
import { getRequestTimeoutMs } from './networkAwareConfig';

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  duration?: number;
  playCount?: number;
}

interface SimilarSongResult {
  song: Song;
  score: number;
  reason: string;
}

// Performance constants (timeouts are network-aware via getRequestTimeoutMs for 2G)
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache TTL (increased from 5min)
const MAX_CACHE_SIZE = 100; // Increased from 50 for better cache hits

// Query timeout wrapper
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
    )
  ]);
};

// Recommendation cache
interface CachedRecommendation {
  song: Song;
  expiresAt: number;
}

// In-memory cache for faster subsequent lookups
// Maps songId → recommended next song
const recommendationCache = new Map<string, CachedRecommendation>();

/**
 * Get cached recommendation if available and not expired
 * @param songId - ID of the song to get recommendation for
 * @returns Cached song or null if not available/expired
 */
const getCachedRecommendation = (songId: string): Song | null => {
  const cached = recommendationCache.get(songId);
  if (cached && cached.expiresAt > Date.now()) {
    console.log('[SmartAutoplay] ✓ Cache hit - using cached recommendation');
    return cached.song;
  }
  if (cached) {
    console.log('[SmartAutoplay] ✗ Cache expired - will fetch new recommendation');
  }
  recommendationCache.delete(songId);
  return null;
};

/**
 * Cache a recommendation for faster subsequent lookups
 * Automatically cleans up expired entries and enforces cache size limits
 * @param songId - ID of the song this recommendation is for
 * @param song - The recommended next song
 */
const setCachedRecommendation = (songId: string, song: Song): void => {
  // Clean up expired entries first (prevents cache bloat)
  const now = Date.now();
  for (const [key, cached] of recommendationCache.entries()) {
    if (cached.expiresAt <= now) {
      recommendationCache.delete(key);
    }
  }

  // Add new recommendation to cache
  recommendationCache.set(songId, {
    song,
    expiresAt: Date.now() + CACHE_TTL_MS
  });

  // Enforce cache size limit (LRU: remove oldest entry if over limit)
  if (recommendationCache.size > MAX_CACHE_SIZE) {
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const [key, cached] of recommendationCache.entries()) {
      if (cached.expiresAt < oldestExpiry) {
        oldestExpiry = cached.expiresAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      recommendationCache.delete(oldestKey);
      console.log('[SmartAutoplay] Cache limit reached - removed oldest entry');
    }
  }
};

class PlaybackHistoryManager {
  private static readonly MAX_HISTORY_SIZE = 50;
  private static readonly STORAGE_KEY = 'smart_autoplay_history';
  private static readonly BATCH_WRITE_DELAY = 2000; // Batch writes every 2 seconds
  private history: string[] = [];
  private loadingPromise: Promise<void> | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingWrite = false;

  constructor() {
    // Don't block constructor - load in background
    this.loadingPromise = this.loadHistoryAsync();
  }

  private async loadHistoryAsync(): Promise<void> {
    try {
      // Use requestIdleCallback if available, otherwise setTimeout
      await new Promise<void>((resolve) => {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(() => resolve());
        } else {
          setTimeout(() => resolve(), 0);
        }
      });

      const stored = localStorage.getItem(PlaybackHistoryManager.STORAGE_KEY);
      if (stored) {
        this.history = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error loading autoplay history:', error);
      this.history = [];
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loadingPromise) {
      await this.loadingPromise;
      this.loadingPromise = null;
    }
  }

  private saveHistory(): void {
    try {
      localStorage.setItem(
        PlaybackHistoryManager.STORAGE_KEY,
        JSON.stringify(this.history)
      );
      this.pendingWrite = false;
    } catch (error) {
      console.error('Error saving autoplay history:', error);
    }
  }

  private scheduleBatchWrite(): void {
    // Mark that we have pending changes
    this.pendingWrite = true;

    // Clear existing timer
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }

    // Schedule batched write
    this.writeTimer = setTimeout(() => {
      if (this.pendingWrite) {
        this.saveHistory();
      }
      this.writeTimer = null;
    }, PlaybackHistoryManager.BATCH_WRITE_DELAY);
  }

  async addToHistory(songId: string): Promise<void> {
    await this.ensureLoaded();
    // Update in-memory immediately (fast)
    this.history = [songId, ...this.history.filter(id => id !== songId)].slice(
      0,
      PlaybackHistoryManager.MAX_HISTORY_SIZE
    );
    // Batch the write to localStorage (optimization)
    this.scheduleBatchWrite();
  }

  // Flush any pending writes immediately (useful for cleanup)
  flushPendingWrites(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (this.pendingWrite) {
      this.saveHistory();
    }
  }

  async isInRecentHistory(songId: string, checkCount: number = 15): Promise<boolean> {
    await this.ensureLoaded();
    return this.history.slice(0, checkCount).includes(songId);
  }

  async getHistory(): Promise<string[]> {
    await this.ensureLoaded();
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
    this.flushPendingWrites(); // Ensure immediate save when clearing
    this.saveHistory();
  }
}

// Cleanup on page unload to ensure history is saved
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    historyManager.flushPendingWrites();
  });
}

const historyManager = new PlaybackHistoryManager();

const EXCLUDED_CONTEXTS = [
  'Global Trending',
  'Trending Near You',
  'New Releases',
  'Inspired By You',
  'album',
  'playlist',
  'mix'
];

export const shouldEnableSmartAutoplay = (
  context?: string,
  albumId?: string | null
): boolean => {
  if (albumId) {
    console.log('[SmartAutoplay] Disabled: Playing from album');
    return false;
  }

  if (!context || context === 'unknown') {
    console.log('[SmartAutoplay] Enabled: Direct play or unknown source');
    return true;
  }

  const lowerContext = context.toLowerCase();

  if (lowerContext.includes('album') || lowerContext.includes('playlist') || lowerContext.includes('mix')) {
    console.log(`[SmartAutoplay] Disabled: Context contains album/playlist/mix (${context})`);
    return false;
  }

  const isExcluded = EXCLUDED_CONTEXTS.some(excluded =>
    context.includes(excluded)
  );

  if (isExcluded) {
    console.log(`[SmartAutoplay] Disabled: Excluded context (${context})`);
    return false;
  }

  const allowedSources = ['search', 'direct', 'liked', 'recent'];
  const isAllowed = allowedSources.some(source =>
    lowerContext.includes(source)
  );

  if (isAllowed) {
    console.log(`[SmartAutoplay] Enabled: Allowed source (${context})`);
    return true;
  }

  console.log(`[SmartAutoplay] Enabled: Context not excluded (${context})`);
  return true;
};

const findSimilarSongs = async (song: Song, excludeIds: string[] = []): Promise<SimilarSongResult[]> => {
  try {
    const results: SimilarSongResult[] = [];
    const allExcludedIds = [...excludeIds, song.id];

    if (song.id) {
      // First query: Get song with genres (with timeout)
      const songQuery = supabase
        .from('songs')
        .select(`
          id,
          title,
          duration_seconds,
          audio_url,
          cover_image_url,
          play_count,
          song_genres (
            genre_id,
            genres (id, name)
          ),
          artists:artist_id (
            id,
            name,
            artist_profiles (
              id,
              user_id,
              stage_name,
              profile_photo_url,
              is_verified
            )
          )
        `)
        .eq('id', song.id)
        .maybeSingle();

      let songWithGenres;
      try {
        const result = await withTimeout(songQuery, getRequestTimeoutMs(3000));
        songWithGenres = result.data;
      } catch (error) {
        if (error instanceof Error && error.message === 'Query timeout') {
          console.warn('[SmartAutoplay] Song query timeout - returning empty results');
          return results;
        }
        throw error;
      }

      if (!songWithGenres) {
        return results;
      }

      const genreIds = songWithGenres.song_genres?.map((sg: any) => sg.genre_id) || [];

      // Run genre and artist queries in PARALLEL for better performance
      const [genreResult, artistResult] = await Promise.allSettled([
        // Genre query (with timeout)
        genreIds.length > 0
          ? withTimeout(
              supabase
                .from('song_genres')
                .select(`
                  song_id,
                  songs (
                    id,
                    title,
                    duration_seconds,
                    audio_url,
                    cover_image_url,
                    play_count,
                    artists:artist_id (
                      id,
                      name,
                      artist_profiles (
                        id,
                        user_id,
                        stage_name,
                        profile_photo_url,
                        is_verified
                      )
                    )
                  )
                `)
                .in('genre_id', genreIds)
                .limit(100), // Increased from 50 to 100 for more options
              getRequestTimeoutMs(3000)
            )
          : Promise.resolve({ data: null, error: null }),
        
        // Artist query (with timeout)
        song.artistId
          ? withTimeout(
              supabase
                .from('songs')
                .select(`
                  id,
                  title,
                  duration_seconds,
                  audio_url,
                  cover_image_url,
                  play_count,
                  artists:artist_id (
                    id,
                    name,
                    artist_profiles (
                      id,
                      user_id,
                      stage_name,
                      profile_photo_url,
                      is_verified
                    )
                  )
                `)
                .eq('artist_id', song.artistId)
                .order('play_count', { ascending: false })
                .limit(20), // Increased from 10 to 20 for more options
              getRequestTimeoutMs(3000)
            )
          : Promise.resolve({ data: null, error: null })
      ]);

      // Process genre results
      if (genreResult.status === 'fulfilled' && genreResult.value.data) {
        // Filter out excluded IDs in JavaScript (safer and more reliable)
        const genreSongs = genreResult.value.data.filter((entry: any) => 
          entry.song_id && !allExcludedIds.includes(entry.song_id)
        );
        const genreSongMap = new Map<string, number>();

        genreSongs.forEach((entry: any) => {
          const songId = entry.song_id;
          genreSongMap.set(songId, (genreSongMap.get(songId) || 0) + 1);
        });

        // Deduplicate by song ID (not object reference)
        const seenIds = new Set<string>();
        const uniqueGenreSongs = genreSongs
          .map((sg: any) => sg.songs)
          .filter((s): s is any => {
            if (!s || s === undefined || s === null || !s.id) return false;
            if (allExcludedIds.includes(s.id)) return false;
            if (seenIds.has(s.id)) return false;
            seenIds.add(s.id);
            return true;
          })
          .sort((a, b) => (genreSongMap.get(b.id) || 0) - (genreSongMap.get(a.id) || 0))
          .slice(0, 10);

        uniqueGenreSongs.forEach((s: any) => {
          results.push({
            song: {
              id: s.id,
              title: s.title,
              artist: s.artists?.artist_profiles?.[0]?.stage_name || s.artists?.name || 'Unknown Artist',
              artistId: s.artists?.id,
              coverImageUrl: s.cover_image_url,
              audioUrl: s.audio_url,
              duration: s.duration_seconds || 0,
              playCount: s.play_count || 0
            },
            score: 100 + (genreSongMap.get(s.id) || 0) * 10,
            reason: 'Same genre'
          });
        });
      } else if (genreResult.status === 'rejected') {
        console.warn('[SmartAutoplay] Genre query failed:', genreResult.reason);
      }

      // Process artist results
      if (artistResult.status === 'fulfilled' && artistResult.value.data) {
        // Filter out excluded IDs in JavaScript (safer and more reliable)
        const artistSongs = artistResult.value.data.filter((s: any) => 
          s.id && !allExcludedIds.includes(s.id)
        );
        artistSongs.forEach((s: any) => {
            const existingResult = results.find(r => r.song.id === s.id);
            if (existingResult) {
              existingResult.score += 50;
              existingResult.reason = 'Same artist and genre';
            } else {
              results.push({
                song: {
                  id: s.id,
                  title: s.title,
                  artist: s.artists?.artist_profiles?.[0]?.stage_name || s.artists?.name || 'Unknown Artist',
                  artistId: s.artists?.id,
                  coverImageUrl: s.cover_image_url,
                  audioUrl: s.audio_url,
                  duration: s.duration_seconds || 0,
                  playCount: s.play_count || 0
                },
                score: 50,
                reason: 'Same artist'
              });
            }
        });
      } else if (artistResult.status === 'rejected') {
        console.warn('[SmartAutoplay] Artist query failed:', artistResult.reason);
      }

      // Add diversity: get some popular songs from different artists/genres
      // This helps prevent getting stuck when similar songs are all filtered out
      if (results.length < 10) {
        try {
          let diversityQuery = supabase
            .from('songs')
            .select(`
              id,
              title,
              duration_seconds,
              audio_url,
              cover_image_url,
              play_count,
              artists:artist_id (
                id,
                name,
                artist_profiles (
                  id,
                  user_id,
                  stage_name,
                  profile_photo_url,
                  is_verified
                )
              )
            `);
          
          if (song.artistId) {
            diversityQuery = diversityQuery.neq('artist_id', song.artistId);
          }
          
          // Filter out excluded IDs - use filter if we have IDs to exclude
          if (allExcludedIds.length > 0 && allExcludedIds.length <= 100) {
            // Supabase has a limit on 'in' clause, so we filter in JavaScript if too many
            diversityQuery = diversityQuery.not('id', 'in', `(${allExcludedIds.join(',')})`);
          }
          
          diversityQuery = diversityQuery.order('play_count', { ascending: false }).limit(15);

          const diversityResult = await withTimeout(diversityQuery, getRequestTimeoutMs(3000));
          
          if (diversityResult.data && diversityResult.data.length > 0) {
            let addedCount = 0;
            diversityResult.data.forEach((s: any) => {
              if (!allExcludedIds.includes(s.id)) {
                const existingResult = results.find(r => r.song.id === s.id);
                if (!existingResult) {
                  results.push({
                    song: {
                      id: s.id,
                      title: s.title,
                      artist: s.artists?.artist_profiles?.[0]?.stage_name || s.artists?.name || 'Unknown Artist',
                      artistId: s.artists?.id,
                      coverImageUrl: s.cover_image_url,
                      audioUrl: s.audio_url,
                      duration: s.duration_seconds || 0,
                      playCount: s.play_count || 0
                    },
                    score: 20, // Lower score for diversity - will be used if similar songs are exhausted
                    reason: 'Diverse recommendation'
                  });
                  addedCount++;
                }
              }
            });
            if (addedCount > 0) {
              console.log(`[SmartAutoplay] Added ${addedCount} diverse recommendations`);
            }
          }
        } catch (error) {
          console.warn('[SmartAutoplay] Diversity query failed (non-critical):', error);
          // Don't throw - diversity is optional
        }
      }
    }

    return results.sort((a, b) => b.score - a.score);
  } catch (error) {
    if (error instanceof Error && error.message === 'Query timeout') {
      console.warn('[SmartAutoplay] Query timeout - returning partial results');
      return results; // Return what we have so far
    }
    console.error('Error finding similar songs:', error);
    return [];
  }
};

export const getSmartAutoplayRecommendation = async (
  song: Song,
  context?: string,
  albumId?: string | null,
  currentPlaylist: Song[] = []
): Promise<Song | null> => {
  try {
    if (!shouldEnableSmartAutoplay(context, albumId)) {
      console.log('[SmartAutoplay] Not enabled for this context');
      return null;
    }

    // Check cache first - but validate it before using (less strict: only check last 3 songs)
    const cached = getCachedRecommendation(song.id);
    if (cached) {
      // Validate cache is still safe to use - only invalidate if in VERY recent history (last 3 songs)
      const recentHistory = await historyManager.getHistory();
      const isVeryRecent = recentHistory.slice(0, 3).includes(cached.id);
      const isCurrentSong = cached.id === song.id;
      const isInPlaylist = currentPlaylist.some(s => s.id === cached.id);
      
      if (!isVeryRecent && !isCurrentSong && !isInPlaylist) {
        console.log('[SmartAutoplay] Using validated cached recommendation');
        return cached; // Safe to use
      }
      // Cache is stale or unsafe - invalidate and continue
      console.log('[SmartAutoplay] Cache invalidated (duplicate/unsafe)');
      recommendationCache.delete(song.id);
    }

    console.log('[SmartAutoplay] Finding recommendation for:', song.title);

    const recentHistory = await historyManager.getHistory();
    
    // Create playlist ID set for fast lookup (limit to last 20 to prevent accumulation)
    const limitedPlaylist = currentPlaylist.slice(-20);
    const playlistIds = new Set(limitedPlaylist.map(s => s.id));
    const currentSongId = song.id;

    // Progressive history window relaxation: start with 15, relax to 10, then 5 if needed
    const historyWindows = [15, 10, 5];
    
    // Add timeout to entire recommendation process
    const recommendationPromise = (async () => {
      for (const windowSize of historyWindows) {
        const recentHistorySlice = recentHistory.slice(0, windowSize);
        console.log(`[SmartAutoplay] Trying with history window: ${windowSize} (excluding ${recentHistorySlice.length} songs)`);

        const similarSongs = await findSimilarSongs(song, recentHistorySlice);

        // Performance optimization: First filter by basic criteria (fast, synchronous)
        const basicFiltered = similarSongs.filter(result => {
          // Exclude if already in current playlist
          if (playlistIds.has(result.song.id)) {
            return false;
          }
          // Exclude if it's the current song
          if (result.song.id === currentSongId) {
            return false;
          }
          return true;
        });

        // Only check history for top 10 candidates (optimization: reduces async operations)
        const topCandidates = basicFiltered.slice(0, 10);

        if (topCandidates.length === 0) {
          console.log(`[SmartAutoplay] No candidates after basic filtering with window ${windowSize}`);
          continue;
        }

        // Check history only for top candidates (parallel async checks)
        const historyChecks = await Promise.all(
          topCandidates.map(result =>
            historyManager.isInRecentHistory(result.song.id, windowSize).then(isRecent => ({ result, isRecent }))
          )
        );

        // Final filtering based on history
        const filteredSongs = historyChecks
          .filter(({ isRecent }) => !isRecent)
          .map(({ result }) => result);

        if (filteredSongs.length > 0) {
          const shuffleIndex = Math.floor(Math.random() * Math.min(3, filteredSongs.length));
          const recommendation = filteredSongs[shuffleIndex];

          // Final safety check before returning
          if (recommendation.song.id === currentSongId || playlistIds.has(recommendation.song.id)) {
            console.warn('[SmartAutoplay] Final check failed - recommendation is duplicate');
            // Try next option if available
            if (filteredSongs.length > 1) {
              const nextRecommendation = filteredSongs[(shuffleIndex + 1) % filteredSongs.length];
              if (nextRecommendation.song.id !== currentSongId && !playlistIds.has(nextRecommendation.song.id)) {
                await historyManager.addToHistory(song.id);
                await historyManager.addToHistory(nextRecommendation.song.id);
                console.log(
                  `[SmartAutoplay] Recommending (alternative, window ${windowSize}): "${nextRecommendation.song.title}" by ${nextRecommendation.song.artist}`,
                  `(${nextRecommendation.reason}, score: ${nextRecommendation.score})`
                );
                setCachedRecommendation(song.id, nextRecommendation.song);
                return nextRecommendation.song;
              }
            }
            // Continue to next window size if this one failed
            continue;
          }

          await historyManager.addToHistory(song.id);
          await historyManager.addToHistory(recommendation.song.id);

          console.log(
            `[SmartAutoplay] Recommending (window ${windowSize}): "${recommendation.song.title}" by ${recommendation.song.artist}`,
            `(${recommendation.reason}, score: ${recommendation.score})`
          );

          // Cache the recommendation
          setCachedRecommendation(song.id, recommendation.song);
          return recommendation.song;
        }

        // If no results with this window, try next (more relaxed)
        console.log(`[SmartAutoplay] No results with history window ${windowSize}, trying ${windowSize > 5 ? windowSize - 5 : 'expanded search'}...`);
      }

      // If all windows failed, try expanded search with minimal exclusion (last 5 only)
      console.log('[SmartAutoplay] All history windows exhausted, trying expanded search...');
      const minimalExclusion = recentHistory.slice(0, 5);
      const expandedSongs = await findSimilarSongs(song, minimalExclusion);
      
      const safeExpandedSongs = expandedSongs.filter(result => {
        return result.song.id !== currentSongId && !playlistIds.has(result.song.id);
      });

      if (safeExpandedSongs.length > 0) {
        const recommendation = safeExpandedSongs[0];

        await historyManager.addToHistory(song.id);
        await historyManager.addToHistory(recommendation.song.id);

        console.log(
          `[SmartAutoplay] Recommending (expanded search): "${recommendation.song.title}" by ${recommendation.song.artist}`,
          `(${recommendation.reason}, score: ${recommendation.score})`
        );

        // Cache the recommendation
        setCachedRecommendation(song.id, recommendation.song);
        return recommendation.song;
      }

      console.log('[SmartAutoplay] No similar songs found after all attempts');
      return null;
    })();

    // Overall timeout for recommendation process (reduced to 3.5 seconds for faster UX)
    return await withTimeout(recommendationPromise, getRequestTimeoutMs(3500));
  } catch (error) {
    if (error instanceof Error && error.message === 'Query timeout') {
      console.warn('[SmartAutoplay] Recommendation timeout - returning null');
      return null;
    }
    console.error('Error getting smart autoplay recommendation:', error);
    return null;
  }
};

export const clearAutoplayHistory = (): void => {
  historyManager.clearHistory();
  console.log('[SmartAutoplay] History cleared');
};

export const getAutoplayHistory = async (): Promise<string[]> => {
  return await historyManager.getHistory();
};
