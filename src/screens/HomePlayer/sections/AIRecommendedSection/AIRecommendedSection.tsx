import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "../../../../components/ui/card";
import { ScrollArea, ScrollBar } from "../../../../components/ui/scroll-area";
import { Clock, Music, Video, Zap, RefreshCw, Flame } from "lucide-react";
import { LazyImage } from "../../../../components/LazyImage";
import { supabase } from "../../../../lib/supabase";
import { useAuth } from "../../../../contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { getPromotedContentForSection, recordPromotedContentClick } from "../../../../lib/promotionHelper";
import { persistentCache } from "../../../../lib/persistentCache";
import { useEngagementSync } from "../../../../hooks/useEngagementSync";

const blinkStyle = `
  @keyframes lightBlink {
    0%, 49% {
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
    }
    50%, 100% {
      box-shadow: 0 10px 25px -5px rgba(255, 255, 255, 0.15);
    }
  }

  .blink-effect {
    animation: lightBlink 0.6s ease-out;
  }
`;

if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = blinkStyle;
  document.head.appendChild(style);
}

// Define types for time-based data structures
type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
type ContentType = 'music' | 'video' | 'short_clip';

interface TimeOfDayScores {
  morning: number;
  afternoon: number;
  evening: number;
  night: number;
}

interface TimeOfDayReasons {
  morning: string;
  afternoon: string;
  evening: string;
  night: string;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  videoUrl?: string | null;
  duration?: number;
  playCount?: number;
  featuredArtists?: string[] | null;
}

interface AIRecommendedContent {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  contentType: 'music' | 'video' | 'short_clip';
  coverImageUrl: string | null;
  thumbnailUrl?: string | null;
  audioUrl?: string | null;
  videoUrl?: string | null;
  duration: number;
  playCount: number;
  recommendationScore: number;
  recommendationReason: string;
  isPromoted?: boolean;
}

interface AIRecommendedSectionProps {
  onOpenMusicPlayer: (song: Song) => void;
}

const CACHE_KEY = 'ai_recommended_section';

export const AIRecommendedSection = ({ onOpenMusicPlayer }: AIRecommendedSectionProps): JSX.Element => {
  const navigate = useNavigate();
  const { user, isAuthenticated, isInitialized } = useAuth();
  const [recommendations, setRecommendations] = useState<AIRecommendedContent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeBlink, setActiveBlink] = useState<string | null>(null);
  const isInitialMount = useRef(true);

  // Real-time engagement sync
  useEngagementSync(useCallback((update) => {
    if (update.metric === 'play_count') {
      setRecommendations(prevRecs =>
        prevRecs.map(rec =>
          rec.id === update.contentId &&
          ((update.contentType === 'song' && rec.contentType === 'music') ||
           (update.contentType === 'video' && rec.contentType === 'video'))
            ? { ...rec, playCount: update.value }
            : rec
        )
      );
    }
  }, []));

  // Initialize timeOfDay from localStorage or default to morning
  const [timeOfDay, setTimeOfDay] = useState<'morning' | 'afternoon' | 'evening' | 'night'>(() => {
    try {
      const cached = localStorage.getItem('ai_recommended_time_of_day') as TimeOfDay;
      if (cached && ['morning', 'afternoon', 'evening', 'night'].includes(cached)) {
        console.log('[AIRecommended] Initializing with cached time of day:', cached);
        return cached;
      }
    } catch (error) {
      console.log('[AIRecommended] Failed to load cached time of day');
    }
    return 'morning';
  });

  // Load cached recommendations on mount
  useEffect(() => {
    const loadCached = async () => {
      if (isInitialMount.current) {
        const cached = await persistentCache.get<AIRecommendedContent[]>(CACHE_KEY);
        if (cached && cached.length > 0) {
          setRecommendations(cached);
          setIsLoading(false);
        }
        isInitialMount.current = false;
      }
    };

    loadCached();
  }, []);

  useEffect(() => {
    updateTimeOfDay();
  }, []);

  useEffect(() => {
    // Fetch recommendations whenever time of day changes or auth state changes
    if (timeOfDay && isInitialized) {
      fetchRecommendationsData();
    }
  }, [timeOfDay, isInitialized, isAuthenticated, user]);

  useEffect(() => {
    // Set up auto-refresh every 3 hours (180 minutes)
    const refreshInterval = setInterval(() => {
      console.log('[AIRecommended] Auto-refreshing recommendations (3-hour cycle)');
      updateTimeOfDay();
    }, 3 * 60 * 60 * 1000);

    // Also check time of day every 30 minutes to catch transitions
    const timeCheckInterval = setInterval(() => {
      console.log('[AIRecommended] Checking for time of day transition');
      updateTimeOfDay();
    }, 30 * 60 * 1000);

    // Cleanup intervals on component unmount
    return () => {
      clearInterval(refreshInterval);
      clearInterval(timeCheckInterval);
    };
  }, []);

  const updateTimeOfDay = () => {
    try {
      // Get device local time (no server time, no IP detection needed)
      const now = new Date();
      const currentHour = now.getHours();

      // Determine time of day based on user's device local time
      // Morning: 5:00 – 11:59
      // Afternoon: 12:00 – 16:59
      // Evening: 17:00 – 21:59
      // Night: 22:00 – 4:59
      let newTimeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';

      if (currentHour >= 5 && currentHour < 12) {
        newTimeOfDay = 'morning';
      } else if (currentHour >= 12 && currentHour < 17) {
        newTimeOfDay = 'afternoon';
      } else if (currentHour >= 17 && currentHour < 22) {
        newTimeOfDay = 'evening';
      } else {
        newTimeOfDay = 'night';
      }

      console.log(`[AIRecommended] Device local time: ${currentHour}:00, Time of day: ${newTimeOfDay}`);

      // Store in localStorage for offline persistence
      localStorage.setItem('ai_recommended_time_of_day', newTimeOfDay);
      localStorage.setItem('ai_recommended_last_update', now.toISOString());

      setTimeOfDay(newTimeOfDay);
    } catch (error) {
      console.error('Error determining time of day:', error);
      // Try to get cached value from localStorage
      const cachedTimeOfDay = localStorage.getItem('ai_recommended_time_of_day') as TimeOfDay;
      if (cachedTimeOfDay) {
        console.log('[AIRecommended] Using cached time of day:', cachedTimeOfDay);
        setTimeOfDay(cachedTimeOfDay);
      } else {
        // Fallback to morning if error and no cache
        setTimeOfDay('morning');
      }
    }
  };


  const fetchRecommendationsData = async () => {
    try {
      if (isAuthenticated && user) {
        await fetchPersonalizedRecommendations(user.id);
      } else {
        await fetchGeneralRecommendations();
      }
    } catch (err) {
      console.error("[AIRecommended] Error fetching recommendations:", err);
      setError("Failed to load recommendations");
      setIsLoading(false);
    }
  };

  const fetchPersonalizedRecommendations = async (userId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // Get user's artist profile to exclude their own content
      const { data: userArtistProfile } = await supabase
        .from('artist_profiles')
        .select('artist_id')
        .eq('user_id', userId)
        .maybeSingle();

      const userArtistId = userArtistProfile?.artist_id;

      // Get user's location/country for location-based recommendations
      const { data: userProfile } = await supabase
        .from('users')
        .select('country')
        .eq('id', userId)
        .maybeSingle();

      const userCountry = userProfile?.country;

      // Get promoted content IDs for AI Recommended section
      const promotedSongIds = await getPromotedContentForSection('ai_recommended', 'song');
      const promotedVideoIds = await getPromotedContentForSection('ai_recommended', 'video');
      const promotedClipIds = await getPromotedContentForSection('ai_recommended', 'short_clip');

      // Get user's listening history for personalization
      const { data: listeningHistory, error: historyError } = await supabase
        .from('listening_history')
        .select(`
          song_id,
          content_upload_id,
          duration_listened,
          listened_at,
          songs:song_id (
            artist_id
          )
        `)
        .eq('user_id', userId)
        .order('listened_at', { ascending: false })
        .limit(100);

      if (historyError) throw historyError;

      // Get user's favorites
      const { data: favorites, error: favoritesError } = await supabase
        .from('user_favorites')
        .select('song_id')
        .eq('user_id', userId);

      if (favoritesError) throw favoritesError;

      // Get user's liked clips
      const { data: likedClips, error: likedClipsError } = await supabase
        .from('clip_likes')
        .select('clip_id')
        .eq('user_id', userId);

      if (likedClipsError) throw likedClipsError;

      // Get user's video playback history to exclude watched videos
      const { data: videoHistory, error: videoHistoryError } = await supabase
        .from('video_playback_history')
        .select('content_id')
        .eq('user_id', userId);

      if (videoHistoryError) {
        console.warn('[AIRecommended] Could not fetch video history:', videoHistoryError);
      }

      // Extract song IDs and content IDs from history
      const songIds = listeningHistory?.filter(h => h.song_id).map(h => h.song_id) || [];
      const contentIds = listeningHistory?.filter(h => h.content_upload_id).map(h => h.content_upload_id) || [];
      const favoriteSongIds = favorites?.map(f => f.song_id) || [];
      const likedClipIds = likedClips?.map(l => l.clip_id) || [];
      const watchedVideoIds = videoHistory?.map(v => v.content_id) || [];

      console.log('[AIRecommended] Excluding from recommendations:', {
        songsListened: songIds.length,
        videosWatched: watchedVideoIds.length,
        contentWatched: contentIds.length,
        favorites: favoriteSongIds.length,
        likedClips: likedClipIds.length
      });

      // Analyze user's artist preferences from listening history
      const artistFrequency = new Map<string, number>();

      listeningHistory?.forEach((entry: any) => {
        if (entry.songs?.artist_id) {
          artistFrequency.set(entry.songs.artist_id, (artistFrequency.get(entry.songs.artist_id) || 0) + 1);
        }
      });

      // Get top 5 preferred artists
      const preferredArtists = Array.from(artistFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([artistId]) => artistId);

      console.log('[AIRecommended] User preferences - Country:', userCountry, 'Artists:', preferredArtists.length);

      // Fetch promoted songs separately to ensure they are included
      let promotedSongsData: AIRecommendedContent[] = [];
      if (promotedSongIds.length > 0) {
        let promotedSongsQuery = supabase
          .from('songs')
          .select(`
            id,
            title,
            duration_seconds,
            audio_url,
            cover_image_url,
            play_count,
            artist_id,
            country,
            artists:artist_id (
              id,
              name,
              artist_profiles(user_id)
            )
          `)
          .in('id', promotedSongIds)
          .not('audio_url', 'is', null);

        // Exclude current user's own content from promotions
        if (userArtistId) {
          promotedSongsQuery = promotedSongsQuery.not('artist_id', 'eq', userArtistId);
        }

        const { data: promotedData } = await promotedSongsQuery;

        if (promotedData) {
          // Filter out already listened songs from promoted content
          const excludedSongIds = new Set([...songIds, ...favoriteSongIds]);
          const filteredPromotedSongs = promotedData.filter((song: any) =>
            song.id && !excludedSongIds.has(song.id)
          );

          console.log('[AIRecommended] Promoted songs filtered:', {
            total: promotedData.length,
            excluded: promotedData.length - filteredPromotedSongs.length,
            remaining: filteredPromotedSongs.length
          });

          promotedSongsData = filteredPromotedSongs.map((song: any) => ({
            id: song.id,
            title: song.title,
            artist: song.artists?.name || 'Unknown Artist',
            artistId: song.artists?.artist_profiles?.[0]?.user_id || null,
            contentType: 'music' as const,
            coverImageUrl: song.cover_image_url,
            audioUrl: song.audio_url,
            duration: song.duration_seconds || 0,
            playCount: song.play_count || 0,
            recommendationScore: calculateRecommendationScore(
              song,
              timeOfDay,
              'music',
              { userCountry, preferredArtists }
            ) + 20, // Boost score for promoted
            recommendationReason: getRecommendationReason('music', timeOfDay),
            isPromoted: true
          }));
        }
      }

      // Fetch recommended songs based on listening history and favorites
      let recommendedSongs: AIRecommendedContent[] = [];

      // Build smart query: prioritize preferred genres and local content
      let songsQuery = supabase
        .from('songs')
        .select(`
          id,
          title,
          duration_seconds,
          audio_url,
          cover_image_url,
          play_count,
          artist_id,
          country,
          artists:artist_id (
            id,
            name,
            artist_profiles(user_id)
          )
        `)
        .not('audio_url', 'is', null)
        .order('play_count', { ascending: false });

      // Exclude current user's own content
      if (userArtistId) {
        songsQuery = songsQuery.not('artist_id', 'eq', userArtistId);
      }

      const { data: songsData, error: songsError } = await songsQuery.limit(50);

      if (!songsError && songsData) {
        // Filter out already listened songs and favorites - ensure nothing repeats
        const excludedSongIds = new Set([...songIds, ...favoriteSongIds]);
        const filteredSongs = songsData.filter((song: any) =>
          song.id && !excludedSongIds.has(song.id)
        );

        console.log('[AIRecommended] Songs filtered:', {
          total: songsData.length,
          excluded: excludedSongIds.size,
          remaining: filteredSongs.length
        });

        recommendedSongs = filteredSongs.map((song: any) => ({
          id: song.id,
          title: song.title,
          artist: song.artists?.name || 'Unknown Artist',
          artistId: song.artists?.artist_profiles?.[0]?.user_id || null,
          contentType: 'music' as const,
          coverImageUrl: song.cover_image_url,
          audioUrl: song.audio_url,
          duration: song.duration_seconds || 0,
          playCount: song.play_count || 0,
          recommendationScore: calculateRecommendationScore(
            song,
            timeOfDay,
            'music',
            { userCountry, preferredArtists }
          ),
          recommendationReason: getRecommendationReason('music', timeOfDay),
          isPromoted: promotedSongIds.includes(song.id)
        }))
        .sort((a, b) => b.recommendationScore - a.recommendationScore)
        .slice(0, 15);
      }

      // Fetch promoted videos/clips separately to ensure they are included
      let promotedVideosData: AIRecommendedContent[] = [];
      const allPromotedVideoIds = [...promotedVideoIds, ...promotedClipIds];
      if (allPromotedVideoIds.length > 0) {
        let promotedVideosQuery = supabase
          .from('content_uploads')
          .select(`
            id,
            title,
            content_type,
            metadata,
            play_count,
            user_id,
            users:user_id (
              display_name,
              avatar_url
            )
          `)
          .in('id', allPromotedVideoIds)
          .in('content_type', ['video', 'short_clip'])
          .eq('status', 'approved');

        // Exclude current user's own content from promotions
        if (userId) {
          promotedVideosQuery = promotedVideosQuery.not('user_id', 'eq', userId);
        }

        const { data: promotedData } = await promotedVideosQuery;

        if (promotedData) {
          // Filter out already watched videos from promoted content
          const excludedVideoIds = new Set([
            ...contentIds,
            ...watchedVideoIds,
            ...likedClipIds
          ]);
          const filteredPromotedVideos = promotedData.filter((video: any) =>
            video.id && !excludedVideoIds.has(video.id)
          );

          console.log('[AIRecommended] Promoted videos filtered:', {
            total: promotedData.length,
            excluded: promotedData.length - filteredPromotedVideos.length,
            remaining: filteredPromotedVideos.length
          });

          promotedVideosData = filteredPromotedVideos.map((video: any) => ({
            id: video.id,
            title: video.title,
            artist: video.users?.display_name || 'Unknown Creator',
            artistId: video.user_id,
            contentType: video.content_type === 'short_clip' ? 'short_clip' as const : 'video' as const,
            coverImageUrl: null,
            thumbnailUrl: video.metadata?.thumbnail_url || video.metadata?.cover_url,
            videoUrl: video.metadata?.video_url || video.metadata?.file_url,
            duration: video.metadata?.duration_seconds || 0,
            playCount: video.play_count || 0,
            recommendationScore: calculateRecommendationScore(
              video,
              timeOfDay,
              video.content_type,
              { userCountry, preferredArtists }
            ) + 20, // Boost score for promoted
            recommendationReason: getRecommendationReason(video.content_type as ContentType, timeOfDay as TimeOfDay),
            isPromoted: true
          }));
        }
      }

      // Fetch recommended videos/clips
      let recommendedVideos: AIRecommendedContent[] = [];
      let videosQuery = supabase
        .from('content_uploads')
        .select(`
          id,
          title,
          content_type,
          metadata,
          play_count,
          user_id,
          users:user_id (
            display_name,
            avatar_url
          )
        `)
        .in('content_type', ['video', 'short_clip'])
        .eq('status', 'approved')
        .order('play_count', { ascending: false });

      // Exclude current user's own content
      if (userId) {
        videosQuery = videosQuery.not('user_id', 'eq', userId);
      }

      const { data: videosData, error: videosError } = await videosQuery.limit(20);

      if (!videosError && videosData) {
        // Filter out all watched videos and clips - ensure nothing repeats
        const excludedVideoIds = new Set([
          ...contentIds,           // Videos from listening history (content_uploads)
          ...watchedVideoIds,      // Videos from video_playback_history
          ...likedClipIds          // Liked clips
        ]);
        const filteredVideos = videosData.filter((video: any) =>
          video.id && !excludedVideoIds.has(video.id)
        );

        console.log('[AIRecommended] Videos filtered:', {
          total: videosData.length,
          excluded: excludedVideoIds.size,
          remaining: filteredVideos.length
        });

        recommendedVideos = filteredVideos.map((video: any) => ({
          id: video.id,
          title: video.title,
          artist: video.users?.display_name || 'Unknown Creator',
          artistId: video.user_id,
          contentType: video.content_type === 'short_clip' ? 'short_clip' as const : 'video' as const,
          coverImageUrl: null,
          thumbnailUrl: video.metadata?.thumbnail_url || video.metadata?.cover_url,
          videoUrl: video.metadata?.video_url || video.metadata?.file_url,
          duration: video.metadata?.duration_seconds || 0,
          playCount: video.play_count || 0,
          recommendationScore: calculateRecommendationScore(
            video,
            timeOfDay,
            video.content_type,
            { userCountry, preferredArtists }
          ),
          recommendationReason: getRecommendationReason(video.content_type as ContentType, timeOfDay as TimeOfDay),
          isPromoted: allPromotedVideoIds.includes(video.id)
        }))
        .sort((a, b) => b.recommendationScore - a.recommendationScore)
        .slice(0, 10);
      }

      // Combine all content (promoted + regular), filtering out duplicates
      const allPromotedContent = [...promotedSongsData, ...promotedVideosData];
      const promotedIds = new Set(allPromotedContent.map(p => p.id));

      // Create master exclusion list - everything user has interacted with
      const masterExclusionSet = new Set([
        ...songIds,
        ...favoriteSongIds,
        ...contentIds,
        ...watchedVideoIds,
        ...likedClipIds
      ]);

      // Remove any regular content that is also promoted or already watched/listened
      const allRegularContent = [...recommendedSongs, ...recommendedVideos].filter(
        item => !promotedIds.has(item.id) && !masterExclusionSet.has(item.id)
      );

      // Promoted content should ALWAYS show (even if user has seen it before)
      // That's the whole point of promotion - paid advertising for maximum exposure
      const safePromotedContent = allPromotedContent;

      console.log('[AIRecommended] Final content filtering:', {
        promotedContent: allPromotedContent.length,
        regularBeforeFilter: recommendedSongs.length + recommendedVideos.length,
        regularAfterFilter: allRegularContent.length
      });

      // Filter to ensure only ONE content per artist
      const seenArtists = new Set<string>();
      const diverseContent: AIRecommendedContent[] = [];

      for (const content of allRegularContent) {
        const artistKey = content.artistId || content.artist;
        if (!seenArtists.has(artistKey)) {
          diverseContent.push(content);
          seenArtists.add(artistKey);
        }
      }

      // Sort regular content by recommendation score
      const sortedRegularContent = diverseContent
        .sort((a, b) => b.recommendationScore - a.recommendationScore)
        .slice(0, 20);

      let finalRecommendations: AIRecommendedContent[];

      // ONLY ONE PROMOTION PER CYCLE - place it randomly at position 1, 2, or 3
      if (safePromotedContent.length > 0) {
        // Take only the first promoted content (one per cycle) that user hasn't seen
        const singlePromotedContent = safePromotedContent[0];

        // Randomly choose position 0, 1, or 2 (displayed as 1st, 2nd, or 3rd card)
        const randomPosition = Math.floor(Math.random() * 3);

        console.log(`[AIRecommended] Placing promoted content at position ${randomPosition + 1}`);

        // Build final array with promotion at random position
        finalRecommendations = [];
        let regularIndex = 0;

        for (let i = 0; i < 20; i++) {
          if (i === randomPosition) {
            // Insert promoted content at this position
            finalRecommendations.push(singlePromotedContent);
          } else if (regularIndex < sortedRegularContent.length) {
            // Fill with regular content
            finalRecommendations.push(sortedRegularContent[regularIndex]);
            regularIndex++;
          }
        }
      } else {
        // No promotions, just use regular content
        finalRecommendations = sortedRegularContent;
      }

      setRecommendations(finalRecommendations);
      // Cache recommendations for 15 minutes
      await persistentCache.set(CACHE_KEY, finalRecommendations, 15 * 60 * 1000);
    } catch (err) {
      console.error("Error fetching personalized recommendations:", err);
      await fetchGeneralRecommendations();
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGeneralRecommendations = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get promoted content IDs for AI Recommended section
      const promotedSongIds = await getPromotedContentForSection('ai_recommended', 'song');
      const promotedVideoIds = await getPromotedContentForSection('ai_recommended', 'video');
      const promotedClipIds = await getPromotedContentForSection('ai_recommended', 'short_clip');

      // For non-authenticated users, show popular content based on time of day
      const timeBasedLimit = getTimeBasedContentPreference();

      const { data: popularSongs, error: songsError } = await supabase
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
            artist_profiles(
              id,
              user_id,
              stage_name,
              profile_photo_url,
              is_verified
            )
          )
        `)
        .not('audio_url', 'is', null)
        .order('play_count', { ascending: false })
        .limit(timeBasedLimit.music);

      if (songsError) throw songsError;

      const { data: popularVideos, error: videosError } = await supabase
        .from('content_uploads')
        .select(`
          id,
          title,
          content_type,
          metadata,
          play_count,
          user_id,
          users:user_id (
            display_name,
            avatar_url
          )
        `)
        .in('content_type', ['video', 'short_clip'])
        .eq('status', 'approved')
        .order('play_count', { ascending: false })
        .limit(timeBasedLimit.video);

      if (videosError) throw videosError;

      // Fetch promoted songs separately to ensure they are included
      let promotedSongsData: AIRecommendedContent[] = [];
      if (promotedSongIds.length > 0) {
        const { data: promotedData } = await supabase
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
              artist_profiles(
                id,
                user_id,
                stage_name,
                profile_photo_url,
                is_verified
              )
            )
          `)
          .in('id', promotedSongIds)
          .not('audio_url', 'is', null);

        if (promotedData) {
          promotedSongsData = promotedData.map((song: any) => ({
            id: song.id,
            title: song.title,
            artist: song.artists?.name || 'Unknown Artist',
            artistId: song.artists?.artist_profiles?.[0]?.user_id || null,
            contentType: 'music' as const,
            coverImageUrl: song.cover_image_url,
            audioUrl: song.audio_url,
            duration: song.duration_seconds || 0,
            playCount: song.play_count || 0,
            recommendationScore: calculateRecommendationScore(song, timeOfDay, 'music') + 20, // Boost score for promoted
            recommendationReason: getRecommendationReason('music', timeOfDay as TimeOfDay),
            isPromoted: true
          }));
        }
      }

      // Fetch promoted videos/clips separately to ensure they are included
      let promotedVideosData: AIRecommendedContent[] = [];
      const allPromotedVideoIds = [...promotedVideoIds, ...promotedClipIds];
      if (allPromotedVideoIds.length > 0) {
        const { data: promotedData } = await supabase
          .from('content_uploads')
          .select(`
            id,
            title,
            content_type,
            metadata,
            play_count,
            user_id,
            users:user_id (
              display_name,
              avatar_url
            )
          `)
          .in('id', allPromotedVideoIds)
          .in('content_type', ['video', 'short_clip'])
          .eq('status', 'approved');

        if (promotedData) {
          promotedVideosData = promotedData.map((video: any) => ({
            id: video.id,
            title: video.title,
            artist: video.users?.display_name || 'Unknown Creator',
            artistId: video.user_id,
            contentType: video.content_type === 'short_clip' ? 'short_clip' as const : 'video' as const,
            coverImageUrl: null,
            thumbnailUrl: video.metadata?.thumbnail_url || video.metadata?.cover_url,
            videoUrl: video.metadata?.video_url || video.metadata?.file_url,
            duration: video.metadata?.duration_seconds || 0,
            playCount: video.play_count || 0,
            recommendationScore: calculateRecommendationScore(video, timeOfDay, video.content_type) + 20, // Boost score for promoted
            recommendationReason: getRecommendationReason(video.content_type as ContentType, timeOfDay as TimeOfDay),
            isPromoted: true
          }));
        }
      }

      // Format songs (no user preferences for non-authenticated users)
      const formattedSongs: AIRecommendedContent[] = popularSongs?.map((song: any) => ({
        id: song.id,
        title: song.title,
        artist: song.artists?.name || 'Unknown Artist',
        artistId: song.artists?.artist_profiles?.[0]?.user_id || null,
        contentType: 'music' as const,
        coverImageUrl: song.cover_image_url,
        audioUrl: song.audio_url,
        duration: song.duration_seconds || 0,
        playCount: song.play_count || 0,
        recommendationScore: calculateRecommendationScore(song, timeOfDay, 'music'),
        recommendationReason: getRecommendationReason('music', timeOfDay as TimeOfDay),
        isPromoted: promotedSongIds.includes(song.id)
      })) || [];

      // Format videos (no user preferences for non-authenticated users)
      const formattedVideos: AIRecommendedContent[] = popularVideos?.map((video: any) => ({
        id: video.id,
        title: video.title,
        artist: video.users?.display_name || 'Unknown Creator',
        artistId: video.user_id,
        contentType: video.content_type === 'short_clip' ? 'short_clip' as const : 'video' as const,
        coverImageUrl: null,
        thumbnailUrl: video.metadata?.thumbnail_url || video.metadata?.cover_url,
        videoUrl: video.metadata?.video_url || video.metadata?.file_url,
        duration: video.metadata?.duration_seconds || 0,
        playCount: video.play_count || 0,
        recommendationScore: calculateRecommendationScore(video, timeOfDay, video.content_type),
        recommendationReason: getRecommendationReason(video.content_type as ContentType, timeOfDay as TimeOfDay),
        isPromoted: allPromotedVideoIds.includes(video.id)
      })) || [];

      // Combine all content (promoted + regular), filtering out duplicates
      const allPromotedContent = [...promotedSongsData, ...promotedVideosData];
      const promotedIds = new Set(allPromotedContent.map(p => p.id));

      // Remove any regular content that is also promoted (to avoid duplicates)
      const allRegularContent = [...formattedSongs, ...formattedVideos].filter(
        item => !promotedIds.has(item.id)
      );

      // Filter to ensure only ONE content per artist
      const seenArtists = new Set<string>();
      const diverseContent: AIRecommendedContent[] = [];

      for (const content of allRegularContent) {
        const artistKey = content.artistId || content.artist;
        if (!seenArtists.has(artistKey)) {
          diverseContent.push(content);
          seenArtists.add(artistKey);
        }
      }

      // Sort regular content by recommendation score
      const sortedRegularContent = diverseContent
        .sort((a, b) => b.recommendationScore - a.recommendationScore)
        .slice(0, 20);

      let finalRecommendations: AIRecommendedContent[];

      // ONLY ONE PROMOTION PER CYCLE - place it randomly at position 1, 2, or 3
      // For non-authenticated users, no history filtering needed
      if (allPromotedContent.length > 0) {
        // Take only the first promoted content (one per cycle)
        const singlePromotedContent = allPromotedContent[0];

        // Randomly choose position 0, 1, or 2 (displayed as 1st, 2nd, or 3rd card)
        const randomPosition = Math.floor(Math.random() * 3);

        console.log(`[AIRecommended] Placing promoted content at position ${randomPosition + 1}`);

        // Build final array with promotion at random position
        finalRecommendations = [];
        let regularIndex = 0;

        for (let i = 0; i < 20; i++) {
          if (i === randomPosition) {
            // Insert promoted content at this position
            finalRecommendations.push(singlePromotedContent);
          } else if (regularIndex < sortedRegularContent.length) {
            // Fill with regular content
            finalRecommendations.push(sortedRegularContent[regularIndex]);
            regularIndex++;
          }
        }
      } else {
        // No promotions, just use regular content
        finalRecommendations = sortedRegularContent;
      }

      setRecommendations(finalRecommendations);
      // Cache recommendations for 15 minutes
      await persistentCache.set(CACHE_KEY, finalRecommendations, 15 * 60 * 1000);
    } catch (err) {
      console.error("Error fetching general recommendations:", err);
      setError("Failed to load recommendations");
    } finally {
      setIsLoading(false);
    }
  };

  const calculateRecommendationScore = (
    content: any,
    timeOfDay: string,
    contentType: string,
    userPreferences?: {
      userCountry?: string;
      preferredArtists?: string[];
    }
  ): number => {
    let score = 50; // Base score

    // Boost score based on play count
    const playCount = content.play_count || 0;
    score += Math.min(playCount / 100, 30); // Max 30 points from play count

    // Time-based scoring
    const timeBonus = getTimeBasedBonus(contentType as ContentType, timeOfDay as TimeOfDay);
    score += timeBonus;

    // Duration-based scoring
    const duration = content.duration_seconds || content.metadata?.duration_seconds || 0;
    if (timeOfDay === 'night' && duration < 240) {
      score += 10; // Prefer shorter content at night
    } else if (timeOfDay === 'morning' && duration > 180 && duration < 300) {
      score += 10; // Prefer medium-length content in morning
    }

    // Location-based boost - prioritize local content
    if (userPreferences?.userCountry && content.country) {
      const contentCountry = content.country.toLowerCase();
      const userCountry = userPreferences.userCountry.toLowerCase();

      if (contentCountry === userCountry || contentCountry.includes(userCountry) || userCountry.includes(contentCountry)) {
        score += 15; // Strong boost for local content
        console.log('[AIRecommended] Location match boost for:', content.title);
      }
    }

    // Artist preference boost - reward favorite artists
    if (userPreferences?.preferredArtists && userPreferences.preferredArtists.length > 0 && content.artist_id) {
      if (userPreferences.preferredArtists.includes(content.artist_id)) {
        score += 10; // Boost for favorite artists
        console.log('[AIRecommended] Artist preference boost for:', content.title);
      }
    }

    // Add some randomness for variety
    score += Math.random() * 15;

    return Math.min(score, 100);
  };

  const getTimeBasedBonus = (contentType: ContentType, timeOfDay: TimeOfDay): number => {
    const bonusMap: Record<ContentType, TimeOfDayScores> = {
      music: {
        morning: 15,
        afternoon: 10,
        evening: 12,
        night: 8
      },
      video: {
        morning: 8,
        afternoon: 15,
        evening: 12,
        night: 10
      },
      short_clip: {
        morning: 10,
        afternoon: 12,
        evening: 15,
        night: 18
      }
    };
    
    return bonusMap[contentType]?.[timeOfDay] || 5;
  };

  const getTimeBasedContentPreference = () => {
    // Adjust content mix based on time of day
    switch (timeOfDay) {
      case 'morning':
        return { music: 12, video: 8 }; // More music in morning
      case 'afternoon':
        return { music: 10, video: 10 }; // Balanced
      case 'evening':
        return { music: 8, video: 12 }; // More video in evening
      case 'night':
        return { music: 15, video: 5 }; // More music, less video at night
      default:
        return { music: 10, video: 10 };
    }
  };

  const getRecommendationReason = (
    contentType: ContentType,
    timeOfDay: TimeOfDay
  ): string => {
    // Time-based reasons
    const reasons: Record<ContentType, TimeOfDayReasons[]> = {
      music: [
        {
          morning: "Perfect for your morning routine and energy boost",
          afternoon: "Great for staying focused and productive",
          evening: "Ideal for unwinding after a long day",
          night: "Perfect for late night vibes and relaxation"
        },
        {
          morning: "Energize your morning with this uplifting track",
          afternoon: "Keep the momentum going with this selection",
          evening: "Wind down with this smooth listening experience",
          night: "Late night listening at its finest"
        },
        {
          morning: "Start fresh with this morning favorite",
          afternoon: "Soundtrack your afternoon workflow perfectly",
          evening: "The perfect evening mood setter",
          night: "Drift away with this nocturnal gem"
        },
        {
          morning: "Wake up right with this energizing sound",
          afternoon: "Power through your afternoon with this beat",
          evening: "Ease into the evening with this chill vibe",
          night: "Perfect soundtrack for midnight thoughts"
        },
        {
          morning: "Kick-start your day with positive energy",
          afternoon: "Midday motivation delivered through music",
          evening: "Unwind and decompress with this selection",
          night: "Your companion for peaceful late hours"
        }
      ],
      video: [
        {
          morning: "Start your day with inspiration and creativity",
          afternoon: "Take a creative break with this visual treat",
          evening: "Relax and enjoy captivating content",
          night: "Wind down with great visual storytelling"
        },
        {
          morning: "Morning inspiration to fuel your ambitions",
          afternoon: "Perfect afternoon entertainment awaits",
          evening: "Evening entertainment at its best",
          night: "Late night viewing pleasure guaranteed"
        },
        {
          morning: "Kickstart your creativity this morning",
          afternoon: "Refresh your mind with engaging content",
          evening: "Prime time viewing for maximum enjoyment",
          night: "Nighttime viewing made extraordinary"
        },
        {
          morning: "Begin your day with fresh perspectives",
          afternoon: "Midday break entertainment sorted",
          evening: "Settle in for quality evening viewing",
          night: "Midnight screen time done right"
        },
        {
          morning: "Morning eye-opener with this visual gem",
          afternoon: "Afternoon delight in video form",
          evening: "Your evening escape awaits here",
          night: "Perfect for those late night scrolls"
        }
      ],
      short_clip: [
        {
          morning: "Quick entertainment to jumpstart your day",
          afternoon: "Perfect bite-sized content for your break",
          evening: "Fun clips to brighten your evening",
          night: "Quick laughs before bed, perfectly timed"
        },
        {
          morning: "Morning giggles in under a minute",
          afternoon: "Quick afternoon pick-me-up content",
          evening: "Evening entertainment in seconds",
          night: "Bedtime smiles delivered quickly"
        },
        {
          morning: "Fast fun to energize your morning",
          afternoon: "Micro-break entertainment perfection",
          evening: "Evening scrolls made worthwhile",
          night: "Late night laughs, bite-sized style"
        },
        {
          morning: "Start strong with this quick content",
          afternoon: "Perfect snackable content for now",
          evening: "Quick evening entertainment fix",
          night: "Midnight giggles in clip form"
        },
        {
          morning: "Morning mood boost in seconds",
          afternoon: "Afternoon energy in bite-sized format",
          evening: "Quick evening joy delivered instantly",
          night: "Sweet dreams start with quick laughs"
        }
      ]
    };

    // Randomly select one of the reason variations for variety
    const reasonVariations = reasons[contentType];
    const randomIndex = Math.floor(Math.random() * reasonVariations.length);
    return reasonVariations[randomIndex][timeOfDay] || "Recommended for you";
  };

  const handleContentClick = async (content: AIRecommendedContent) => {
    setActiveBlink(content.id);
    setTimeout(() => setActiveBlink(null), 600);

    // Track click if this is promoted content
    if (content.isPromoted) {
      const contentTypeMap = {
        'music': 'song' as const,
        'video': 'video' as const,
        'short_clip': 'short_clip' as const
      };
      await recordPromotedContentClick(content.id, 'ai_recommended', contentTypeMap[content.contentType]);
    }

    if (content.contentType === 'music') {
      // Always start with mini player for consistent UX
      const formattedSong = {
        id: content.id,
        title: content.title,
        artist: content.artist,
        artistId: content.artistId,
        coverImageUrl: content.coverImageUrl,
        audioUrl: content.audioUrl,
        duration: content.duration,
        playCount: content.playCount,
        featuredArtists: null
      };

      const formattedPlaylist = recommendations
        .filter(r => r.contentType === 'music' && r.audioUrl)
        .map(r => ({
          id: r.id,
          title: r.title,
          artist: r.artist,
          artistId: r.artistId,
          coverImageUrl: r.coverImageUrl,
          audioUrl: r.audioUrl,
          duration: r.duration,
          playCount: r.playCount,
          featuredArtists: null
        }));

      onOpenMusicPlayer(formattedSong, formattedPlaylist, 'AI Recommended');
    } else {
      // Navigate to video player
      navigate(`/video/${content.id}`);
    }
  };

  const handleRefresh = () => {
    fetchRecommendationsData();
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };


  const getContentTypeIcon = (contentType: string) => {
    switch (contentType) {
      case 'music': return Music;
      case 'video': return Video;
      case 'short_clip': return Zap;
      default: return Music;
    }
  };

  const getContentTypeLabel = (contentType: string) => {
    switch (contentType) {
      case 'music': return 'Music';
      case 'video': return 'Video';
      case 'short_clip': return 'Clip';
      default: return 'Content';
    }
  };

  const getContentTypeColor = (contentType: string) => {
    switch (contentType) {
      case 'music': return 'from-blue-600 to-purple-600';
      case 'video': return 'from-pink-600 to-red-600';
      case 'short_clip': return 'from-yellow-600 to-orange-600';
      default: return 'from-gray-600 to-gray-700';
    }
  };

  // Fallback content for when no recommendations are available
  const fallbackRecommendations: AIRecommendedContent[] = [
    {
      id: "ai-fallback-1",
      title: "Discover New Music",
      artist: "Various Artists",
      artistId: null,
      contentType: 'music',
      coverImageUrl: "https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400",
      audioUrl: null,
      duration: 180,
      playCount: 1000,
      recommendationScore: 95,
      recommendationReason: "Popular with users like you"
    },
    {
      id: "ai-fallback-2",
      title: "Trending Video",
      artist: "Content Creator",
      artistId: null,
      contentType: 'video',
      coverImageUrl: null,
      thumbnailUrl: "https://images.pexels.com/photos/167636/pexels-photo-167636.jpeg?auto=compress&cs=tinysrgb&w=400",
      videoUrl: null,
      duration: 240,
      playCount: 850,
      recommendationScore: 90,
      recommendationReason: "Based on your viewing history"
    },
    {
      id: "ai-fallback-3",
      title: "Quick Entertainment",
      artist: "Viral Creator",
      artistId: null,
      contentType: 'short_clip',
      coverImageUrl: null,
      thumbnailUrl: "https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=400",
      videoUrl: null,
      duration: 45,
      playCount: 1200,
      recommendationScore: 88,
      recommendationReason: "Perfect for quick entertainment"
    }
  ];

  // Display fallback items if loading, error, or no data
  const displayItems = isLoading || error || recommendations.length === 0 
    ? fallbackRecommendations 
    : recommendations;

  return (
    <section className="w-full py-6 px-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
          AI Recommended
        </h2>
         </div>

      {isLoading ? (
        <ScrollArea className="w-full">
          <div className="flex space-x-4 pb-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="w-32 flex-shrink-0 animate-pulse">
                <div className="bg-[#181818] rounded-xl overflow-hidden">
                  <div className="w-32 h-32 bg-[#282828]"></div>
                </div>
                <div className="mt-3">
                  <div className="h-3 bg-[#282828] rounded mb-2"></div>
                  <div className="h-2 bg-[#282828] rounded w-3/4"></div>
                </div>
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" className="opacity-0" />
        </ScrollArea>
      ) : error ? (
        <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-lg text-center">
          <p className="font-['Inter',sans-serif] text-red-400 text-sm mb-2">
            {error}
          </p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-red-500/30 hover:bg-red-500/40 rounded-lg text-red-400 text-sm transition-colors duration-200 flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      ) : (
        <ScrollArea className="w-full">
          <div className="flex space-x-4 pb-4">
            {displayItems.map((content, index) => {
              const ContentTypeIcon = getContentTypeIcon(content.contentType);
              const imageUrl = content.contentType === 'music' 
                ? content.coverImageUrl 
                : content.thumbnailUrl;
              
              return (
                <Card
                  key={`${content.id}-${index}`}
                  className="w-32 flex-shrink-0 bg-transparent border-none shadow-none group cursor-pointer active:scale-95 transition-transform duration-150"
                  onClick={() => handleContentClick(content)}
                >
                  <CardContent className="p-0">
                    <div
                      className={`relative overflow-hidden rounded-xl shadow-lg group-active:shadow-2xl transition-all duration-200 ${activeBlink === content.id ? 'blink-effect' : ''}`}
                    >
                      <div
                        className="w-32 h-32 bg-cover bg-center"
                      >
                        <LazyImage
                          src={imageUrl || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                          alt={content.title}
                          className="w-full h-full"
                        />
                        <div className="absolute inset-0 bg-black/20 group-active:bg-black/10 transition-colors duration-200"></div>

                        {/* Content Type Badge */}
                        <div className={`absolute top-2 right-2 px-2 py-1 bg-gradient-to-r ${getContentTypeColor(content.contentType)} rounded-full text-white text-xs font-medium flex items-center gap-1 shadow-lg`}>
                          <ContentTypeIcon className="w-3 h-3" />
                          {getContentTypeLabel(content.contentType)}
                        </div>

                        {/* Duration Badge */}
                        {content.duration > 0 && (
                          <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/80 rounded-full text-white text-xs font-medium flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(content.duration)}
                          </div>
                        )}

                        {/* Promoted Badge */}
                        {content.isPromoted && (
                          <div className="absolute bottom-2 left-2 p-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
                            <Flame className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="w-32 mt-2">
                      <p className="font-['Inter',sans-serif] font-bold text-white/90 text-xs leading-tight group-active:text-white transition-colors duration-200 line-clamp-2 mb-1 text-left">
                        {content.title}
                      </p>
                      <p className="font-['Inter',sans-serif] text-white/60 text-xs leading-tight line-clamp-1 text-left mb-1">
                        {content.artistId ? (
                          <Link
                            to={`/user/${content.artistId}`}
                            className="active:text-orange-400 transition-colors duration-200"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {content.artist}
                          </Link>
                        ) : (
                          <>{content.artist}</>
                        )}
                      </p>
                      {isAuthenticated && (
                        <p className="font-['Inter',sans-serif] text-purple-400/80 text-[10px] leading-snug line-clamp-2 text-left">
                          {content.recommendationReason}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" className="opacity-0" />
        </ScrollArea>
      )}
    </section>
  );
};