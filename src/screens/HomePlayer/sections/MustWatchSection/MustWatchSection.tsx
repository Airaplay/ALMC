import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "../../../../components/ui/card";
import { ScrollArea, ScrollBar } from "../../../../components/ui/scroll-area";
import { RefreshCw, Flame } from "lucide-react";
import { supabase } from "../../../../lib/supabase";
import { Link, useNavigate } from "react-router-dom";
import { getPromotedContentForSection, recordPromotedContentClick } from "../../../../lib/promotionHelper";
import { videoCache } from "../../../../lib/videoCache";
import { persistentCache } from "../../../../lib/persistentCache";
import { useAlert } from "../../../../contexts/AlertContext";
import { useEngagementSync } from "../../../../hooks/useEngagementSync";
import { useUserCountry } from "../../../../hooks/useUserCountry";

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

interface VideoContent {
  id: string;
  title: string;
  description?: string;
  contentType: 'video';
  videoUrl: string | null;
  thumbnailUrl: string | null;
  playCount: number;
  duration: number;
  createdAt: string;
  creator: {
    id: string;
    name: string;
    avatar?: string | null;
  };
  isPromoted?: boolean;
}

interface MustWatchSectionProps {
  className?: string;
}

const CACHE_KEY = 'must_watch_section_processed';

export const MustWatchSection = ({ className = '' }: MustWatchSectionProps): JSX.Element => {
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { countryCode } = useUserCountry();
  const [videos, setVideos] = useState<VideoContent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [originalVideos, setOriginalVideos] = useState<VideoContent[]>([]);
  const [activeBlink, setActiveBlink] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isInitialMount = useRef(true);

  // Real-time engagement sync for videos
  useEngagementSync(useCallback((update) => {
    if (update.contentType === 'video' && update.metric === 'play_count') {
      setVideos(prevVideos =>
        prevVideos.map(video =>
          video.id === update.contentId
            ? { ...video, playCount: update.value }
            : video
        )
      );
      setOriginalVideos(prevVideos =>
        prevVideos.map(video =>
          video.id === update.contentId
            ? { ...video, playCount: update.value }
            : video
        )
      );
    }
  }, []));

  // Load cached videos on mount
  useEffect(() => {
    const loadCached = async () => {
      if (isInitialMount.current) {
        const cached = await persistentCache.get<VideoContent[]>(CACHE_KEY);
        if (cached && cached.length > 0) {
          setVideos(cached);
          setOriginalVideos(cached);
          setIsLoading(false);
        }
        isInitialMount.current = false;
      }
    };
    loadCached();
  }, []);

  useEffect(() => {
    fetchMustWatchContent();

    const refreshInterval = setInterval(() => {
      shuffleAndRefresh();
    }, 18 * 60 * 1000);

    return () => clearInterval(refreshInterval);
  }, [countryCode]);

  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const shuffleAndRefresh = async () => {
    setIsRefreshing(true);

    if (videos.length > 0) {
      const shuffled = shuffleArray(videos);
      setVideos(shuffled);
    }

    setTimeout(async () => {
      await fetchMustWatchContent(true);
      setIsRefreshing(false);
    }, 500);
  };

  const fetchMustWatchContent = async (silentRefresh = false) => {
    if (!silentRefresh) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const params: any = {};
      if (countryCode) params.user_country = countryCode;

      const { data, error: fetchError } = await supabase.rpc('get_top_videos_by_country', params);

      if (fetchError) {
        throw new Error(`Failed to fetch content: ${fetchError.message}`);
      }

      if (!data || data.length === 0) {
        setVideos([]);
        return;
      }

      const formattedContent: VideoContent[] = data
        .filter((v: any) => v.video_url)
        .map((v: any) => ({
          id: v.id,
          title: v.title,
          contentType: 'video' as const,
          videoUrl: v.video_url,
          thumbnailUrl: v.thumbnail_url,
          playCount: v.play_count || 0,
          duration: v.duration_seconds || 0,
          createdAt: '',
          creator: {
            id: v.user_id,
            name: v.creator_name || 'Unknown Creator',
            avatar: v.creator_avatar
          }
        }));

      const promoted = await getPromotedContentForSection('must_watch', 'video');

      const videosWithPromotion = formattedContent.map(video => ({
        ...video,
        isPromoted: promoted.includes(video.id)
      }));

      setOriginalVideos(videosWithPromotion);
      const shuffled = shuffleArray(videosWithPromotion);
      setVideos(shuffled);
      await persistentCache.set(CACHE_KEY, shuffled, 18 * 60 * 1000);
    } catch (err) {
      console.error("Error fetching must watch content:", err);
      setError(err instanceof Error ? err.message : "Failed to load must watch content");
    } finally {
      if (!silentRefresh) {
        setIsLoading(false);
      }
    }
  };

  const handleVideoClick = async (video: VideoContent) => {
    setActiveBlink(video.id);
    setTimeout(() => setActiveBlink(null), 600);

    if (!video.videoUrl) {
      showAlert({
        title: 'Video Unavailable',
        message: 'This video is not available for playback.',
        type: 'error'
      });
      return;
    }

    // Track click if this is promoted content
    if (video.isPromoted) {
      await recordPromotedContentClick(video.id, 'must_watch', 'video');
    }

    // Navigate to video player
    navigate(`/video/${video.id}`);
  };

  const handleVideoHover = (videoId: string) => {
    // Prefetch video data on hover for instant loading
    videoCache.prefetch(videoId);
  };

  const handleRefresh = () => {
    shuffleAndRefresh();
  };




  return (
    <section className={`w-full py-6 px-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
            Must Watch
          </h2>
        </div>

        <button
          onClick={() => navigate('/must-watch')}
          className="font-['Inter',sans-serif] text-white hover:text-white/80 text-sm font-medium transition-colors duration-200"
        >
          View All
        </button>
      </div>

      {isLoading ? (
        <ScrollArea className="w-full">
          <div className="flex gap-4 pb-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="w-[180px] flex-shrink-0 animate-pulse">
                <div className="bg-[#181818] rounded-lg overflow-hidden">
                  <div className="w-[180px] h-[101px] bg-[#282828]"></div>
                </div>
                <div className="mt-2">
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
      ) : videos.length === 0 ? (
        <div className="p-6 bg-white/5 rounded-lg text-center">
          <h3 className="font-['Inter',sans-serif] font-semibold text-white text-lg mb-2">
            No Videos Available
          </h3>
          <p className="font-['Inter',sans-serif] text-white/70 text-sm">
            Videos will appear here when creators upload content
          </p>
        </div>
      ) : (
        <ScrollArea className="w-full">
          <div className="flex gap-4 pb-4">
            {videos.map((video) => {
              return (
                <VideoCard
                  key={video.id}
                  video={video}
                  onClick={() => handleVideoClick(video)}
                  onMouseEnter={() => handleVideoHover(video.id)}
                  onTouchStart={() => handleVideoHover(video.id)}
                  activeBlink={activeBlink}
                />
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" className="opacity-0" />
        </ScrollArea>
      )}
    </section>
  );
};

// Separate component for video card - static thumbnail only, no auto-play
interface VideoCardProps {
  video: VideoContent;
  onClick: () => void;
  activeBlink: string | null;
}

const VideoCard = ({ video, onClick, activeBlink }: VideoCardProps): JSX.Element => {
  return (
    <Card
      className="w-[180px] flex-shrink-0 bg-transparent border-none shadow-none group cursor-pointer active:scale-95 transition-transform duration-150"
      onClick={onClick}
    >
      <CardContent className="p-0">
        <div className={`relative overflow-hidden rounded-lg shadow-lg group-active:shadow-2xl transition-all duration-200 ${activeBlink === video.id ? 'blink-effect' : ''}`}>
          {/* YouTube-style 16:9 aspect ratio - Static thumbnail only */}
          <div className="w-[180px] h-[101px] relative bg-black">
            {/* Static thumbnail image - no video element */}
            <img
              src={video.thumbnailUrl || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
              alt={video.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>

            {/* Duration Badge */}
            {video.duration > 0 && (
              <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/90 rounded text-white text-xs font-semibold">
                {Math.floor(video.duration / 60)}:{String(Math.floor(video.duration % 60)).padStart(2, '0')}
              </div>
            )}

            {/* Promoted Badge */}
            {video.isPromoted && (
              <div className="absolute top-2 right-2 p-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
                <Flame className="w-3 h-3 text-white" />
              </div>
            )}
          </div>
        </div>

        <div className="w-[180px] mt-2">
          <p className="font-['Inter',sans-serif] font-semibold text-white text-sm leading-tight group-active:text-orange-400 transition-colors duration-200 line-clamp-2 mb-1 text-left">
            {video.title}
          </p>
          <p className="font-['Inter',sans-serif] text-white/60 text-xs leading-tight line-clamp-1 text-left">
            <Link
              to={`/user/${video.creator.id}`}
              className="active:text-orange-400 transition-colors duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {video.creator.name}
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

