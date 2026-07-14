import { supabase } from './supabase';

interface VideoRecommendation {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  creatorName: string;
  userId: string;
  playCount: number;
  duration: number;
  createdAt: string;
  score: number;
}

interface RecommendationFactors {
  sameCreator: number;
  genreSimilarity: number;
  popularity: number;
  recency: number;
  engagementRate: number;
}

class VideoRecommendationService {
  private readonly WEIGHTS: RecommendationFactors = {
    sameCreator: 0.30,
    genreSimilarity: 0.25,
    popularity: 0.20,
    recency: 0.15,
    engagementRate: 0.10,
  };

  private readonly CACHE_DURATION = 5 * 60 * 1000;
  private cache: Map<string, { data: VideoRecommendation[]; timestamp: number }> = new Map();

  async getRecommendations(
    currentVideoId: string,
    creatorId: string,
    userId: string | null,
    limit: number = 6
  ): Promise<VideoRecommendation[]> {
    const cacheKey = `${currentVideoId}_${userId || 'anon'}`;

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.data.slice(0, limit);
    }

    try {
      const [
        currentVideo,
        watchHistory,
        userLikes,
        creatorVideos,
        similarVideos,
        trendingVideos,
      ] = await Promise.all([
        this.getCurrentVideoDetails(currentVideoId),
        this.getUserWatchHistory(userId),
        this.getUserLikes(userId),
        this.getCreatorVideos(creatorId, currentVideoId, limit),
        this.getSimilarVideos(currentVideoId, limit),
        this.getTrendingVideos(currentVideoId, limit),
      ]);

      const watchedIds = new Set([currentVideoId, ...watchHistory]);
      const likedIds = new Set(userLikes);

      const candidates = this.deduplicateVideos([
        ...creatorVideos,
        ...similarVideos,
        ...trendingVideos,
      ]);

      const scoredVideos = candidates
        .filter((video) => !watchedIds.has(video.id))
        .map((video) => ({
          ...video,
          score: this.calculateScore(video, currentVideo, creatorId, likedIds),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit * 2);

      const diversified = this.diversifyRecommendations(scoredVideos, limit);

      this.cache.set(cacheKey, {
        data: diversified,
        timestamp: Date.now(),
      });

      return diversified.slice(0, limit);
    } catch (error) {
      console.error('Error generating recommendations:', error);
      return this.getFallbackRecommendations(currentVideoId, limit);
    }
  }

  private async getCurrentVideoDetails(videoId: string): Promise<any> {
    const { data, error } = await supabase
      .from('content_uploads')
      .select(`
        id,
        genre_id,
        play_count,
        created_at,
        user_id
      `)
      .eq('id', videoId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  private async getUserWatchHistory(userId: string | null): Promise<string[]> {
    if (!userId) return [];

    const { data } = await supabase
      .from('video_playback_history')
      .select('content_id')
      .eq('user_id', userId)
      .order('watched_at', { ascending: false })
      .limit(100);

    return data?.map((row) => row.content_id).filter(Boolean) || [];
  }

  private async getUserLikes(userId: string | null): Promise<string[]> {
    if (!userId) return [];

    const { data } = await supabase
      .from('content_likes')
      .select('content_id')
      .eq('user_id', userId)
      .eq('content_type', 'video');

    return data?.map((row) => row.content_id).filter(Boolean) || [];
  }

  private async getCreatorVideos(
    creatorId: string,
    excludeId: string,
    limit: number
  ): Promise<any[]> {
    const { data } = await supabase
      .from('content_uploads')
      .select(`
        id,
        title,
        metadata,
        play_count,
        created_at,
        user_id,
        genre_id,
        users!user_id (
          display_name
        )
      `)
      .in('content_type', ['video', 'short_clip'])
      .eq('status', 'approved')
      .eq('user_id', creatorId)
      .neq('id', excludeId)
      .order('play_count', { ascending: false })
      .limit(limit);

    return this.formatVideos(data || []);
  }

  private async getSimilarVideos(
    currentVideoId: string,
    limit: number
  ): Promise<any[]> {
    const currentVideo = await this.getCurrentVideoDetails(currentVideoId);
    if (!currentVideo?.genre_id) return [];

    const { data } = await supabase
      .from('content_uploads')
      .select(`
        id,
        title,
        metadata,
        play_count,
        created_at,
        user_id,
        genre_id,
        users!user_id (
          display_name
        )
      `)
      .in('content_type', ['video', 'short_clip'])
      .eq('status', 'approved')
      .eq('genre_id', currentVideo.genre_id)
      .neq('id', currentVideoId)
      .neq('user_id', currentVideo.user_id)
      .gte('play_count', 10)
      .order('play_count', { ascending: false })
      .limit(limit);

    return this.formatVideos(data || []);
  }

  private async getTrendingVideos(
    excludeId: string,
    limit: number
  ): Promise<any[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data } = await supabase
      .from('content_uploads')
      .select(`
        id,
        title,
        metadata,
        play_count,
        created_at,
        user_id,
        genre_id,
        users!user_id (
          display_name
        )
      `)
      .in('content_type', ['video', 'short_clip'])
      .eq('status', 'approved')
      .neq('id', excludeId)
      .gte('created_at', sevenDaysAgo.toISOString())
      .gte('play_count', 50)
      .order('play_count', { ascending: false })
      .limit(limit);

    return this.formatVideos(data || []);
  }

  private formatVideos(videos: any[]): any[] {
    return videos.map((video) => {
      const userData = Array.isArray(video.users) ? video.users[0] : video.users;
      return {
        id: video.id,
        title: video.title,
        thumbnailUrl: video.metadata?.thumbnail_url || null,
        creatorName: userData?.display_name || 'Unknown Creator',
        userId: video.user_id,
        playCount: video.play_count || 0,
        duration: video.metadata?.duration_seconds || 0,
        createdAt: video.created_at,
        genreId: video.genre_id,
      };
    });
  }

  private calculateScore(
    video: any,
    currentVideo: any,
    currentCreatorId: string,
    likedIds: Set<string>
  ): number {
    let score = 0;

    const sameCreatorScore = video.userId === currentCreatorId ? 1 : 0;
    score += sameCreatorScore * this.WEIGHTS.sameCreator;

    const genreScore =
      video.genreId && video.genreId === currentVideo?.genre_id ? 1 : 0;
    score += genreScore * this.WEIGHTS.genreSimilarity;

    const normalizedPlayCount = Math.min(video.playCount / 10000, 1);
    score += normalizedPlayCount * this.WEIGHTS.popularity;

    const ageInDays = Math.max(
      0,
      (Date.now() - new Date(video.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    const recencyScore = Math.max(0, 1 - ageInDays / 30);
    score += recencyScore * this.WEIGHTS.recency;

    const engagementRate = video.playCount > 0 ? Math.min(video.playCount / 1000, 1) : 0;
    score += engagementRate * this.WEIGHTS.engagementRate;

    if (likedIds.has(video.userId)) {
      score += 0.1;
    }

    return score;
  }

  private deduplicateVideos(videos: any[]): any[] {
    const seen = new Map<string, any>();

    for (const video of videos) {
      if (!seen.has(video.id)) {
        seen.set(video.id, video);
      }
    }

    return Array.from(seen.values());
  }

  private diversifyRecommendations(
    videos: VideoRecommendation[],
    limit: number
  ): VideoRecommendation[] {
    const result: VideoRecommendation[] = [];
    const seenCreators = new Set<string>();
    const seenGenres = new Set<string>();

    for (const video of videos) {
      if (result.length >= limit) break;

      const creatorCount = Array.from(result).filter(
        (v) => v.userId === video.userId
      ).length;

      if (creatorCount < 2) {
        result.push(video);
        seenCreators.add(video.userId);
        if ((video as any).genreId) {
          seenGenres.add((video as any).genreId);
        }
      }
    }

    const remaining = videos.filter((v) => !result.some((r) => r.id === v.id));
    while (result.length < limit && remaining.length > 0) {
      result.push(remaining.shift()!);
    }

    return result;
  }

  private async getFallbackRecommendations(
    excludeId: string,
    limit: number
  ): Promise<VideoRecommendation[]> {
    try {
      const { data } = await supabase
        .from('content_uploads')
        .select(`
          id,
          title,
          metadata,
          play_count,
          created_at,
          user_id,
          users!user_id (
            display_name
          )
        `)
        .in('content_type', ['video', 'short_clip'])
        .eq('status', 'approved')
        .neq('id', excludeId)
        .order('play_count', { ascending: false })
        .limit(limit);

      return this.formatVideos(data || []).map((video) => ({
        ...video,
        score: 0,
      }));
    } catch (error) {
      console.error('Error fetching fallback recommendations:', error);
      return [];
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  clearCacheForVideo(videoId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(videoId)) {
        this.cache.delete(key);
      }
    }
  }
}

export const videoRecommendationService = new VideoRecommendationService();
