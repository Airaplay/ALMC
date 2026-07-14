import { supabase, getFollowerCount } from './supabase';

interface AlbumCacheData {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl: string | null;
  releaseDate?: string;
  description?: string;
  tracks: any[];
  totalDuration: number;
  playCount: number;
  followerCount?: number;
  timestamp: number;
  _cachedProfile?: any;
  _cachedFollowerCount?: number;
}

class AlbumCacheService {
  private cache: Map<string, AlbumCacheData> = new Map();
  private prefetchQueue: Set<string> = new Set();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_CACHE_SIZE = 50;

  /**
   * Prefetch album data in the background
   */
  async prefetch(albumId: string): Promise<void> {
    if (this.cache.has(albumId) || this.prefetchQueue.has(albumId)) {
      return;
    }

    this.prefetchQueue.add(albumId);

    try {
      const data = await this.loadAlbumData(albumId);
      if (data) {
        this.set(albumId, data);
      }
    } catch (error) {
      console.error(`Failed to prefetch album ${albumId}:`, error);
    } finally {
      this.prefetchQueue.delete(albumId);
    }
  }

  /**
   * Get cached album data
   */
  get(albumId: string): AlbumCacheData | null {
    const cached = this.cache.get(albumId);

    if (!cached) return null;

    // Check if cache is expired
    if (Date.now() - cached.timestamp > this.CACHE_DURATION) {
      this.cache.delete(albumId);
      return null;
    }

    return cached;
  }

  /**
   * Set album data in cache
   */
  set(albumId: string, data: Omit<AlbumCacheData, 'timestamp'>): void {
    // Implement LRU-style eviction
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(albumId, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /**
   * Load album data from database
   */
  private async loadAlbumData(albumId: string): Promise<Omit<AlbumCacheData, 'timestamp'> | null> {
    try {
      const { data: albumInfo, error: albumError } = await supabase
        .from('albums')
        .select(`
          id,
          title,
          artist_id,
          cover_image_url,
          release_date,
          description,
          artists:artist_id (
            id,
            name,
            artist_profiles!artist_profiles_artist_id_fkey (
              stage_name,
              user_id,
              users:user_id (
                display_name
              )
            )
          )
        `)
        .eq('id', albumId)
        .maybeSingle();

      if (albumError || !albumInfo) return null;

      const { data: songsData } = await supabase
        .from('songs')
        .select(`
          id,
          title,
          artist_id,
          cover_image_url,
          audio_url,
          duration_seconds,
          play_count,
          created_at,
          artists:artist_id (
            id,
            name,
            artist_profiles!artist_profiles_artist_id_fkey (
              stage_name,
              user_id,
              users:user_id (
                display_name
              )
            )
          )
        `)
        .eq('album_id', albumId)
        .order('created_at', { ascending: true });

      const artistName = Array.isArray(albumInfo.artists)
        ? albumInfo.artists[0]?.artist_profiles?.[0]?.stage_name || albumInfo.artists[0]?.name || 'Unknown Artist'
        : albumInfo.artists?.artist_profiles?.[0]?.stage_name || albumInfo.artists?.name || 'Unknown Artist';

      const tracks = (songsData || []).map((song: any, index: number) => {
        const songArtistName = Array.isArray(song.artists)
          ? song.artists[0]?.artist_profiles?.[0]?.stage_name || song.artists[0]?.name || artistName
          : song.artists?.artist_profiles?.[0]?.stage_name || song.artists?.name || artistName;

        return {
          id: song.id,
          title: song.title,
          artist: songArtistName,
          artistId: song.artist_id,
          duration: song.duration_seconds || 0,
          audioUrl: song.audio_url,
          coverImageUrl: song.cover_image_url || albumInfo.cover_image_url,
          trackNumber: index + 1,
          featuredArtists: [],
          playCount: song.play_count || 0,
        };
      });

      const playableTracks = tracks.filter(track => track.audioUrl);
      const totalDuration = playableTracks.reduce((sum, track) => sum + track.duration, 0);
      const totalPlayCount = playableTracks.reduce((sum, track) => sum + (track.playCount || 0), 0);

      // Load artist profile and follower count for instant display
      let cachedProfile = null;
      let cachedFollowerCount = 0;

      if (albumInfo.artist_id) {
        try {
          // Get artist profile
          const { data: artistProfile } = await supabase
            .from('artist_profiles')
            .select('artist_id, stage_name, user_id, users:user_id(id, display_name, avatar_url)')
            .eq('artist_id', albumInfo.artist_id)
            .maybeSingle();

          if (artistProfile?.user_id) {
            cachedProfile = artistProfile.users;
            cachedFollowerCount = await getFollowerCount(artistProfile.user_id);
          }
        } catch (error) {
          console.error('Error loading artist profile for cache:', error);
        }
      }

      return {
        id: albumInfo.id,
        title: albumInfo.title,
        artist: artistName,
        artistId: albumInfo.artist_id,
        coverImageUrl: albumInfo.cover_image_url,
        releaseDate: albumInfo.release_date,
        description: albumInfo.description,
        tracks: playableTracks,
        totalDuration,
        playCount: totalPlayCount,
        _cachedProfile: cachedProfile,
        _cachedFollowerCount: cachedFollowerCount,
      };
    } catch (error) {
      console.error('Error loading album data:', error);
      return null;
    }
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
    this.prefetchQueue.clear();
  }
}

export const albumCache = new AlbumCacheService();
