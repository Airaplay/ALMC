import { supabase } from './supabase';
import { persistentCache } from './persistentCache';
import { backgroundPrefetcher } from './backgroundPrefetch';

export interface HomeScreenData {
  trendingSongs: any[];
  newReleases: any[];
  trendingAlbums: any[];
  mustWatch: any[];
  loops: any[];
  topArtists: any[];
  mixForYou: any[];
  promotedContent: any[];
  banners: any[];
}

export const fetchOptimizedHomeScreen = async (): Promise<HomeScreenData> => {
  const cacheKey = 'optimized-home-screen';

  const cached = await persistentCache.get<HomeScreenData>(cacheKey);
  if (cached) {
    // No background refresh - components load their own data
    return cached;
  }

  const data = await fetchFreshHomeScreenData();
  await persistentCache.set(cacheKey, data, 10 * 60 * 1000); // Increased to 10 minutes

  return data;
};

fetchOptimizedHomeScreen.refreshInBackground = async () => {
  // Disabled - reduces network overhead and aggressive prefetching
};

const fetchFreshHomeScreenData = async (): Promise<HomeScreenData> => {
  // Individual sections load their own data, so this function returns empty data
  // to prevent errors from non-existent tables/columns during background prefetch
  return {
    trendingSongs: [],
    newReleases: [],
    trendingAlbums: [],
    mustWatch: [],
    loops: [],
    topArtists: [],
    mixForYou: [],
    promotedContent: [],
    banners: [],
  };
};

export const fetchOptimizedProfile = async (userId: string): Promise<any> => {
  const cacheKey = `optimized-profile-${userId}`;

  const cached = await persistentCache.get(cacheKey);
  if (cached) {
    // No background refresh - profile loads on demand
    return cached;
  }

  const data = await fetchFreshProfileData(userId);
  await persistentCache.set(cacheKey, data, 15 * 60 * 1000); // Increased to 15 minutes

  return data;
};

fetchOptimizedProfile.refreshInBackground = async (userId: string) => {
  // Disabled - reduces network overhead
};

const fetchFreshProfileData = async (userId: string): Promise<any> => {
  const [profile, songs, videos, albums, stats] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
      .then(res => res.data),

    supabase
      .from('songs')
      .select('id, title, cover_image_url, audio_url, duration_seconds, play_count, created_at, featured_artists')
      .eq('artist_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(res => res.data || []),

    supabase
      .from('content_uploads')
      .select('id, title, metadata, play_count, created_at')
      .eq('user_id', userId)
      .in('content_type', ['video', 'short_clip'])
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(res => {
        return (res.data || []).map((item: any) => ({
          id: item.id,
          title: item.title,
          thumbnail_url: item.metadata?.thumbnail_url,
          total_plays: item.play_count || 0,
          total_likes: 0,
          created_at: item.created_at
        }));
      }),

    supabase
      .from('albums')
      .select('id, title, cover_image, total_plays, created_at')
      .eq('artist_id', userId)
      .eq('is_approved', true)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(res => res.data || []),

    supabase
      .from('profiles')
      .select('total_plays, total_earnings, follower_count')
      .eq('id', userId)
      .single()
      .then(res => res.data),
  ]);

  return { profile, songs, videos, albums, stats };
};

export const fetchOptimizedVideo = async (videoId: string): Promise<any> => {
  console.log('[fetchOptimizedVideo] Called with videoId:', videoId);
  const cacheKey = `optimized-video-${videoId}`;

  const cached = await persistentCache.get(cacheKey);
  if (cached) {
    console.log('[fetchOptimizedVideo] Returning cached data');
    fetchOptimizedVideo.refreshInBackground(videoId);
    return cached;
  }

  console.log('[fetchOptimizedVideo] No cache, fetching fresh data');
  const data = await fetchFreshVideoData(videoId);
  // Cache for 2 minutes to ensure follower counts stay relatively fresh
  await persistentCache.set(cacheKey, data, 2 * 60 * 1000);

  backgroundPrefetcher.prefetchVideoData(videoId);

  return data;
};

fetchOptimizedVideo.refreshInBackground = async (videoId: string) => {
  setTimeout(async () => {
    try {
      const data = await fetchFreshVideoData(videoId);
      // Cache for 2 minutes to ensure follower counts stay relatively fresh
      await persistentCache.set(`optimized-video-${videoId}`, data, 2 * 60 * 1000);
    } catch (error) {
      console.error('Background refresh failed:', error);
    }
  }, 100);
};

const fetchFreshVideoData = async (videoId: string): Promise<any> => {
  console.log('[fetchFreshVideoData] Fetching video:', videoId);

  const { data: videoData, error: videoError } = await supabase
    .from('content_uploads')
    .select(`
      id,
      title,
      description,
      metadata,
      play_count,
      created_at,
      user_id,
      users!inner (
        id,
        display_name,
        avatar_url
      )
    `)
    .eq('id', videoId)
    .in('content_type', ['video', 'short_clip'])
    .single();

  if (videoError) {
    console.error('[fetchFreshVideoData] Error fetching video:', videoError);
    throw new Error(videoError.message || 'Video not found');
  }

  if (!videoData) {
    console.error('[fetchFreshVideoData] No video data returned for ID:', videoId);
    throw new Error('Video not found');
  }

  console.log('[fetchFreshVideoData] Video data fetched successfully:', {
    id: videoData.id,
    title: videoData.title,
    hasVideoUrl: !!videoData.metadata?.video_url,
    hasVideoGuid: !!videoData.metadata?.video_guid,
    videoUrl: videoData.metadata?.video_url,
    videoGuid: videoData.metadata?.video_guid,
    hasMetadata: !!videoData.metadata
  });

  const userData = videoData.users as any;

  // Get follower count using correct parameter name
  console.log('[fetchFreshVideoData] Fetching follower count for user:', videoData.user_id);
  const { data: followerData, error: followerError } = await supabase
    .rpc('get_follower_count', { user_uuid: videoData.user_id });

  if (followerError) {
    console.error('[fetchFreshVideoData] Error fetching follower count:', followerError);
  }

  const followerCount = followerData || 0;
  console.log('[fetchFreshVideoData] Follower count result:', followerCount);

  // Extract video URL with priority: video_url (Bunny) > file_url (fallback)
  const videoUrl = videoData.metadata?.video_url || videoData.metadata?.file_url;

  // Validate the video URL
  if (!videoUrl) {
    console.error('[fetchFreshVideoData] ❌ VIDEO URL MISSING:', {
      videoId: videoData.id,
      title: videoData.title,
      metadata: videoData.metadata
    });
    throw new Error(`Video playback unavailable: Missing video URL for video ${videoData.id}`);
  }

  if (!videoUrl.startsWith('https://')) {
    console.error('[fetchFreshVideoData] ❌ INVALID URL PROTOCOL:', videoUrl);
    throw new Error(`Invalid video URL protocol: ${videoUrl}`);
  }

  const video = {
    id: videoData.id,
    title: videoData.title,
    description: videoData.description,
    videoUrl: videoUrl,
    thumbnailUrl: videoData.metadata?.thumbnail_url,
    playCount: videoData.play_count || 0,
    createdAt: videoData.created_at,
    creator: {
      id: videoData.user_id,
      name: userData?.display_name || 'Unknown Creator',
      avatar: userData?.avatar_url,
      followerCount
    }
  };

  console.log('[fetchFreshVideoData] ✅ Video object created:', {
    id: video.id,
    title: video.title,
    videoUrl: video.videoUrl,
    hasThumbnail: !!video.thumbnailUrl
  });

  const { data: relatedData } = await supabase
    .from('content_uploads')
    .select(`
      id,
      title,
      metadata,
      play_count,
      user_id,
      users!inner (
        display_name
      )
    `)
    .eq('user_id', videoData.user_id)
    .neq('id', videoId)
    .in('content_type', ['video', 'short_clip'])
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(10);

  const relatedVideos = (relatedData || []).map((item: any) => ({
    id: item.id,
    title: item.title,
    thumbnailUrl: item.metadata?.thumbnail_url,
    creatorName: item.users?.display_name || 'Unknown',
    userId: item.user_id,
    playCount: item.play_count || 0,
    duration: item.metadata?.duration_seconds || 0,
  }));

  console.log('[fetchFreshVideoData] Returning video data:', {
    hasVideo: !!video,
    videoId: video.id,
    videoUrl: video.videoUrl,
    relatedCount: relatedVideos.length
  });

  return { video, relatedVideos };
};

export const prefetchNextScreens = () => {
  backgroundPrefetcher.processPriorityPrefetch();
};

export const clearOptimizedCache = async () => {
  await persistentCache.clear();
};
