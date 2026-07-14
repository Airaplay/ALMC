import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Play, Heart, Share2, Flame, Eye } from 'lucide-react';
import { LazyImage } from '../../components/LazyImage';
import { Skeleton } from '../../components/ui/skeleton';
import { supabase, toggleContentFavorite, isContentFavorited } from '../../lib/supabase';
import { shareVideo } from '../../lib/shareService';
import { favoritesCache } from '../../lib/favoritesCache';
import { useNavigate } from 'react-router-dom';
import { mergeTrendingContentWithPromotions } from '../../lib/trendingPromotionSlots';
import { mergeAdditionalSongsWithPromotions } from '../../lib/additionalSongsPromotionSlots';
import { recordPromotedContentClick } from '../../lib/promotionHelper';

interface MustWatchVideo {
  id: string;
  title: string;
  creator: string;
  creator_id: string;
  creator_user_id: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  duration_seconds: number;
  play_count: number;
  creator_profile_photo: string | null;
  isPromoted?: boolean;
}

export const MustWatchViewAllScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const [topTenVideos, setTopTenVideos] = useState<MustWatchVideo[]>([]);
  const [additionalVideos, setAdditionalVideos] = useState<MustWatchVideo[]>([]);
  const [isLoadingTopTen, setIsLoadingTopTen] = useState(true);
  const [isLoadingAdditional, setIsLoadingAdditional] = useState(true);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFavorited, setIsFavorited] = useState<Record<string, boolean>>(() => {
    return favoritesCache.getAllFavoritesMap().videos;
  });
  const carouselRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const mouseStartX = useRef<number>(0);
  const dragStartTime = useRef<number>(0);
  const hasMoved = useRef<boolean>(false);

  useEffect(() => {
    fetchTopTenVideos();
    fetchAdditionalVideos();
    checkFavorites();
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkFavorites();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const checkFavorites = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('content_favorites')
        .select('content_upload_id')
        .eq('user_id', session.user.id);

      if (error) throw error;

      const videoIds = data?.map(fav => fav.content_upload_id) || [];
      favoritesCache.updateFromServer({ videos: videoIds });

      const favMap: Record<string, boolean> = {};
      data?.forEach(fav => {
        favMap[fav.content_upload_id] = true;
      });
      setIsFavorited(favMap);
    } catch (err) {
      console.error('Error checking favorites:', err);
    }
  };

  const fetchTopTenVideos = async () => {
    setIsLoadingTopTen(true);

    try {
      let query = supabase
        .from('content_uploads')
        .select(`
          id,
          title,
          description,
          content_type,
          metadata,
          play_count,
          created_at,
          user_id,
          users (
            id,
            display_name,
            avatar_url
          )
        `)
        .eq('content_type', 'video')
        .eq('status', 'approved')
        .not('metadata->video_url', 'is', null)
        .order('play_count', { ascending: false })
        .limit(10);


      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const formattedVideos: MustWatchVideo[] = data?.map((content: any) => ({
        id: content.id,
        title: content.title,
        creator: content.users?.display_name || 'Unknown Creator',
        creator_id: content.user_id || '',
        creator_user_id: content.user_id || null,
        thumbnail_url: content.metadata?.thumbnail_url,
        video_url: content.metadata?.video_url || content.metadata?.file_url,
        duration_seconds: content.metadata?.duration_seconds || 0,
        play_count: content.play_count || 0,
        creator_profile_photo: content.users?.avatar_url || null
      })) || [];

      const mergedContent = await mergeTrendingContentWithPromotions(
        formattedVideos,
        'must_watch',
        'video'
      );

      const videosWithPromotion = mergedContent.map(({ item, isPromoted }) => ({
        ...item,
        isPromoted
      }));

      setTopTenVideos(videosWithPromotion);
      setCurrentCardIndex(0);
    } catch (err) {
      console.error("Error fetching top 10 videos:", err);
    } finally {
      setIsLoadingTopTen(false);
    }
  };

  const fetchAdditionalVideos = async () => {
    setIsLoadingAdditional(true);

    try {
      let query = supabase
        .from('content_uploads')
        .select(`
          id,
          title,
          description,
          content_type,
          metadata,
          play_count,
          created_at,
          user_id,
          users (
            id,
            display_name,
            avatar_url
          )
        `)
        .eq('content_type', 'video')
        .eq('status', 'approved')
        .not('metadata->video_url', 'is', null)
        .order('play_count', { ascending: false })
        .range(10, 49);


      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const formattedVideos: MustWatchVideo[] = data?.map((content: any) => ({
        id: content.id,
        title: content.title,
        creator: content.users?.display_name || 'Unknown Creator',
        creator_id: content.user_id || '',
        creator_user_id: content.user_id || null,
        thumbnail_url: content.metadata?.thumbnail_url,
        video_url: content.metadata?.video_url || content.metadata?.file_url,
        duration_seconds: content.metadata?.duration_seconds || 0,
        play_count: content.play_count || 0,
        creator_profile_photo: content.users?.avatar_url || null
      })) || [];

      const mergedContent = await mergeAdditionalSongsWithPromotions(
        formattedVideos,
        'must_watch',
        'video'
      );

      const videosWithPromotion = mergedContent.map(({ item, isPromoted }) => ({
        ...item,
        isPromoted
      }));

      setAdditionalVideos(videosWithPromotion);
    } catch (err) {
      console.error("Error fetching additional videos:", err);
    } finally {
      setIsLoadingAdditional(false);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('svg') || target.closest('path')) {
      return;
    }
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = e.touches[0].clientX;
    dragStartTime.current = Date.now();
    hasMoved.current = false;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;

    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('svg') || target.closest('path')) {
      setIsDragging(false);
      setDragOffset(0);
      return;
    }

    touchEndX.current = e.touches[0].clientX;
    const diff = touchEndX.current - touchStartX.current;

    if (Math.abs(diff) > 5) {
      hasMoved.current = true;
    }

    const maxDrag = 200;
    const limitedDiff = Math.max(-maxDrag, Math.min(maxDrag, diff));

    setDragOffset(limitedDiff);
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;

    const swipeThreshold = 75;
    const velocityThreshold = 5;
    const swipeDistance = touchStartX.current - touchEndX.current;
    const shouldSwipeNext = swipeDistance > swipeThreshold || (swipeDistance > 30 && Math.abs(dragOffset) > velocityThreshold);
    const shouldSwipePrev = swipeDistance < -swipeThreshold || (swipeDistance < -30 && Math.abs(dragOffset) > velocityThreshold);

    setIsDragging(false);

    if (hasMoved.current && (shouldSwipeNext || shouldSwipePrev)) {
      if (shouldSwipeNext) {
        handleNextCard();
      } else if (shouldSwipePrev) {
        handlePrevCard();
      }
    }

    setDragOffset(0);
    touchStartX.current = 0;
    touchEndX.current = 0;
    hasMoved.current = false;
  };

  const handleNextCard = () => {
    if (currentCardIndex < topTenVideos.length - 1) {
      setCurrentCardIndex(prev => prev + 1);
    }
  };

  const handlePrevCard = () => {
    if (currentCardIndex > 0) {
      setCurrentCardIndex(prev => prev - 1);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('svg') || target.closest('path')) {
      return;
    }
    mouseStartX.current = e.clientX;
    touchStartX.current = e.clientX;
    dragStartTime.current = Date.now();
    hasMoved.current = false;
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;

    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('svg') || target.closest('path')) {
      setIsDragging(false);
      setDragOffset(0);
      return;
    }

    const diff = e.clientX - touchStartX.current;

    if (Math.abs(diff) > 5) {
      hasMoved.current = true;
    }

    const maxDrag = 200;
    const limitedDiff = Math.max(-maxDrag, Math.min(maxDrag, diff));

    setDragOffset(limitedDiff);
  };

  const handleMouseUp = () => {
    if (!isDragging) return;

    const swipeThreshold = 75;
    const velocityThreshold = 5;
    const swipeDistance = -dragOffset;
    const shouldSwipeNext = swipeDistance > swipeThreshold || (swipeDistance > 30 && Math.abs(dragOffset) > velocityThreshold);
    const shouldSwipePrev = swipeDistance < -swipeThreshold || (swipeDistance < -30 && Math.abs(dragOffset) > velocityThreshold);

    setIsDragging(false);

    if (hasMoved.current && (shouldSwipeNext || shouldSwipePrev)) {
      if (shouldSwipeNext) {
        handleNextCard();
      } else if (shouldSwipePrev) {
        handlePrevCard();
      }
    }

    setDragOffset(0);
    touchStartX.current = 0;
    hasMoved.current = false;
  };

  const handlePlayVideo = async (video: MustWatchVideo) => {
    if (!video.video_url) {
      alert('This video is not available for playback.');
      return;
    }

    if (video.isPromoted) {
      await recordPromotedContentClick(video.id, 'must_watch', 'video');
    }

    navigate(`/video/${video.id}`);
  };

  const handleToggleFavorite = async (videoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const previousState = isFavorited[videoId];
      setIsFavorited(prev => ({ ...prev, [videoId]: !previousState }));

      const newState = await toggleContentFavorite(videoId);
      setIsFavorited(prev => ({ ...prev, [videoId]: newState }));
    } catch (err) {
      console.error('Error toggling favorite:', err);
      const previousState = isFavorited[videoId];
      setIsFavorited(prev => ({ ...prev, [videoId]: previousState }));
    }
  };

  const handleShare = async (video: MustWatchVideo, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await shareVideo(video.id, video.title);
    } catch (error) {
      console.error('Error sharing video:', error);
    }
  };

  const formatPlayCount = (count: number): string => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  const currentVideo = topTenVideos[currentCardIndex];
  const prevVideo = currentCardIndex > 0 ? topTenVideos[currentCardIndex - 1] : null;
  const nextVideo = currentCardIndex < topTenVideos.length - 1 ? topTenVideos[currentCardIndex + 1] : null;


  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav overflow-y-auto">
      {/* Header */}
      <header className="w-full py-4 px-5 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="p-2 hover:bg-white/10 rounded-full transition-all"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="font-bold text-lg">Must Watch</h1>
          <div className="w-10"></div>
        </div>
      </header>

      {isLoadingTopTen ? (
        <div className="px-5 py-6">
          {/* Skeleton for Main Carousel */}
          <div className="relative h-[320px] mb-6">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-md h-[280px]">
              <Skeleton variant="rectangular" className="w-full h-full rounded-2xl bg-white/10" />
            </div>
          </div>
          {/* Skeleton for Indicators */}
          <div className="flex justify-center gap-2 mb-8">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} variant="rectangular" className="h-1.5 w-1.5 rounded-full bg-white/20" />
            ))}
          </div>
          {/* Skeleton for Additional Videos Grid */}
          <div className="mt-6">
            <Skeleton variant="text" className="h-6 w-48 mb-4 bg-white/10" />
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i}>
                  <Skeleton variant="rectangular" className="w-full aspect-video rounded-lg mb-2 bg-white/10" />
                  <Skeleton variant="text" className="h-3 w-full mb-1 bg-white/10" />
                  <Skeleton variant="text" className="h-2 w-3/4 bg-white/10" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : topTenVideos.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center">
            <h3 className="font-semibold text-lg text-gray-300 mb-2">No Videos Found</h3>
            <p className="text-gray-500 text-sm">No videos available in this category</p>
          </div>
        </div>
      ) : (
        <>
          {/* Main Carousel Card */}
          <div className="px-5 py-6 relative">
            <div
              ref={carouselRef}
              className="relative h-[320px] perspective-1000"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {/* Previous Card (Left, Blurred) */}
              {prevVideo && (
                <div
                  key={`prev-${prevVideo.id}`}
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-24 h-[200px] z-0 blur-sm"
                  style={{
                    opacity: dragOffset > 0 ? Math.min(0.8, 0.5 + (dragOffset / 200) * 0.3) : 0.5,
                    transform: `translateY(-50%) scale(${1 + Math.max(0, dragOffset / 400)})`,
                    transition: isDragging ? 'none' : 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  <LazyImage
                    src={prevVideo.thumbnail_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                    alt={prevVideo.title}
                    className="w-full h-full object-cover rounded-2xl"
                  />
                </div>
              )}

              {/* Current Card (Center) - Horizontal Video Format */}
              {currentVideo && (
                <div
                  key={`current-${currentVideo.id}`}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-md h-[280px] z-10 cursor-pointer"
                  style={{
                    transform: `translate(-50%, -50%) translateX(${dragOffset}px) rotate(${dragOffset * 0.05}deg)`,
                    transition: isDragging ? 'none' : 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                  onClick={() => !isDragging && handlePlayVideo(currentVideo)}
                >
                  <div className="relative w-full h-full rounded-2xl overflow-hidden shadow-2xl">
                    <LazyImage
                      src={currentVideo.thumbnail_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                      alt={currentVideo.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/40 to-black/70"></div>

                    {/* Promoted Badge - Top Left */}
                    {currentVideo.isPromoted && (
                      <div className="absolute top-3 left-3 px-2.5 py-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg flex items-center gap-1">
                        <Flame className="w-3 h-3 text-white" />
                        <span className="text-[10px] font-semibold text-white">Promoted</span>
                      </div>
                    )}

                    {/* Video Info - Bottom */}
                    <div className="absolute bottom-0 left-0 right-0 p-6">
                      <div className="flex items-center justify-between mb-2">
                        <h2 className="text-white text-lg font-bold drop-shadow-lg flex-1 pr-3 line-clamp-1">{currentVideo.title}</h2>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handlePlayVideo(currentVideo);
                          }}
                          onTouchStart={(e) => e.stopPropagation()}
                          onTouchMove={(e) => e.stopPropagation()}
                          onTouchEnd={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handlePlayVideo(currentVideo);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-14 h-14 rounded-full bg-white flex items-center justify-center active:scale-95 transition-transform shadow-xl flex-shrink-0 z-20"
                        >
                          <Play className="w-6 h-6 text-black ml-1" fill="black" />
                        </button>
                      </div>
                      <div className="flex items-center gap-4 -mt-5">
                        <div className="flex items-center gap-1.5 text-white/80">
                          <Eye className="w-4 h-4" />
                          <span className="text-sm">{formatPlayCount(currentVideo.play_count)} views</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Next Card (Right, Blurred) */}
              {nextVideo && (
                <div
                  key={`next-${nextVideo.id}`}
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-24 h-[200px] z-0 blur-sm"
                  style={{
                    opacity: dragOffset < 0 ? Math.min(0.8, 0.5 + (Math.abs(dragOffset) / 200) * 0.3) : 0.5,
                    transform: `translateY(-50%) scale(${1 + Math.max(0, Math.abs(dragOffset) / 400)})`,
                    transition: isDragging ? 'none' : 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  <LazyImage
                    src={nextVideo.thumbnail_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                    alt={nextVideo.title}
                    className="w-full h-full object-cover rounded-2xl"
                  />
                </div>
              )}
            </div>

            {/* Carousel Indicators */}
            <div className="flex justify-center gap-2 mt-6">
              {topTenVideos.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentCardIndex(index)}
                  className={`h-1.5 rounded-full transition-all ${
                    index === currentCardIndex
                      ? 'w-8 bg-white'
                      : 'w-1.5 bg-white/30'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Additional Videos Grid (11-50) */}
          <div className="px-5 py-6">
            <h2 className="text-xl font-bold mb-4">More Videos</h2>
            {isLoadingAdditional ? (
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i}>
                    <Skeleton variant="rectangular" className="w-full aspect-video rounded-lg mb-2 bg-white/10" />
                    <Skeleton variant="text" className="h-3 w-full mb-1 bg-white/10" />
                    <Skeleton variant="text" className="h-2 w-3/4 bg-white/10" />
                  </div>
                ))}
              </div>
            ) : additionalVideos.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-gray-500 text-sm">No more videos available</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {additionalVideos.map((video) => (
                  <div
                    key={video.id}
                    onClick={() => handlePlayVideo(video)}
                    className="cursor-pointer group"
                  >
                    {/* Video Thumbnail - 16:9 aspect ratio for horizontal videos */}
                    <div className="relative w-full aspect-video rounded-lg overflow-hidden mb-2 bg-white/5">
                      <LazyImage
                        src={video.thumbnail_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                        alt={video.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300 flex items-center justify-center">
                        <Play className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300" fill="white" />
                      </div>
                      {video.isPromoted && (
                        <div className="absolute top-1 right-1 p-0.5 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
                          <Flame className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                      {/* Play Count Badge */}
                      {video.play_count > 0 && (
                        <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/80 rounded text-white text-[9px] font-semibold flex items-center gap-0.5">
                          <Eye className="w-2 h-2" />
                          {formatPlayCount(video.play_count)}
                        </div>
                      )}
                    </div>

                    {/* Video Info */}
                    <div className="text-left">
                      <h3 className="text-[10px] font-semibold text-white line-clamp-2 mb-0.5 leading-tight">{video.title}</h3>
                      <p className="text-[9px] text-gray-400 truncate">{video.creator}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
