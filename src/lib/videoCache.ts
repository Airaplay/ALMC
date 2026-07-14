import { supabase } from './supabase';

interface VideoCacheData {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  playCount: number;
  createdAt: string;
  creator: {
    id: string;
    name: string;
    avatar: string | null;
    followerCount: number;
  };
  relatedVideos?: any[];
  timestamp: number;
}

interface VideoLikeState {
  isLiked: boolean;
  likesCount: number;
  timestamp: number;
}

class VideoCacheService {
  private cache: Map<string, VideoCacheData> = new Map();
  private likeStateCache: Map<string, VideoLikeState> = new Map();
  private prefetchQueue: Set<string> = new Set();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  private readonly LIKE_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_CACHE_SIZE = 50;

  /**
   * Prefetch video data in the background
   */
  async prefetch(videoId: string): Promise<void> {
    if (this.cache.has(videoId) || this.prefetchQueue.has(videoId)) {
      return;
    }

    this.prefetchQueue.add(videoId);

    try {
      const data = await this.loadVideoData(videoId);
      if (data) {
        this.set(videoId, data);
      }
    } catch (error) {
      console.error(`Failed to prefetch video ${videoId}:`, error);
    } finally {
      this.prefetchQueue.delete(videoId);
    }
  }

  /**
   * Get cached video data
   */
  get(videoId: string): VideoCacheData | null {
    const cached = this.cache.get(videoId);

    if (!cached) return null;

    // Check if cache is expired
    if (Date.now() - cached.timestamp > this.CACHE_DURATION) {
      this.cache.delete(videoId);
      return null;
    }

    return cached;
  }

  /**
   * Set video data in cache
   */
  set(videoId: string, data: Omit<VideoCacheData, 'timestamp'>): void {
    // Implement LRU-style eviction
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(videoId, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /**
   * Load video data from database
   */
  private async loadVideoData(videoId: string): Promise<Omit<VideoCacheData, 'timestamp'> | null> {
    try {
      // Load video details
      const { data: videoData, error: videoError } = await supabase
        .from('content_uploads')
        .select(`
          id,
          title,
          description,
          video_url,
          thumbnail_url,
          play_count,
          created_at,
          user_id,
          users:user_id (
            id,
            display_name,
            avatar_url
          )
        `)
        .eq('id', videoId)
        .eq('content_type', 'video')
        .eq('status', 'approved')
        .maybeSingle();

      if (videoError || !videoData) return null;

      const user = Array.isArray(videoData.users) ? videoData.users[0] : videoData.users;

      // Get follower count
      const { count: followerCount } = await supabase
        .from('followers')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', videoData.user_id);

      // Load related videos from same creator
      const { data: relatedVideos } = await supabase
        .from('content_uploads')
        .select(`
          id,
          title,
          thumbnail_url,
          play_count,
          duration,
          user_id,
          users:user_id (
            display_name
          )
        `)
        .eq('content_type', 'video')
        .eq('status', 'approved')
        .eq('user_id', videoData.user_id)
        .neq('id', videoId)
        .order('created_at', { ascending: false })
        .limit(6);

      const formattedRelatedVideos = (relatedVideos || []).map((video: any) => {
        const videoUser = Array.isArray(video.users) ? video.users[0] : video.users;
        return {
          id: video.id,
          title: video.title,
          thumbnailUrl: video.thumbnail_url,
          creatorName: videoUser?.display_name || 'Unknown',
          userId: video.user_id,
          playCount: video.play_count || 0,
          duration: video.duration || 0,
        };
      });

      return {
        id: videoData.id,
        title: videoData.title,
        description: videoData.description,
        videoUrl: videoData.video_url,
        thumbnailUrl: videoData.thumbnail_url,
        playCount: videoData.play_count || 0,
        createdAt: videoData.created_at,
        creator: {
          id: videoData.user_id,
          name: user?.display_name || 'Unknown User',
          avatar: user?.avatar_url || null,
          followerCount: followerCount || 0,
        },
        relatedVideos: formattedRelatedVideos,
      };
    } catch (error) {
      console.error('Error loading video data:', error);
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
    this.likeStateCache.clear();
    this.prefetchQueue.clear();
  }

  /**
   * Get cached like state
   */
  getLikeState(videoId: string): VideoLikeState | null {
    const cached = this.likeStateCache.get(videoId);

    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.LIKE_CACHE_DURATION) {
      this.likeStateCache.delete(videoId);
      return null;
    }

    return cached;
  }

  /**
   * Set like state in cache
   */
  setLikeState(videoId: string, isLiked: boolean, likesCount: number): void {
    this.likeStateCache.set(videoId, {
      isLiked,
      likesCount,
      timestamp: Date.now(),
    });
  }

  /**
   * Update like state (optimistic update)
   */
  updateLikeState(videoId: string, isLiked: boolean): void {
    const cached = this.likeStateCache.get(videoId);
    if (cached) {
      this.likeStateCache.set(videoId, {
        isLiked,
        likesCount: isLiked ? cached.likesCount + 1 : Math.max(0, cached.likesCount - 1),
        timestamp: Date.now(),
      });
    }
  }
}

export const videoCache = new VideoCacheService();
