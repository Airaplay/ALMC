import { supabase } from './supabase';

interface PlaylistCacheData {
  id: string;
  title: string;
  description?: string;
  coverImageUrl: string | null;
  userId: string;
  userName?: string;
  userAvatar?: string;
  tracks: any[];
  totalDuration: number;
  createdAt?: string;
  updatedAt?: string;
  isOwner: boolean;
  timestamp: number;
}

class PlaylistCacheService {
  private cache: Map<string, PlaylistCacheData> = new Map();
  private prefetchQueue: Set<string> = new Set();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_CACHE_SIZE = 50;

  /**
   * Prefetch playlist data in the background
   */
  async prefetch(playlistId: string): Promise<void> {
    if (this.cache.has(playlistId) || this.prefetchQueue.has(playlistId)) {
      return;
    }

    this.prefetchQueue.add(playlistId);

    try {
      const data = await this.loadPlaylistData(playlistId);
      if (data) {
        this.set(playlistId, data);
      }
    } catch (error) {
      console.error(`Failed to prefetch playlist ${playlistId}:`, error);
    } finally {
      this.prefetchQueue.delete(playlistId);
    }
  }

  /**
   * Get cached playlist data
   */
  get(playlistId: string): PlaylistCacheData | null {
    const cached = this.cache.get(playlistId);

    if (!cached) return null;

    // Check if cache is expired
    if (Date.now() - cached.timestamp > this.CACHE_DURATION) {
      this.cache.delete(playlistId);
      return null;
    }

    return cached;
  }

  /**
   * Set playlist data in cache
   */
  set(playlistId: string, data: Omit<PlaylistCacheData, 'timestamp'>): void {
    // Implement LRU-style eviction
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(playlistId, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /**
   * Load playlist data from database
   */
  private async loadPlaylistData(playlistId: string): Promise<Omit<PlaylistCacheData, 'timestamp'> | null> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const currentUserId = session?.user?.id;

      // Try playlists table first
      const { data: playlistInfo } = await supabase
        .from('playlists')
        .select(`
          id,
          title,
          description,
          cover_image_url,
          user_id,
          created_at,
          updated_at
        `)
        .eq('id', playlistId)
        .maybeSingle();

      if (!playlistInfo) {
        // Try curated mixes
        const { data: curatedMix } = await supabase
          .from('curated_mixes')
          .select('*')
          .eq('id', playlistId)
          .maybeSingle();

        if (curatedMix) {
          return await this.loadCuratedMixData(curatedMix, currentUserId);
        }

        // Fallback to content_uploads
        const { data: mixInfo } = await supabase
          .from('content_uploads')
          .select(`
            id,
            title,
            description,
            metadata,
            user_id,
            created_at,
            updated_at
          `)
          .eq('id', playlistId)
          .eq('content_type', 'mix')
          .eq('status', 'approved')
          .maybeSingle();

        if (mixInfo) {
          return await this.loadMixData(mixInfo, currentUserId);
        }

        return null;
      }

      // Load user data
      const { data: userData } = await supabase
        .from('users')
        .select('id, display_name, avatar_url')
        .eq('id', playlistInfo.user_id)
        .maybeSingle();

      // Load playlist songs
      const { data: playlistSongs } = await supabase
        .from('playlist_songs')
        .select(`
          song_id,
          added_at,
          songs:song_id (
            id,
            title,
            artist_id,
            cover_image_url,
            audio_url,
            duration_seconds,
            play_count,
            artists:artist_id (
              name
            )
          )
        `)
        .eq('playlist_id', playlistId)
        .order('added_at', { ascending: true });

      const tracks = (playlistSongs || [])
        .filter(ps => ps.songs)
        .map((ps: any, index: number) => {
          const song = ps.songs;
          const artistName = Array.isArray(song.artists)
            ? song.artists[0]?.artist_profiles?.[0]?.stage_name || song.artists[0]?.name || 'Unknown Artist'
            : song.artists?.artist_profiles?.[0]?.stage_name || song.artists?.name || 'Unknown Artist';

          return {
            id: song.id,
            title: song.title,
            artist: artistName,
            artistId: song.artist_id,
            duration: song.duration_seconds || 0,
            audioUrl: song.audio_url,
            coverImageUrl: song.cover_image_url,
            trackNumber: index + 1,
            featuredArtists: [],
            playCount: song.play_count || 0,
            addedAt: ps.added_at,
          };
        });

      const playableTracks = tracks.filter(track => track.audioUrl);
      const totalDuration = playableTracks.reduce((sum, track) => sum + track.duration, 0);

      return {
        id: playlistInfo.id,
        title: playlistInfo.title,
        description: playlistInfo.description,
        coverImageUrl: playlistInfo.cover_image_url,
        userId: playlistInfo.user_id,
        userName: userData?.display_name || 'Unknown User',
        userAvatar: userData?.avatar_url,
        tracks: playableTracks,
        totalDuration,
        createdAt: playlistInfo.created_at,
        updatedAt: playlistInfo.updated_at,
        isOwner: currentUserId === playlistInfo.user_id,
      };
    } catch (error) {
      console.error('Error loading playlist data:', error);
      return null;
    }
  }

  private async loadCuratedMixData(mixData: any, currentUserId?: string): Promise<Omit<PlaylistCacheData, 'timestamp'> | null> {
    try {
      const { data: mixDetails } = await supabase.rpc('get_mix_with_song_details', {
        mix_id: mixData.id,
      });

      if (!mixDetails?.songs?.length) return null;

      const { data: userData } = await supabase
        .from('users')
        .select('id, display_name, avatar_url')
        .eq('id', mixData.created_by)
        .maybeSingle();

      const tracks = mixDetails.songs.map((song: any, index: number) => ({
        id: song.id,
        title: song.title || 'Untitled Track',
        artist: song.artist || 'Unknown Artist',
        artistId: null,
        duration: song.duration || 0,
        audioUrl: song.audio_url || null,
        coverImageUrl: song.cover_url || mixData.cover_image_url,
        trackNumber: index + 1,
        featuredArtists: [],
        playCount: song.play_count || 0,
        addedAt: mixData.created_at,
      }));

      const playableTracks = tracks.filter((track: any) => track.audioUrl);
      const totalDuration = playableTracks.reduce((sum: number, track: any) => sum + track.duration, 0);

      return {
        id: mixData.id,
        title: mixData.title,
        description: mixData.description,
        coverImageUrl: mixData.cover_image_url || null,
        userId: mixData.created_by,
        userName: userData?.display_name || 'Airaplay Admin',
        userAvatar: userData?.avatar_url,
        tracks: playableTracks,
        totalDuration,
        createdAt: mixData.created_at,
        updatedAt: mixData.updated_at,
        isOwner: currentUserId === mixData.created_by,
      };
    } catch (error) {
      console.error('Error loading curated mix:', error);
      return null;
    }
  }

  private async loadMixData(mixInfo: any, currentUserId?: string): Promise<Omit<PlaylistCacheData, 'timestamp'> | null> {
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('id, display_name, avatar_url')
        .eq('id', mixInfo.user_id)
        .maybeSingle();

      const tracks: any[] = [];
      if (mixInfo.metadata?.song_details && Array.isArray(mixInfo.metadata.song_details)) {
        mixInfo.metadata.song_details.forEach((song: any, index: number) => {
          tracks.push({
            id: song.id,
            title: song.title || 'Untitled Track',
            artist: song.artist || 'Unknown Artist',
            artistId: null,
            duration: song.duration || 0,
            audioUrl: song.audio_url || null,
            coverImageUrl: song.cover_url || mixInfo.metadata?.cover_url,
            trackNumber: index + 1,
            featuredArtists: [],
            playCount: 0,
            addedAt: mixInfo.created_at,
          });
        });
      }

      const playableTracks = tracks.filter(track => track.audioUrl);
      const totalDuration = playableTracks.reduce((sum, track) => sum + track.duration, 0);

      return {
        id: mixInfo.id,
        title: mixInfo.title,
        description: mixInfo.description,
        coverImageUrl: mixInfo.metadata?.cover_url || null,
        userId: mixInfo.user_id,
        userName: userData?.display_name || 'Mix Creator',
        userAvatar: userData?.avatar_url,
        tracks: playableTracks,
        totalDuration,
        createdAt: mixInfo.created_at,
        updatedAt: mixInfo.updated_at,
        isOwner: currentUserId === mixInfo.user_id,
      };
    } catch (error) {
      console.error('Error loading mix:', error);
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

export const playlistCache = new PlaylistCacheService();
