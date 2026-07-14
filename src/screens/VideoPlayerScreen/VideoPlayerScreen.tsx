import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Spinner } from '../../components/Spinner';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchOptimizedVideo } from '../../lib/optimizedDataFetcher';
import { backgroundPrefetcher } from '../../lib/backgroundPrefetch';
import { videoCache } from '../../lib/videoCache';
import {
  X, Play, Pause, Maximize, Share2,
  MessageCircle, Eye, Calendar, ChevronDown, ChevronUp, Heart, ThumbsUp, Gift, Settings, Flag, Send,
  Edit2, Trash2, Check, X as XIcon
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { shareVideo } from '../../lib/shareService';
import {
  supabase,
  getVideoDetails,
  getClipLikesCount,
  isClipLiked,
  toggleClipLike,
  getClipComments,
  addClipComment,
  updateClipComment,
  deleteClipComment,
  isFollowing,
  followUser,
  unfollowUser,
  recordShareEvent
} from '../../lib/supabase';
import { videoRecommendationService } from '../../lib/videoRecommendationService';
import { admobService } from '../../lib/admobService';
import { logger } from '../../lib/logger';
import { formatDistanceToNowStrict } from 'date-fns';
import { recordPlayback } from '../../lib/playbackTracker';
import { engagementSync } from '../../lib/engagementSyncService';
import { useHLSPlayer } from '../../hooks/useHLSPlayer';
import { useAdPlacement } from '../../hooks/useAdPlacement';
import { useContentEngagementSync } from '../../hooks/useEngagementSync';
import { recordContribution } from '../../lib/contributionService';
import { favoritesCache } from '../../lib/favoritesCache';
import { followsCache } from '../../lib/followsCache';
import { getOptimizedImageUrl } from '../../lib/imageOptimization';

/** Rewarded shown after a video ends when Watch Next will auto-advance; prepare near end for instant show. */
const REWARDED_VIDEO_BEFORE_NEXT_KEY = 'after_video_play_rewarded';

// Lazy load modals for faster initial render (after all imports to avoid "before initialization" in bundle)
const CommentsModal = lazy(() => import('../../components/CommentsModal').then(m => ({ default: m.CommentsModal })));
const TippingModal = lazy(() => import('../../components/TippingModal').then(m => ({ default: m.TippingModal })));
const ReportModal = lazy(() => import('../../components/ReportModal').then(m => ({ default: m.ReportModal })));
const AuthModal = lazy(() => import('../../components/AuthModal').then(m => ({ default: m.AuthModal })));
const prefetchContentComments = (contentId: string, contentType: string) =>
  import('../../components/CommentsModal').then((m) => m.prefetchContentComments(contentId, contentType));

interface VideoData {
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
}

interface MoreVideo {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  creatorName: string;
  userId: string;
  playCount: number;
  duration: number;
}

interface Comment {
  id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
  parent_comment_id: string | null;
  users: {
  display_name: string;
  avatar_url: string | null;
  };
  likes_count?: number;
  is_liked?: boolean;
  replies?: Comment[];
}

interface VideoPlayerScreenProps {
  onPlayerVisibilityChange?: (isVisible: boolean) => void;
}

const getAvatarUrl = (
  avatarUrl?: string | null,
  metadata?: Record<string, any> | null
): string | undefined => {
  const metadataAvatar =
    metadata?.avatar_url ||
    metadata?.profile_image_url ||
    metadata?.profile_photo_url ||
    metadata?.picture;
  return avatarUrl || metadataAvatar || undefined;
};

export const VideoPlayerScreen: React.FC<VideoPlayerScreenProps> = ({ onPlayerVisibilityChange }) => {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const { user, session, isAuthenticated, isInitialized } = useAuth();
  const { confirm } = useConfirm();
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const newCommentRef = useRef<HTMLTextAreaElement>(null);

  // Video state
  const [videoData, setVideoData] = useState<VideoData | null>(null);
  const [relatedVideos, setRelatedVideos] = useState<MoreVideo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRelated, setIsLoadingRelated] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPortraitVideo, setIsPortraitVideo] = useState(false);
  const [isPortraitHint, setIsPortraitHint] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState<'360p' | '480p' | '720p' | '1080p' | 'auto'>('480p');
  const availableQualities = ['360p', '480p', '720p', '1080p', 'auto'];

  // Interaction state
  const [likesCount, setLikesCount] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [showAllComments, setShowAllComments] = useState(false);
  const [activeTab, setActiveTab] = useState<'comments' | 'watchNext'>('comments');
  const [isFollowingCreator, setIsFollowingCreator] = useState(false);
  const [isLoadingFollow, setIsLoadingFollow] = useState(false);
  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [showTippingModal, setShowTippingModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [likingComments, setLikingComments] = useState<Set<string>>(new Set());
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');

  // Touch/swipe state
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [playbackStartTime, setPlaybackStartTime] = useState<number | null>(null);
  const hasRecordedPlaybackRef = useRef(false);
  /** Which video the current watch session is for (stable when videoId changes before videoData catches up). */
  const playbackVideoIdRef = useRef<string | null>(null);

  // Ad state — sticky bottom banner is now managed globally by the app shell.
  // This screen only requests fullscreen formats (interstitial/rewarded).
  const { showRewarded } = useAdPlacement('VideoPlayerScreen');
  const completedVideosSinceBonusRef = useRef(0);
  const hasAttemptedInitialAutoplayRef = useRef(false);
  /** Native prepareRewardVideoAd once per clip when Watch Next exists and playback is near the end. */
  const hasPreparedRewardedNextRef = useRef(false);
  const [showBonusPrompt, setShowBonusPrompt] = useState(false);

  // Before first play (user tap or autoplay): start playback directly (no video-specific fullscreen ad)
  const tryPlayAfterAd = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const doPlay = () => {
      video.muted = false;
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
            setPlaybackStartTime((t) => t ?? Date.now());
          })
          .catch(() => {
            if (videoRef.current) {
              videoRef.current.muted = true;
              videoRef.current.play().then(() => {
                setPlaybackStartTime((t) => t ?? Date.now());
              }).catch((e) => logger.error('Muted autoplay failed', e));
            }
          });
      }
    };
    doPlay();
  }, [videoId]);

  // Autoplay should happen only once per loaded video, never after a manual pause.
  // Keep startup path lean: never block first frame behind ad loading/showing.
  const startInitialAutoplay = useCallback(() => {
    if (hasAttemptedInitialAutoplayRef.current) return;
    hasAttemptedInitialAutoplayRef.current = true;
    tryPlayAfterAd();
  }, [tryPlayAfterAd]);

  // Update displayed view count when playback is recorded (play_count from RPC → engagementSync)
  useContentEngagementSync(
    videoId || '',
    useCallback((update) => {
      if (
        update.metric === 'play_count' &&
        update.contentType === 'video' &&
        update.contentId === videoId
      ) {
        setVideoData((prev) => (prev ? { ...prev, playCount: update.value } : null));
      }
    }, [videoId])
  );

  // If another part of the app already emitted a newer play_count, merge it in when this video loads
  useEffect(() => {
    if (!videoId || !videoData?.id) return;
    setVideoData((prev) => {
      if (!prev || prev.id !== videoId) return prev;
      const cached = engagementSync.getCachedValue(videoId, 'play_count');
      if (cached != null && cached > prev.playCount) {
        return { ...prev, playCount: cached };
      }
      return prev;
    });
  }, [videoId, videoData?.id]);

  useEffect(() => {
    if (!isPlaying || !videoId) return;
    prefetchContentComments(videoId, 'video').catch(() => {});
  }, [isPlaying, videoId]);

  useEffect(() => {
    if (videoId && videoData?.id === videoId) {
      playbackVideoIdRef.current = videoId;
    }
  }, [videoId, videoData?.id]);

  // Initialize HLS player; first play can optionally show an interstitial, then autoplay
  const { setQuality, getCurrentQuality, getAvailableQualities } = useHLSPlayer(videoRef.current, videoData?.videoUrl || null, {
    autoplay: false,
    defaultStartHeight: 480,
    onError: (error) => {
      logger.error('HLS playback error', error);
      setError('Failed to load video. Please try again or check your connection.');
    },
    onLoadedMetadata: () => {
      void startInitialAutoplay();
    },
  });

  // Fallback: if for any reason HLS onLoadedMetadata doesn't fire autoplay,
  // ensure the first video auto-plays once the URL is ready.
  useEffect(() => {
    if (!videoData?.videoUrl) return;
    void startInitialAutoplay();
  }, [videoData?.videoUrl, startInitialAutoplay]);

  // Infer orientation from thumbnail before metadata arrives for smoother first paint.
  useEffect(() => {
    const thumbnailUrl = videoData?.thumbnailUrl;
    if (!thumbnailUrl) return;

    let isCancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!isCancelled) {
        setIsPortraitHint(img.naturalHeight > img.naturalWidth);
      }
    };
    img.onerror = () => {
      if (!isCancelled) {
        setIsPortraitHint(false);
      }
    };
    img.src = thumbnailUrl;

    return () => {
      isCancelled = true;
    };
  }, [videoData?.thumbnailUrl]);

  useEffect(() => {
    if (!videoId) {
      setError('Video ID is required');
      setIsLoading(false);
      return;
    }

    // Reset per-video first-play tracking
    hasAttemptedInitialAutoplayRef.current = false;
    hasPreparedRewardedNextRef.current = false;
    setShowBonusPrompt(false);
    setIsPortraitVideo(false);
    setIsPortraitHint(false);

    // Notify parent that video player is active
    onPlayerVisibilityChange?.(true);

    // Try to load from cache first for instant display
    const cached = videoCache.get(videoId);
    if (cached) {
      setVideoData(cached);
      setRelatedVideos(cached.relatedVideos || []);
      setIsLoading(false);
      // Refresh in background
      checkAuthAndLoadData();
    } else {
      // Load immediately if not cached
      checkAuthAndLoadData();
    }
    
    // Add touch event listeners for swipe
    const container = containerRef.current;
    if (container) {
      container.addEventListener('touchstart', handleContainerTouchStart, { passive: true });
      container.addEventListener('touchend', handleContainerTouchEnd, { passive: true });
    }

    return () => {
      void recordPlaybackOnUnmount();
      // Notify parent that video player is no longer active
      onPlayerVisibilityChange?.(false);
      if (container) {
        container.removeEventListener('touchstart', handleContainerTouchStart);
        container.removeEventListener('touchend', handleContainerTouchEnd);
      }
    };
  }, [videoId]);
  
  // Restore like state from favoritesCache when videoId is available (persists when leaving/returning)
  useEffect(() => {
    if (videoId && isAuthenticated) {
      setIsLiked(favoritesCache.isVideoFavorited(videoId));
    } else if (!isAuthenticated) {
      setIsLiked(false);
    }
  }, [videoId, isAuthenticated]);

  // Restore follow state from followsCache when creator id is available (persists when leaving/returning)
  useEffect(() => {
    if (videoData?.creator?.id && isAuthenticated) {
      setIsFollowingCreator(followsCache.isFollowing(videoData.creator.id));
    } else if (!isAuthenticated) {
      setIsFollowingCreator(false);
    }
  }, [videoData?.creator?.id, isAuthenticated]);

  useEffect(() => {
    if (videoData && isAuthenticated) {
      checkFollowingStatus();
      checkLikeStatus();
    }
  }, [videoData, isAuthenticated]);

  useEffect(() => {
    const creatorId = videoData?.creator?.id;
    if (!creatorId) return;

    const channel = supabase
      .channel(`user_follows:${creatorId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_follows',
          filter: `following_id=eq.${creatorId}`
        },
        async () => {
      try {
        const { getFollowerCount } = await import('../../lib/supabase');
            const newCount = await getFollowerCount(creatorId);
            setVideoData(prev => prev ? {
              ...prev,
              creator: {
                ...prev.creator,
                followerCount: newCount
              }
            } : null);
          } catch (error) {
            logger.error('VideoPlayerScreen: Error refreshing follower count', error);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [videoData?.creator?.id]);

  useEffect(() => {
    // Auto-hide controls after 3 seconds of inactivity
    if (showControls && isPlaying) {
      const timer = setTimeout(() => {
        setShowControls(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [showControls, isPlaying]);

  const checkAuthAndLoadData = async () => {
    try {
      setError(null);

      // Try optimized cache first for instant display
      const cachedData = await fetchOptimizedVideo(videoId!);
      if (cachedData && cachedData.video) {
        // Immediately show video - don't wait for anything else
        setVideoData(cachedData.video);
        setIsLoading(false);
        
        // Show cached related videos if available
        if (cachedData.relatedVideos?.length) {
          setRelatedVideos(cachedData.relatedVideos);
          setIsLoadingRelated(false);
        }

        // Cache in our video cache
        videoCache.set(videoId!, {
          ...cachedData.video,
          relatedVideos: cachedData.relatedVideos || [],
        });

        // Load cached like state immediately (no await). Fall back to favoritesCache when leaving/returning.
        const cachedLikeState = videoCache.getLikeState(videoId!);
        if (cachedLikeState) {
          setLikesCount(cachedLikeState.likesCount);
          setIsLiked(cachedLikeState.isLiked);
        } else {
          setIsLiked(favoritesCache.isVideoFavorited(videoId!));
        }

        // Defer secondary data to next tick so video displays immediately
        Promise.resolve().then(() => {
          if (user) {
            Promise.all([
              getClipLikesCount(videoId!),
              isClipLiked(videoId!)
            ]).then(([likesCount, liked]) => {
              setLikesCount(likesCount);
              setIsLiked(liked);
              videoCache.setLikeState(videoId!, liked, likesCount);
            }).catch(err => console.error('Error loading interactions:', err));
          }
          loadCommentsLite();
          if (!cachedData.relatedVideos?.length) {
            loadRelatedVideosInBackground(cachedData.video.creator.id);
          }
        });

        backgroundPrefetcher.prefetchVideoData(videoId!);
        return;
      }

      // No cache - fetch fresh data
      let video: any;
      try {
        video = await getVideoDetails(videoId!);
      setVideoData(video);
        setIsLoading(false); // Show video immediately
      } catch (videoError) {
        logger.error('Failed to load video', videoError);
        setError(videoError instanceof Error ? videoError.message : 'Video not found');
      setIsLoading(false);
        return;
      }
      
      // Defer non-critical data to next tick so video displays immediately
      Promise.resolve().then(() => {
        loadRelatedVideosInBackground(video.creator.id);
        loadVideoInteractions().catch(err =>
          logger.warn('Failed to load video interactions', err)
        );
        loadCommentsLite();
      });

      // Cache the loaded data
      videoCache.set(videoId!, { ...video, relatedVideos: [] });

    } catch (err) {
      logger.error('Error loading video data', err);
      setError(err instanceof Error ? err.message : 'Failed to load video');
      setIsLoading(false);
    }
  };

  // Load related videos in background without blocking
  const loadRelatedVideosInBackground = async (creatorId: string) => {
    try {
      setIsLoadingRelated(true);
      const videos = await videoRecommendationService.getRecommendations(
        videoId!,
        creatorId,
        user?.id || null,
        6
      );
      setRelatedVideos(videos);
    } catch (error) {
      logger.warn('Failed to load recommendations', error);
      setRelatedVideos([]);
    } finally {
      setIsLoadingRelated(false);
    }
  };
  
  // Lite version of loadComments - skip individual like queries for speed
  const loadCommentsLite = async () => {
    if (!videoId) return;

    try {
      const fetchedComments = await getClipComments(videoId);
      // Set comments without individual likes - much faster
      // Likes will be loaded on-demand when user expands comments
      setComments(fetchedComments.map((c: Comment) => ({ ...c, likes_count: 0, is_liked: false })));
    } catch (error) {
      logger.error('Error loading comments', error);
    }
  };

  const loadVideoInteractions = async () => {
    if (!videoId) return;

    try {
      const currentLikesCount = await getClipLikesCount(videoId);
      setLikesCount(currentLikesCount);

      if (isAuthenticated) {
        const liked = await isClipLiked(videoId);
        setIsLiked(liked);
      }
    } catch (error) {
      console.error('Error loading video interactions:', error);
    }
  };

  const loadComments = async () => {
    if (!videoId) return;

    try {
      const fetchedComments = await getClipComments(videoId);

      // Load likes count and status for each comment
      const commentsWithLikes = await Promise.all(
        fetchedComments.map(async (comment: Comment) => {
          try {
            const { data: likesData } = await supabase.rpc('get_comment_likes_count', { comment_uuid: comment.id });
            const likesCount = likesData || 0;

            let isLiked = false;
            if (isAuthenticated) {
              const { data: likedData } = await supabase.rpc('is_comment_liked_by_user', { comment_uuid: comment.id });
              isLiked = likedData || false;
            }

            return { ...comment, likes_count: likesCount, is_liked: isLiked };
          } catch (err) {
            console.error('Error loading comment likes:', err);
            return { ...comment, likes_count: 0, is_liked: false };
          }
        })
      );

      setComments(commentsWithLikes);
    } catch (error) {
      console.error('Error loading comments:', error);
    }
  };

  const checkFollowingStatus = async () => {
    if (!videoData?.creator.id || !isAuthenticated) return;

    try {
      const following = await isFollowing(videoData.creator.id);
      setIsFollowingCreator(following);
    } catch (error) {
      console.error('Error checking following status:', error);
    }
  };

  const checkLikeStatus = async () => {
    if (!videoId || !isAuthenticated) return;

    try {
      const liked = await isClipLiked(videoId);
      const likesCount = await getClipLikesCount(videoId);
      setIsLiked(liked);
      setLikesCount(likesCount);
    } catch (error) {
      console.error('Error checking like status:', error);
    }
  };

  const recordPlaybackOnUnmount = async () => {
    const id = playbackVideoIdRef.current;
    if (!videoRef.current || !playbackStartTime || hasRecordedPlaybackRef.current || !id) {
      return;
    }
    // Use ceil to avoid under-counting by ~1s due to event timing.
    const durationListened = Math.max(0, Math.ceil((Date.now() - playbackStartTime) / 1000));
    await recordPlayback(id, durationListened, true, false, session ?? undefined);
    hasRecordedPlaybackRef.current = true;
    // Reset timing so a later resume starts a fresh measurement window.
    setPlaybackStartTime(null);
  };

  const handleContainerTouchStart = (e: TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  };

  const handleContainerTouchEnd = (e: TouchEvent) => {
    if (touchStartY === null) return;

    const touchEndY = e.changedTouches[0].clientY;
    const deltaY = touchEndY - touchStartY;

    // Threshold for swipe detection (100px)
    if (deltaY > 100) {
      // Swipe down - close video
      handleClose();
    }

    setTouchStartY(null);
  };

  const handleClose = () => {
    void recordPlaybackOnUnmount();
    // Notify parent that video player is closing
    onPlayerVisibilityChange?.(false);
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const handleVideoClick = () => {
    setShowControls(true);
    togglePlayPause();
  };

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    // Use media element truth as source-of-truth to avoid UI/state desync.
    if (!video.paused && !video.ended) {
      video.pause();
    } else {
      const attemptPlay = () => {
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {})
            .catch(err => {
              logger.error('Error playing video', err);
              setError('Failed to play video. Please try again.');
            });
        }
      };

      if (video.readyState === 0) {
        video.load();
        video.addEventListener('canplay', attemptPlay, { once: true });
      } else {
        attemptPlay();
      }

      if (!playbackStartTime) {
        setPlaybackStartTime(Date.now());
      }
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    const t = video.currentTime;
    setCurrentTime(t);

    const dur = video.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    if (relatedVideos.length === 0) return;
    if (hasPreparedRewardedNextRef.current) return;

    const remaining = dur - t;
    // Last ~15s or 10% of duration; cap so very short clips do not prepare at the start.
    const threshold = Math.min(15, Math.max(4, dur * 0.1), dur * 0.5);
    if (remaining > 0 && remaining <= threshold) {
      hasPreparedRewardedNextRef.current = true;
      void admobService.prepareRewardedAd(REWARDED_VIDEO_BEFORE_NEXT_KEY);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      const { videoWidth, videoHeight } = videoRef.current;
      setIsPortraitVideo(videoHeight > videoWidth);
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
    hasRecordedPlaybackRef.current = false;
    if (!playbackStartTime) {
      setPlaybackStartTime(Date.now());
    }
  };

  const handlePause = () => {
    setIsPlaying(false);
    void recordPlaybackOnUnmount();
  };

  const handleEnded = async () => {
    setIsPlaying(false);
    await recordPlaybackOnUnmount();
    setPlaybackStartTime(null);

    if (relatedVideos.length > 0) {
      const nextVideo = relatedVideos[0];
      try {
        await admobService.showRewardedAd(videoId!, 'video', REWARDED_VIDEO_BEFORE_NEXT_KEY);
      } catch {
        // Dismissal or load failure — still advance Watch Next.
      }
      handleVideoChange(nextVideo.id);
      return;
    }

    // No auto-next: optional bonus rewarded after every 2 completions (manual engagement).
    completedVideosSinceBonusRef.current += 1;
    if (completedVideosSinceBonusRef.current >= 2) {
      completedVideosSinceBonusRef.current = 0;
      setShowBonusPrompt(true);
    }
  };

  const handleProgressClick = (e: React.MouseEvent | MouseEvent) => {
    if (!videoRef.current || !progressRef.current) return;

    const rect = progressRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;

    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleProgressDrag = (e: MouseEvent) => {
    if (!videoRef.current || !progressRef.current) return;

    const rect = progressRef.current.getBoundingClientRect();
    const dragX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, dragX / rect.width));
    const newTime = percentage * duration;

    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleBonusClick = async () => {
    if (!videoId) {
      setShowBonusPrompt(false);
      return;
    }
    setShowBonusPrompt(false);
    try {
      await showRewarded('after_video_play_rewarded', {
        contentId: videoId,
        contentType: 'video',
      });
    } catch {
      // Ignore failures; playback and navigation must remain smooth.
    }
  };
  
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();

    // Attach global event listeners for smooth dragging
    const handleMouseMove = (e: MouseEvent) => {
      handleProgressDrag(e);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Handle initial click
    handleProgressClick(e);
  };

  const handleProgressTouch = (e: TouchEvent | React.TouchEvent) => {
    if (!videoRef.current || !progressRef.current || e.touches.length === 0) return;

    const rect = progressRef.current.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, touchX / rect.width));
    const newTime = percentage * duration;

    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };
  
  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Attach global event listeners for smooth touch dragging
    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      handleProgressTouch(e);
    };

    const handleTouchEnd = () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    // Handle initial touch
    handleProgressTouch(e);
  };

  const handleFullscreen = () => {
    if (!videoRef.current) return;

    if (videoRef.current.requestFullscreen) {
      videoRef.current.requestFullscreen();
    }
  };

  const handleQualityChange = (quality: '360p' | '480p' | '720p' | '1080p' | 'auto') => {
    setSelectedQuality(quality);
    setShowQualityMenu(false);

    if (quality === 'auto') {
      setQuality(-1);
    } else {
      const qualityMap: Record<string, number> = {
        '360p': 0,
        '480p': 1,
        '720p': 2,
        '1080p': 3,
      };
      const level = qualityMap[quality] ?? -1;
      setQuality(level);
    }
  };

  const handleLikeToggle = useCallback(async () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    const previousLikedState = isLiked;
    const previousLikesCount = likesCount;
    const newLikedState = !isLiked;
    const newLikesCount = newLikedState ? likesCount + 1 : Math.max(0, likesCount - 1);

    setIsLiked(newLikedState);
    setLikesCount(newLikesCount);

    // Update cache immediately
    videoCache.setLikeState(videoId!, newLikedState, newLikesCount);

    toggleClipLike(videoId!).then(() => {
      // Track engagement contribution when user likes content
      if (newLikedState && !previousLikedState) {
        recordContribution('video_like', videoId!, 'video').catch(console.error);
      }
    }).catch(error => {
      setIsLiked(previousLikedState);
      setLikesCount(previousLikesCount);
      // Revert cache on error
      videoCache.setLikeState(videoId!, previousLikedState, previousLikesCount);
      console.error('Error toggling like:', error);
    });
  }, [isAuthenticated, isLiked, likesCount, videoId]);

  const handleFollowToggle = async () => {
    if (!videoData?.creator.id) return;

    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    setIsLoadingFollow(true);
    try {
      if (isFollowingCreator) {
        await unfollowUser(videoData.creator.id);
        setIsFollowingCreator(false);
      } else {
        await followUser(videoData.creator.id);
        setIsFollowingCreator(true);
        // Track artist follow for contribution rewards
        recordContribution('artist_follow', videoData.creator.id, 'artist').catch(console.error);
      }

      const { getFollowerCount } = await import('../../lib/supabase');
      const newCount = await getFollowerCount(videoData.creator.id);
      setVideoData(prev => prev ? {
        ...prev,
        creator: {
          ...prev.creator,
          followerCount: newCount
        }
      } : null);
    } catch (error) {
      console.error('Error toggling follow:', error);
      alert('Failed to update follow status.');
    } finally {
      setIsLoadingFollow(false);
    }
  };

  const handleTipSuccess = () => {
    setShowTippingModal(false);
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    setIsSubmittingComment(true);
    try {
      await addClipComment(videoId!, newComment.trim());
      setNewComment('');
      // Reset textarea height after clearing
      if (newCommentRef.current) {
        newCommentRef.current.style.height = 'auto';
      }
      await loadComments();
    } catch (error) {
      console.error('Error adding comment:', error);
      alert('Failed to add comment');
    } finally {
      setIsSubmittingComment(false);
    }
  };
  
  const handleReplyToComment = async (parentCommentId: string) => {
    if (!replyText.trim()) return;

    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    setIsSubmittingComment(true);
    try {
      await addClipComment(videoId!, replyText.trim(), parentCommentId);
      setReplyingTo(null);
      setReplyText('');
      await loadComments();
    } catch (error) {
      console.error('Error replying to comment:', error);
      alert('Failed to add reply');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleToggleCommentLike = async (commentId: string) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    if (likingComments.has(commentId)) return;

    setLikingComments(prev => new Set([...prev, commentId]));

    try {
      const comment = comments.find(c => c.id === commentId);
      if (!comment) return;

      if (comment.is_liked) {
        await supabase
          .from('comment_likes')
          .delete()
          .eq('comment_id', commentId);
      } else {
        await supabase
          .from('comment_likes')
          .insert({ comment_id: commentId });
      }

      // Update local state
      setComments(prevComments =>
        prevComments.map(c =>
          c.id === commentId
            ? {
                ...c,
                is_liked: !c.is_liked,
                likes_count: (c.likes_count || 0) + (c.is_liked ? -1 : 1)
              }
            : c
        )
      );
    } catch (error) {
      console.error('Error toggling comment like:', error);
      alert('Failed to update like status');
    } finally {
      setLikingComments(prev => {
        const newSet = new Set(prev);
        newSet.delete(commentId);
        return newSet;
      });
    }
  };

  const handleEditComment = (commentId: string, currentText: string) => {
    setEditingCommentId(commentId);
    setEditingCommentText(currentText);
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditingCommentText('');
  };

  const handleSaveEdit = async (commentId: string) => {
    if (!editingCommentText.trim()) return;

    try {
      setIsSubmittingComment(true);
      const updatedComment = await updateClipComment(commentId, editingCommentText.trim());

      // Update local state
      setComments(prevComments =>
        prevComments.map(c =>
          c.id === commentId
            ? { ...c, comment_text: updatedComment.comment_text }
            : c
        )
      );

      setEditingCommentId(null);
      setEditingCommentText('');
    } catch (error) {
      console.error('Error updating comment:', error);
      alert('Failed to update comment');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    const confirmed = await confirm({
      title: 'Delete Comment',
      message: 'Are you sure you want to delete this comment? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });

    if (!confirmed) return;

    try {
      await deleteClipComment(commentId);

      // Remove from local state
      setComments(prevComments =>
        prevComments.filter(c => c.id !== commentId)
      );
    } catch (error) {
      console.error('Error deleting comment:', error);
      alert('Failed to delete comment');
    }
  };

  const handleShare = () => {
    if (!videoData) return;
    shareVideo(videoId!, videoData.title).catch((error) => {
      console.error('Error sharing video:', error);
    });
    recordShareEvent(videoId!, 'video').catch((error) => {
      console.error('Error recording share event:', error);
    });
    recordContribution('content_share', videoId!, 'video').catch(console.error);
  };

  const handleVideoChange = async (newVideoId: string) => {
    // Record playback for current video
    await recordPlaybackOnUnmount();
    
    // Navigate to new video
    navigate(`/video/${newVideoId}`, { replace: true });
  };
  
  const autoResizeTextarea = (textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 80) + 'px';
  };

  useEffect(() => {
    autoResizeTextarea(newCommentRef.current);
  }, [newComment]);

  const formatTime = useCallback((time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  const formatNumber = useCallback((num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }, []);

  const displayedComments = useMemo(() => {
    return showAllComments ? comments : comments.slice(0, 1);
  }, [showAllComments, comments]);
  const canSubmitComment = newComment.trim().length > 0 && !isSubmittingComment;

  if (!isLoading && (error || !videoData)) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 bg-[#0a0a0a]"
        style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        <Card className="w-full max-w-sm bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl overflow-hidden">
          <CardContent className="p-8 text-center">
            <h2 className="text-white font-bold text-xl mb-3">Video not found</h2>
            <p className="text-white/70 text-sm mb-6 leading-relaxed">
              {error || 'This video may have been removed or is no longer available.'}
            </p>
            <button
              onClick={handleClose}
              className="min-h-[48px] px-8 py-3 bg-gradient-to-r from-[#309605] to-[#3ba208] rounded-xl font-semibold text-white transition-all active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#309605] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              aria-label="Go back"
            >
              Go back
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No second loading screen: while fetching video data, show same loader as route (Suspense) for one continuous load
  if (!videoData) {
  return (
      <div className="fixed inset-0 z-50 bg-gradient-to-b from-[#0a0a0a] via-[#0d0d0d] to-[#111111] flex items-center justify-center">
        <div className="relative">
          <img
            src="/official_airaplay_logo.png"
            alt="Loading"
            className="w-32 h-32 object-contain drop-shadow-2xl"
            style={{ animation: 'breathe 3s ease-in-out infinite' }}
          />
          <div className="absolute inset-0 -z-10 blur-3xl opacity-30 bg-white scale-75 animate-pulse" />
            </div>
        <style>{`
          @keyframes breathe {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.05); opacity: 0.9; }
          }
          
          @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
          
          .animate-shimmer {
            animation: shimmer 2s infinite;
          }
        `}</style>
          </div>
    );
  }

  const shouldUsePortraitLayout = isPortraitVideo || isPortraitHint;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a] animate-in fade-in duration-300 touch-manipulation overflow-hidden pb-[env(safe-area-inset-bottom,0px)]"
      onMouseMove={() => setShowControls(true)}
    >
      {/* Header — matches MusicPlayerScreen: solid bg, equal-width columns, same typography */}
      <header className="flex-shrink-0 z-20 bg-[#0a0a0a]" style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)', paddingBottom: '1.25rem' }}>
        <div className="flex flex-row items-center px-3 py-1 min-h-[40px]">
          <div className="w-[72px] flex items-center justify-start">
            <button
              onClick={handleClose}
              className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all active:scale-95"
              aria-label="Close player"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div
            className="flex-1 flex items-center justify-center gap-2 min-w-0 cursor-pointer active:scale-95 transition-transform"
            onClick={() => {
              if (videoData.creator?.id) {
                handleClose();
                navigate(`/user/${videoData.creator.id}`);
              }
            }}
          >
            <Avatar className="w-8 h-8 flex-shrink-0">
              <AvatarImage src={videoData.creator?.avatar || undefined} />
              <AvatarFallback className="bg-[#00ad74] text-white font-semibold text-xs">
                {(videoData.creator?.name ?? 'C').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 text-left">
              <h3 className="font-bold text-white text-sm truncate leading-tight">
                {videoData.creator?.name ?? 'Creator'}
              </h3>
              <p className="text-white/60 text-[11px] truncate">
                {formatNumber(videoData.creator?.followerCount ?? 0)} followers
              </p>
            </div>
          </div>

          <div className="w-[72px] flex items-center justify-end">
            {videoData.creator?.id && user?.id !== videoData.creator.id ? (
              <button
                onClick={handleFollowToggle}
                disabled={isLoadingFollow}
                aria-label={isAuthenticated && isFollowingCreator ? "Unfollow creator" : "Follow creator"}
                className="inline-flex items-center justify-center px-3 py-1.5 rounded-full font-semibold text-[11px] bg-white text-[#0a0a0a] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingFollow ? (
                  <Spinner size={12} className="text-[#0a0a0a]" />
                ) : (
                  isAuthenticated && isFollowingCreator ? 'Following' : 'Follow'
                )}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {/* Main Content — scrollable; bottom padding clears app nav/mini player (native AdMob banner is overlaid, not in layout — do not double-reserve) */}
      <div
        className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide"
        style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* Video — responsive height */}
        <div
          className={`relative w-full bg-black flex items-center justify-center shrink-0 ${
            shouldUsePortraitLayout
              ? 'mx-auto aspect-[9/16] h-auto max-w-[420px] min-h-[320px] max-h-[60dvh]'
              : 'min-h-[200px] h-[40dvh] max-h-[52dvh] sm:h-[45dvh] sm:max-h-[56dvh]'
          }`}
          onClick={handleVideoClick}
        >
        {videoData.videoUrl ? (
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          playsInline
            poster={videoData.thumbnailUrl ? getOptimizedImageUrl(videoData.thumbnailUrl, shouldUsePortraitLayout ? { width: 360, height: 640, quality: 75, format: 'webp' } : { width: 640, height: 360, quality: 75, format: 'webp' }) : undefined}
            crossOrigin="anonymous"
            preload="auto"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
            onError={(e) => {
              console.error('Video playback error:', e);
              console.error('Video element state:', {
                readyState: videoRef.current?.readyState,
                networkState: videoRef.current?.networkState,
                currentSrc: videoRef.current?.currentSrc
              });
              setError('Failed to load video. Please check your connection and try again.');
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <div className="text-center">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Play className="w-8 h-8 text-white/60" />
          </div>
              <p className="text-white/60 text-sm">Video not available</p>
            </div>
          </div>
        )}

        {/* Premium Play overlay with glassmorphism */}
        {videoData.videoUrl && !isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/40 via-black/20 to-black/40 pointer-events-none backdrop-blur-sm" aria-hidden>
            <div className="relative group">
              {/* Animated glow ring */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#309605] via-[#3ba208] to-[#309605] opacity-40 blur-2xl animate-pulse scale-110"></div>
              
              {/* Main play button with glassmorphism */}
              <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-white/10 backdrop-blur-xl border-2 border-white/30 flex items-center justify-center shadow-2xl">
                {/* Inner gradient circle */}
                <div className="absolute inset-2 rounded-full bg-gradient-to-br from-white via-white/95 to-white/90"></div>
                
                {/* Play icon */}
                <Play className="relative w-9 h-9 sm:w-11 sm:h-11 text-[#0a0a0a] ml-1 drop-shadow-lg" strokeWidth={2.5} />
                
                {/* Shine effect */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/40 to-transparent opacity-50"></div>
              </div>
            </div>
          </div>
        )}

        {/* Premium Video Controls with Glassmorphism */}
        {videoData.videoUrl && (
          <div
            className={`absolute bottom-0 left-0 right-0 transition-all duration-500 ease-out ${
              showControls 
                ? 'opacity-100 translate-y-0' 
                : 'opacity-0 translate-y-4 pointer-events-none'
            }`}
          >
            {/* Gradient backdrop with blur */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/95 to-transparent backdrop-blur-md"></div>
            
            {/* Content */}
            <div className="relative px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {/* Optional bonus reward prompt */}
              {showBonusPrompt && (
                <div className="mb-4 animate-in slide-in-from-bottom-4 duration-300">
                  <div className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-[#309605]/20 via-[#3ba208]/20 to-[#309605]/20 backdrop-blur-xl border border-[#309605]/30 px-4 py-3 shadow-xl">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-bold text-white drop-shadow-sm">Earn Bonus Treats</span>
                      <span className="text-xs text-white/80">Watch a quick ad to unlock rewards</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleBonusClick}
                      className="px-5 py-2.5 rounded-full bg-gradient-to-r from-white via-white to-white/95 text-sm font-bold text-[#0a0a0a] active:scale-95 hover:shadow-lg transition-all shadow-md"
                    >
                      Claim
                    </button>
                  </div>
                </div>
              )}

              {/* Progress Bar with enhanced styling */}
              <div
                ref={progressRef}
                className="relative w-full py-3 -my-2 cursor-pointer touch-none select-none group mb-3"
                onClick={handleProgressClick}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                role="slider"
                aria-valuemin={0}
                aria-valuemax={duration || 100}
                aria-valuenow={currentTime}
                aria-label="Video progress"
              >
                {/* Background track */}
                <div className="h-1 bg-white/20 rounded-full overflow-hidden backdrop-blur-sm">
                  {/* Buffered/loaded indicator */}
                  <div className="absolute h-full w-full bg-white/10 rounded-full"></div>
                  
                  {/* Progress fill with gradient */}
                  <div
                    className="h-full bg-gradient-to-r from-[#309605] via-[#3ba208] to-[#309605] rounded-full transition-all duration-100 relative overflow-hidden"
                    style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                  >
                    {/* Shine effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
                  </div>
                </div>
                
                {/* Enhanced thumb with glow */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 transition-all duration-100 pointer-events-none"
                  style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`, transform: 'translate(-50%, -50%)' }}
                >
                  {/* Glow effect */}
                  <div className="absolute inset-0 w-5 h-5 bg-[#309605] rounded-full blur-md opacity-60 scale-150"></div>
                  
                  {/* Main thumb */}
                  <div className="relative w-4 h-4 bg-white rounded-full shadow-xl ring-2 ring-black/20 group-hover:scale-125 transition-transform"></div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                {/* Left controls */}
                <div className="flex items-center gap-3 min-w-0">
                  {/* Premium Play/Pause button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlayPause();
                    }}
                    className="relative min-w-[48px] min-h-[48px] flex items-center justify-center rounded-full bg-gradient-to-br from-white/25 via-white/20 to-white/15 backdrop-blur-md border border-white/30 hover:from-white/30 hover:via-white/25 hover:to-white/20 active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl group"
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                  >
                    {/* Inner glow */}
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    
                    {isPlaying ? (
                      <Pause className="relative w-5 h-5 text-white shrink-0 drop-shadow-md" strokeWidth={2.5} />
                    ) : (
                      <Play className="relative w-5 h-5 text-white ml-0.5 shrink-0 drop-shadow-md" strokeWidth={2.5} />
                    )}
                  </button>
                  
                  {/* Time display with better typography */}
                  <span className="text-white text-sm font-medium tabular-nums truncate drop-shadow-sm">
                    {formatTime(currentTime)} <span className="text-white/50">/</span> {formatTime(duration)}
                  </span>
                </div>

                {/* Right controls */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Quality button with enhanced styling */}
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowQualityMenu(!showQualityMenu);
                      }}
                      className="min-w-[48px] min-h-[48px] flex items-center justify-center gap-1.5 rounded-full bg-gradient-to-br from-white/25 via-white/20 to-white/15 backdrop-blur-md border border-white/30 hover:from-white/30 hover:via-white/25 hover:to-white/20 active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl px-3"
                      aria-label="Quality settings"
                      aria-expanded={showQualityMenu}
                    >
                      <Settings className="w-4 h-4 text-white shrink-0 drop-shadow-md" strokeWidth={2.5} />
                      <span className="text-xs text-white font-semibold max-sm:hidden drop-shadow-sm">{selectedQuality}</span>
                    </button>
                    
                    {showQualityMenu && (
                      <div className="absolute bottom-full right-0 mb-3 animate-in slide-in-from-bottom-2 fade-in duration-200">
                        <div className="bg-black/95 backdrop-blur-2xl rounded-2xl overflow-hidden shadow-2xl border border-white/20 min-w-[140px]">
                          {availableQualities.map((quality, index) => (
                            <button
                              key={quality}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQualityChange(quality as any);
                              }}
                              className={`w-full min-h-[48px] px-4 py-3 text-left text-sm font-medium transition-all ${
                                index === 0 ? 'rounded-t-2xl' : ''
                              } ${
                                index === availableQualities.length - 1 ? 'rounded-b-2xl' : ''
                              } ${
                                selectedQuality === quality
                                  ? 'bg-gradient-to-r from-[#309605] to-[#3ba208] text-white shadow-lg'
                                  : 'text-white/90 hover:bg-white/10 active:bg-white/15'
                              }`}
                            >
                              <span className="drop-shadow-sm">{quality === 'auto' ? 'Auto (HLS)' : quality}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Fullscreen button with enhanced styling */}
                  <button
                    onClick={handleFullscreen}
                    className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-full bg-gradient-to-br from-white/25 via-white/20 to-white/15 backdrop-blur-md border border-white/30 hover:from-white/30 hover:via-white/25 hover:to-white/20 active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl"
                    aria-label="Full screen"
                  >
                    <Maximize className="w-4 h-4 text-white shrink-0 drop-shadow-md" strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

        {/* Content */}
        <div className="flex-1 flex flex-col px-4 pt-0 pb-4">
          <div className="py-5 space-y-5">
            {/* Title & meta */}
            <div className="space-y-2.5">
              <h1 className="text-white font-bold text-base sm:text-lg leading-tight line-clamp-3">
                {videoData.title}
              </h1>
              <div className="flex items-center gap-4 text-white/60 text-xs">
                <span className="flex items-center gap-1.5">
                  <Eye className="w-4 h-4 shrink-0" aria-hidden />
                  {formatNumber(videoData.playCount)} views
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 shrink-0" aria-hidden />
                  {videoData.createdAt ? formatDistanceToNowStrict(new Date(videoData.createdAt), { addSuffix: true }) : ''}
                </span>
              </div>

              {/* Action bar — full bleed, equal-width pills with gap between */}
              <div className="-mx-4 flex w-[calc(100%+2rem)] min-h-[36px] gap-2">
                <button
                  type="button"
                  onClick={handleLikeToggle}
                  aria-label={isLiked ? 'Unlike' : 'Like'}
                  aria-pressed={isLiked}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full bg-[#272727] px-2 py-2 text-white ring-1 ring-white/10 transition-colors active:scale-[0.98] hover:bg-[#3a3a3a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 ${
                    isLiked ? 'ring-white/20' : ''
                  }`}
                >
                  <ThumbsUp
                    className={`h-4 w-4 shrink-0 ${isLiked ? 'fill-white text-white' : 'text-white'}`}
                    strokeWidth={isLiked ? 0 : 1.75}
                  />
                  <span className="truncate text-xs font-medium tabular-nums leading-none">
                    {formatNumber(likesCount)}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleShare}
                  aria-label="Share"
                  className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full bg-[#272727] px-2 py-2 text-white ring-1 ring-white/10 transition-colors active:scale-[0.98] hover:bg-[#3a3a3a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                >
                  <Share2 className="h-4 w-4 shrink-0 text-white" strokeWidth={1.75} />
                  <span className="truncate text-xs font-medium leading-none">Share</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!isAuthenticated) {
                      setShowAuthModal(true);
                      return;
                    }
                    setShowTippingModal(true);
                  }}
                  aria-label="Send a treat"
                  className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full bg-[#272727] px-2 py-2 text-white ring-1 ring-white/10 transition-colors active:scale-[0.98] hover:bg-[#3a3a3a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                >
                  <Gift className="h-4 w-4 shrink-0 text-white" strokeWidth={1.75} />
                  <span className="truncate text-xs font-medium leading-none">Treat</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowReportModal(true)}
                  aria-label="Report"
                  className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full bg-[#272727] px-2 py-2 text-white ring-1 ring-white/10 transition-colors active:scale-[0.98] hover:bg-[#3a3a3a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                >
                  <Flag className="h-4 w-4 shrink-0 text-white" strokeWidth={1.75} />
                  <span className="truncate text-xs font-medium leading-none">Report</span>
                </button>
              </div>

              {/* Description */}
              {videoData.description && (
                <p className="text-white/70 text-sm leading-relaxed line-clamp-4">
                  {videoData.description}
                </p>
              )}
              </div>

            {/* Tabs - Comments & Watch Next (44px min height, accessible) */}
                  <div className="space-y-4">
              <div
                className="flex border-b border-white/10"
                role="tablist"
                aria-label="Comments and Watch Next"
              >
                <button
                  role="tab"
                  aria-selected={activeTab === 'comments'}
                  aria-controls="comments-panel"
                  id="tab-comments"
                  onClick={() => setActiveTab('comments')}
                  className={`flex-1 flex items-center justify-center gap-2 min-h-[48px] text-sm font-semibold transition-colors relative focus-visible:ring-2 focus-visible:ring-[#309605] focus-visible:ring-inset ${
                    activeTab === 'comments'
                      ? 'text-white'
                      : 'text-white/50 hover:text-white/70 active:text-white/80'
                  }`}
                >
                  <MessageCircle className="w-4 h-4 shrink-0" aria-hidden />
                  <span>Comments</span>
                  <span className="tabular-nums">({comments.length})</span>
                  {activeTab === 'comments' && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#309605]" aria-hidden />
                  )}
                </button>
                <button
                  role="tab"
                  aria-selected={activeTab === 'watchNext'}
                  aria-controls="watchnext-panel"
                  id="tab-watchnext"
                  onClick={() => setActiveTab('watchNext')}
                  className={`flex-1 flex items-center justify-center gap-2 min-h-[48px] text-sm font-semibold transition-colors relative focus-visible:ring-2 focus-visible:ring-[#309605] focus-visible:ring-inset ${
                    activeTab === 'watchNext'
                      ? 'text-white'
                      : 'text-white/50 hover:text-white/70 active:text-white/80'
                  }`}
                >
                  <Play className="w-4 h-4 shrink-0" aria-hidden />
                  <span>Watch Next</span>
                  {activeTab === 'watchNext' && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#309605]" aria-hidden />
                  )}
                </button>
              </div>

              {/* Tab panels */}
              <div id="comments-panel" role="tabpanel" aria-labelledby="tab-comments" className="min-h-[280px]" hidden={activeTab !== 'comments'}>
                {activeTab === 'comments' && (
                  <div className="space-y-4">
                    {/* Comment input - 44px min height, clear focus */}
                    {isAuthenticated && (
                      <form onSubmit={handleAddComment} className="flex items-end">
                        <div className="w-full flex items-center gap-2 bg-white/[0.08] rounded-2xl border border-white/10 px-4 min-h-[48px] focus-within:border-[#309605]/50 focus-within:ring-1 focus-within:ring-[#309605]/30 transition-colors">
                          <textarea
                            ref={newCommentRef}
                            value={newComment}
                            onChange={(e) => setNewComment(e.target.value)}
                            placeholder="Add a comment..."
                            rows={1}
                            aria-label="Comment"
                            maxLength={500}
                            className="flex-1 bg-transparent text-white text-sm placeholder-white/40 focus:outline-none resize-none py-3 max-h-[100px] leading-relaxed overflow-auto"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (canSubmitComment) {
                                  (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                                }
                              }
                            }}
                          />
                          <button
                            type="submit"
                            disabled={!canSubmitComment}
                            aria-label="Send comment"
                            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-white disabled:bg-white/15 disabled:cursor-not-allowed active:scale-95 transition-all self-end mb-0.5"
                          >
                            {isSubmittingComment ? (
                              <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5 text-black" />
                            )}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Comments list */}
                      <div className="space-y-3">
                      {comments.length === 0 ? (
                        <div className="text-center py-12 px-4">
                          <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3">
                            <MessageCircle className="w-7 h-7 text-white/30" aria-hidden />
                          </div>
                          <p className="text-white/80 font-medium text-sm mb-0.5">No comments yet</p>
                          <p className="text-white/50 text-xs">Be the first to share your thoughts.</p>
                        </div>
                      ) : (
                        <>
                          {/* First Comment (always shown) */}
                          {comments[0] && (
                            <div className="flex items-start gap-3 p-3 bg-white/5 rounded-xl">
                              <Avatar className="w-8 h-8 flex-shrink-0">
                                <AvatarImage src={getAvatarUrl(comments[0].users?.avatar_url)} />
                                <AvatarFallback className="bg-[#309605] text-white text-xs">
                                  {(comments[0].users?.display_name ?? '').charAt(0) || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-1.5 mb-0.5">
                                  <span className="font-['Inter',sans-serif] font-medium text-white text-xs truncate">
                                    {comments[0].users?.display_name ?? 'Anonymous'}
                                  </span>
                                  <span className="font-['Inter',sans-serif] text-white/40 text-[10px] flex-shrink-0">
                                    {formatDistanceToNowStrict(new Date(comments[0].created_at), { addSuffix: true })}
                                  </span>
                                </div>
                                {editingCommentId === comments[0].id ? (
                                  <div className="space-y-2">
                                    <textarea
                                      value={editingCommentText}
                                      onChange={(e) => setEditingCommentText(e.target.value)}
                                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/50 text-xs focus:outline-none focus:ring-1 focus:ring-[#309605]/50 focus:border-[#309605]/50 resize-none"
                                      rows={3}
                                      autoFocus
                                    />
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => handleSaveEdit(comments[0].id)}
                                        disabled={!editingCommentText.trim() || isSubmittingComment}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-[#309605] hover:bg-[#3ba208] disabled:opacity-50 rounded-full text-white text-xs font-medium"
                                      >
                                        <Check className="w-3 h-3" />
                                        Save
                                      </button>
                                      <button
                                        onClick={handleCancelEdit}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-full text-white text-xs"
                                      >
                                        <XIcon className="w-3 h-3" />
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <p className="font-['Inter',sans-serif] text-white/75 text-xs leading-relaxed break-words">
                                      {comments[0].comment_text}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-1 mt-2">
                                      <button
                                        onClick={() => handleToggleCommentLike(comments[0].id)}
                                        disabled={likingComments.has(comments[0].id)}
                                        className={`min-h-[36px] inline-flex items-center gap-1 px-2.5 rounded-lg text-xs transition-colors ${
                                          comments[0].is_liked ? 'text-red-500' : 'text-white/50 active:text-white hover:bg-white/5'
                                        } disabled:opacity-50`}
                                        aria-label={comments[0].is_liked ? 'Unlike' : 'Like'}
                                      >
                                        <Heart className={`w-3 h-3 shrink-0 ${comments[0].is_liked ? 'fill-red-500' : ''}`} />
                                        <span>{comments[0].likes_count || 0}</span>
                                      </button>
                                      {isAuthenticated && (
                                        <button
                                          onClick={() => {
                                            setReplyingTo(comments[0].id);
                                            setReplyText('');
                                          }}
                                          className="min-h-[36px] px-2.5 rounded-lg text-white/50 active:text-white hover:bg-white/5 text-xs"
                                        >
                                          Reply
                                        </button>
                                      )}
                                      {isAuthenticated && user && comments[0].user_id === user.id && (
                                        <>
                                          <button
                                            onClick={() => handleEditComment(comments[0].id, comments[0].comment_text)}
                                            className="min-h-[36px] inline-flex items-center gap-1 px-2.5 rounded-lg text-white/50 active:text-white hover:bg-white/5 text-xs"
                                          >
                                            <Edit2 className="w-3 h-3 shrink-0" />
                                            Edit
                                          </button>
                                          <button
                                            onClick={() => handleDeleteComment(comments[0].id)}
                                            className="min-h-[36px] inline-flex items-center gap-1 px-2.5 rounded-lg text-red-500/80 active:text-red-500 hover:bg-red-500/10 text-xs"
                                          >
                                            <Trash2 className="w-3 h-3 shrink-0" />
                                            Delete
                                          </button>
                                        </>
                                      )}
                            </div>
                                  </>
                                )}
                                {replyingTo === comments[0].id && (
                                  <div className="flex items-center gap-2 mt-2">
                                    <input
                                      type="text"
                                      value={replyText}
                                      onChange={(e) => setReplyText(e.target.value)}
                                      placeholder="Write a reply..."
                                      className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full text-white placeholder-white/50 text-xs focus:outline-none focus:ring-1 focus:ring-[#309605]/50 focus:border-[#309605]/50"
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => handleReplyToComment(comments[0].id)}
                                      disabled={!replyText.trim() || isSubmittingComment}
                                      className="px-2 py-1 bg-[#309605] hover:bg-[#3ba208] disabled:opacity-50 rounded-full text-white text-[10px] font-medium"
                                    >
                                      Send
                                    </button>
                                    <button
                                      onClick={() => {
                                        setReplyingTo(null);
                                        setReplyText('');
                                      }}
                                      className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded-full text-white text-[10px]"
                                    >
                                      Cancel
                                    </button>
                          </div>
                                )}
                              </div>
                      </div>
                    )}

                          {/* Additional Comments */}
                          {showAllComments && comments.slice(1).map((comment) => (
                            <div key={comment.id} className="flex items-start gap-3 p-3 bg-white/5 rounded-xl">
                              <Avatar className="w-8 h-8 flex-shrink-0">
                                <AvatarImage src={getAvatarUrl(comment.users?.avatar_url)} />
                                <AvatarFallback className="bg-[#309605] text-white text-xs">
                                  {(comment.users?.display_name ?? '').charAt(0) || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-1.5 mb-0.5">
                                  <span className="font-['Inter',sans-serif] font-medium text-white text-xs truncate">
                                    {comment.users?.display_name ?? 'Anonymous'}
                                  </span>
                                  <span className="font-['Inter',sans-serif] text-white/40 text-[10px] flex-shrink-0">
                                    {formatDistanceToNowStrict(new Date(comment.created_at), { addSuffix: true })}
                                  </span>
                                </div>
                                {editingCommentId === comment.id ? (
                                  <div className="space-y-2">
                                    <textarea
                                      value={editingCommentText}
                                      onChange={(e) => setEditingCommentText(e.target.value)}
                                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/50 text-xs focus:outline-none focus:ring-1 focus:ring-[#309605]/50 focus:border-[#309605]/50 resize-none"
                                      rows={3}
                                      autoFocus
                                    />
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => handleSaveEdit(comment.id)}
                                        disabled={!editingCommentText.trim() || isSubmittingComment}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-[#309605] hover:bg-[#3ba208] disabled:opacity-50 rounded-full text-white text-xs font-medium"
                                      >
                                        <Check className="w-3 h-3" />
                                        Save
                                      </button>
                                      <button
                                        onClick={handleCancelEdit}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-full text-white text-xs"
                                      >
                                        <XIcon className="w-3 h-3" />
                                        Cancel
                                      </button>
                                    </div>
                  </div>
                ) : (
                                  <>
                                    <p className="font-['Inter',sans-serif] text-white/75 text-xs leading-relaxed break-words">
                                      {comment.comment_text}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-1 mt-2">
                                      <button
                                        onClick={() => handleToggleCommentLike(comment.id)}
                                        disabled={likingComments.has(comment.id)}
                                        className={`min-h-[36px] inline-flex items-center gap-1 px-2.5 rounded-lg text-xs transition-colors ${
                                          comment.is_liked ? 'text-red-500' : 'text-white/50 active:text-white hover:bg-white/5'
                                        } disabled:opacity-50`}
                                        aria-label={comment.is_liked ? 'Unlike' : 'Like'}
                                      >
                                        <Heart className={`w-3 h-3 shrink-0 ${comment.is_liked ? 'fill-red-500' : ''}`} />
                                        <span>{comment.likes_count || 0}</span>
                                      </button>
                                      {isAuthenticated && (
                                        <button
                                          onClick={() => {
                                            setReplyingTo(comment.id);
                                            setReplyText('');
                                          }}
                                          className="min-h-[36px] px-2.5 rounded-lg text-white/50 active:text-white hover:bg-white/5 text-xs"
                                        >
                                          Reply
                                        </button>
                                      )}
                                      {isAuthenticated && user && comment.user_id === user.id && (
                                        <>
                                          <button
                                            onClick={() => handleEditComment(comment.id, comment.comment_text)}
                                            className="min-h-[36px] inline-flex items-center gap-1 px-2.5 rounded-lg text-white/50 active:text-white hover:bg-white/5 text-xs"
                                          >
                                            <Edit2 className="w-3 h-3 shrink-0" />
                                            Edit
                                          </button>
                                          <button
                                            onClick={() => handleDeleteComment(comment.id)}
                                            className="min-h-[36px] inline-flex items-center gap-1 px-2.5 rounded-lg text-red-500/80 active:text-red-500 hover:bg-red-500/10 text-xs"
                                          >
                                            <Trash2 className="w-3 h-3 shrink-0" />
                                            Delete
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </>
                                )}
                                {replyingTo === comment.id && (
                                  <div className="flex items-center gap-2 mt-2">
                                    <input
                                      type="text"
                                      value={replyText}
                                      onChange={(e) => setReplyText(e.target.value)}
                                      placeholder="Write a reply..."
                                      className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full text-white placeholder-white/50 text-xs focus:outline-none focus:ring-1 focus:ring-[#309605]/50 focus:border-[#309605]/50"
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => handleReplyToComment(comment.id)}
                                      disabled={!replyText.trim() || isSubmittingComment}
                                      className="px-2 py-1 bg-[#309605] hover:bg-[#3ba208] disabled:opacity-50 rounded-full text-white text-[10px] font-medium"
                                    >
                                      Send
                                    </button>
                                    <button
                                      onClick={() => {
                                        setReplyingTo(null);
                                        setReplyText('');
                                      }}
                                      className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded-full text-white text-[10px]"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}

                          {/* View more - 44px touch target */}
                          {comments.length > 1 && (
                            <button
                              onClick={() => setShowAllComments(!showAllComments)}
                              className="w-full min-h-[48px] py-3 text-center text-[#309605] hover:text-[#3ba208] active:bg-white/5 rounded-xl text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-[#309605] focus-visible:ring-inset"
                            >
                              {showAllComments ? 'Show less' : `View ${comments.length - 1} more`}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div id="watchnext-panel" role="tabpanel" aria-labelledby="tab-watchnext" className="min-h-[280px]" hidden={activeTab !== 'watchNext'}>
                {activeTab === 'watchNext' && (
                  <div>
                    {isLoadingRelated ? (
                      <div className="grid grid-cols-2 gap-3">
                        {[1, 2, 3, 4].map((i) => (
                          <Card key={i} className="bg-transparent border border-white/10 overflow-hidden">
                            <CardContent className="p-0">
                              <Skeleton className="w-full aspect-video bg-white/10" />
                              <div className="p-2.5 bg-black/40 space-y-2">
                                <Skeleton className="h-3 w-full bg-white/10" />
                                <Skeleton className="h-2 w-3/4 bg-white/10" />
                                <Skeleton className="h-2 w-1/2 bg-white/10" />
                          </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : relatedVideos.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 px-6 bg-white/[0.04] rounded-2xl border border-white/10">
                        <div className="w-16 h-16 bg-[#309605]/20 rounded-full flex items-center justify-center mb-4">
                          <Play className="w-8 h-8 text-[#309605]" aria-hidden />
                        </div>
                        <h4 className="text-white font-semibold text-base mb-1">You're all caught up</h4>
                        <p className="text-white/60 text-sm text-center mb-5 max-w-[260px]">
                          Discover more from creators worldwide
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                          <button
                            onClick={() => navigate('/')}
                            className="min-h-[48px] px-5 py-3 bg-gradient-to-r from-[#309605] to-[#3ba208] rounded-xl text-white text-sm font-semibold transition-all active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#309605] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                          >
                            Explore Home
                          </button>
                          <button
                            onClick={() => navigate('/explore')}
                            className="min-h-[48px] px-5 py-3 bg-white/10 hover:bg-white/15 rounded-xl text-white text-sm font-medium transition-colors active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                          >
                            Browse Genres
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 sm:gap-4">
                        {relatedVideos.map((video) => {
                          if (!video?.id || !video?.title) return null;

                          return (
                            <Card
                              key={video.id}
                              className="bg-white/[0.03] border border-white/10 cursor-pointer overflow-hidden group hover:border-white/20 active:border-[#309605]/50 active:scale-[0.98] transition-all duration-200 rounded-xl focus-visible:ring-2 focus-visible:ring-[#309605] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                              onClick={() => handleVideoChange(video.id)}
                            >
                              <CardContent className="p-0">
                                <div className="relative aspect-video overflow-hidden bg-black">
                                  {video.thumbnailUrl ? (
                                    <img
                                      src={video.thumbnailUrl}
                                      alt={video.title}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                      onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.style.display = 'none';
                                        target.parentElement!.innerHTML = `
                                          <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#309605]/20 to-black/80">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 text-white/60">
                                              <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                            </svg>
                                          </div>
                                        `;
                                      }}
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#309605]/20 to-black/80">
                                      <Play className="w-6 h-6 text-white/60" />
                      </div>
                    )}

                                  {/* Play Icon Overlay */}
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-active:opacity-100 transition-opacity duration-150 flex items-center justify-center">
                                    <div className="w-10 h-10 bg-[#309605] rounded-full flex items-center justify-center shadow-lg">
                                      <Play className="w-5 h-5 text-white ml-0.5" />
                                    </div>
                                  </div>
                                </div>

                                <div className="p-2.5 bg-black/40">
                                  <h4 className="font-['Inter',sans-serif] font-semibold text-white text-xs leading-tight mb-1 line-clamp-2">
                                    {video.title}
                                  </h4>
                                  <p className="font-['Inter',sans-serif] text-white/60 text-[10px] mb-0.5 truncate">
                                    {video.creatorName || 'Unknown Creator'}
                                  </p>
                                  <p className="font-['Inter',sans-serif] text-white/50 text-[10px] flex items-center gap-1">
                                    <Eye className="w-2.5 h-2.5" />
                                    {formatNumber(video.playCount || 0)} views
                                  </p>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                  </div>
                )}
              </div>
                )}
            </div>
          </div>
          </div>
        </div>
      </div>
      
      {/* Lazy-loaded Modals with Suspense */}
      <Suspense fallback={null}>
        {/* Comments Modal */}
        {showCommentsModal && videoData && (
          <CommentsModal
            contentId={videoId!}
            contentType="video"
            contentTitle={videoData.title}
            onClose={() => setShowCommentsModal(false)}
          />
        )}

        {/* Tipping Modal */}
        {showTippingModal && videoData && videoData.creator?.id && (
          <TippingModal
            onClose={() => setShowTippingModal(false)}
            onSuccess={handleTipSuccess}
            recipientId={videoData.creator.id}
            contentId={videoId}
            contentType="video"
            recipientName={videoData.creator.name ?? ''}
            recipientAvatar={videoData.creator.avatar || null}
          />
        )}

        {/* Report Modal */}
        {showReportModal && videoData && videoData.creator?.id != null && (
          <ReportModal
            contentType="video"
            contentId={videoId!}
            contentTitle={videoData.title ?? ''}
            reportedUserId={videoData.creator.id}
            onClose={() => setShowReportModal(false)}
            onSuccess={() => {
              setShowReportModal(false);
            }}
          />
        )}

        {/* Auth Modal */}
        {showAuthModal && (
          <AuthModal
            onClose={() => setShowAuthModal(false)}
            onSuccess={async () => {
              setShowAuthModal(false);
              await checkAuthAndLoadData();
            }}
          />
        )}
      </Suspense>
    </div>
  );
};
