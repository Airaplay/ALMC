import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { useNetworkQuality } from './useNetworkQuality';

export interface UseHLSPlayerOptions {
  autoplay?: boolean;
  onError?: (error: any) => void;
  onLoadedMetadata?: () => void;
}

export const useHLSPlayer = (
  videoElement: HTMLVideoElement | null,
  hlsUrl: string | null,
  options: UseHLSPlayerOptions = {}
) => {
  const hlsRef = useRef<Hls | null>(null);
  const { isSlowNetwork, isMediumNetwork, isFastNetwork, saveData } = useNetworkQuality();

  useEffect(() => {
    const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);

    console.log('[useHLSPlayer] Hook called with:', {
      hasVideoElement: !!videoElement,
      hlsUrl,
      autoplay: options.autoplay,
      isMobile,
      videoElementReadyState: videoElement?.readyState
    });

    if (!videoElement || !hlsUrl) {
      console.log('[useHLSPlayer] Missing video element or HLS URL');
      return;
    }

    const { autoplay = false, onError, onLoadedMetadata } = options;

    const attemptAutoplay = async (video: HTMLVideoElement) => {
      if (!autoplay) return;

      try {
        video.muted = true;
        const playPromise = video.play();
        if (playPromise !== undefined) {
          await playPromise;
          console.log('[useHLSPlayer] Autoplay started successfully (muted)');
        }
      } catch (err) {
        console.warn('[useHLSPlayer] Autoplay failed, user interaction may be required:', err);
        onError?.(err);
      }
    };

    if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      console.log('[useHLSPlayer] Using native HLS support (Safari/iOS)');
      videoElement.src = hlsUrl;
      videoElement.crossOrigin = 'anonymous';

      if (onLoadedMetadata) {
        const handleLoadedMetadata = () => {
          console.log('[useHLSPlayer] Native HLS metadata loaded');
          if (autoplay) {
            attemptAutoplay(videoElement);
          }
          onLoadedMetadata();
        };
        videoElement.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
      } else if (autoplay) {
        videoElement.addEventListener('loadedmetadata', () => attemptAutoplay(videoElement), { once: true });
      }
    } else if (Hls.isSupported()) {
      console.log('[useHLSPlayer] Using HLS.js (Firefox/Chrome/Android)');

      // Network-aware buffering settings
      let bufferSettings;
      if (saveData || isSlowNetwork) {
        bufferSettings = {
          backBufferLength: 10,
          maxBufferLength: 5,
          maxMaxBufferLength: 20,
          startLevel: 0, // Force 360p on slow connections
        };
      } else if (isMediumNetwork) {
        bufferSettings = {
          backBufferLength: 30,
          maxBufferLength: 15,
          maxMaxBufferLength: 45,
          startLevel: 1, // Start at 480p on medium connections
        };
      } else {
        bufferSettings = {
          backBufferLength: 60,
          maxBufferLength: 30,
          maxMaxBufferLength: 90,
          startLevel: -1, // Auto-select on fast connections
        };
      }

      console.log('[useHLSPlayer] Buffer settings:', bufferSettings);

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        ...bufferSettings,
        capLevelToPlayerSize: true,
        debug: false,
      });

      hlsRef.current = hls;

      hls.loadSource(hlsUrl);
      hls.attachMedia(videoElement);

      hls.on(Hls.Events.MANIFEST_PARSED, async () => {
        console.log('[useHLSPlayer] HLS manifest parsed successfully');
        if (autoplay) {
          await attemptAutoplay(videoElement);
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS.js error:', {
          event,
          type: data.type,
          details: data.details,
          fatal: data.fatal,
          error: data.error
        });

        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('Fatal network error encountered, attempting recovery');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('Fatal media error encountered, attempting recovery');
              hls.recoverMediaError();
              break;
            default:
              console.error('Fatal HLS error, cannot recover:', data.details);
              hls.destroy();
              onError?.(data);
              break;
          }
        }
      });

      if (onLoadedMetadata) {
        videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
      }
    } else {
      const errorMsg = 'HLS is not supported in this browser';
      console.error(errorMsg);
      onError?.(new Error(errorMsg));
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      if (onLoadedMetadata && videoElement) {
        videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
      }
    };
  }, [videoElement, hlsUrl, options.autoplay]);

  const getCurrentQuality = (): number => {
    if (hlsRef.current) {
      return hlsRef.current.currentLevel;
    }
    return -1;
  };

  const setQuality = (level: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
    }
  };

  const getAvailableQualities = (): Array<{ level: number; height: number; bitrate: number }> => {
    if (hlsRef.current && hlsRef.current.levels) {
      return hlsRef.current.levels.map((level, index) => ({
        level: index,
        height: level.height,
        bitrate: level.bitrate,
      }));
    }
    return [];
  };

  return {
    hls: hlsRef.current,
    getCurrentQuality,
    setQuality,
    getAvailableQualities,
  };
};
