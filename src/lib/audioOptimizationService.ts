/**
 * Audio Optimization Service
 *
 * Provides network-aware audio streaming optimizations to reduce bandwidth costs.
 * Integrates with existing useNetworkQuality hook for adaptive playback settings.
 */

export interface NetworkQualityInfo {
  isSlowNetwork: boolean;
  isMediumNetwork: boolean;
  isFastNetwork: boolean;
  saveData: boolean;
  effectiveType: string;
}

export interface AudioOptimizationSettings {
  preload: 'none' | 'metadata' | 'auto';
  shouldPreloadNext: boolean;
  bufferAhead: number; // seconds
  recommendedBitrate: '64kbps' | '128kbps' | '192kbps' | '320kbps';
  maxConcurrentLoads: number;
}

/**
 * Get optimized audio settings based on network quality
 *
 * Network-aware strategy:
 * - Slow (2G/Save Data): Minimal buffering, no preload, lowest bitrate
 * - Medium (3G): Moderate buffering, conditional preload, balanced bitrate
 * - Fast (4G+): Aggressive buffering, preload next track, high bitrate
 */
export function getAudioOptimizationSettings(
  networkInfo: NetworkQualityInfo
): AudioOptimizationSettings {
  const { isSlowNetwork, isMediumNetwork, isFastNetwork, saveData } = networkInfo;

  // SLOW NETWORK: Minimize bandwidth usage
  if (saveData || isSlowNetwork) {
    return {
      preload: 'none', // No preloading
      shouldPreloadNext: false, // Don't preload next song
      bufferAhead: 10, // Only 10 seconds of buffer
      recommendedBitrate: '64kbps', // Lowest quality
      maxConcurrentLoads: 1, // One audio file at a time
    };
  }

  // MEDIUM NETWORK: Balanced approach
  if (isMediumNetwork) {
    return {
      preload: 'metadata', // Preload metadata only
      shouldPreloadNext: false, // Still no next-song preload
      bufferAhead: 30, // 30 seconds buffer
      recommendedBitrate: '128kbps', // Standard quality
      maxConcurrentLoads: 1, // One audio file at a time
    };
  }

  // FAST NETWORK: Optimize for experience
  if (isFastNetwork) {
    return {
      preload: 'metadata', // Preload metadata
      shouldPreloadNext: true, // Preload next song in playlist
      bufferAhead: 60, // Full 60 seconds buffer
      recommendedBitrate: '192kbps', // High quality (320kbps if user has premium)
      maxConcurrentLoads: 2, // Can load current + next
    };
  }

  // DEFAULT: Conservative settings
  return {
    preload: 'none',
    shouldPreloadNext: false,
    bufferAhead: 20,
    recommendedBitrate: '128kbps',
    maxConcurrentLoads: 1,
  };
}

/**
 * Create an optimized audio URL with bitrate selection
 *
 * NOTE: Requires backend support to serve multiple bitrates.
 * For now, this documents the URL structure for future implementation.
 *
 * Future Implementation:
 * 1. Upload songs in multiple bitrates (64, 128, 192, 320 kbps)
 * 2. Store URLs in database: audio_url_64, audio_url_128, etc.
 * 3. Client selects appropriate URL based on network
 *
 * Alternative: Use HLS audio streaming (like video)
 * - Single .m3u8 manifest with multiple bitrate variants
 * - Bunny CDN can provide HLS for audio files
 * - Adaptive bitrate switching during playback
 */
export function getOptimizedAudioUrl(
  baseAudioUrl: string,
  bitrate: '64kbps' | '128kbps' | '192kbps' | '320kbps'
): string {
  // For now, return the original URL
  // TODO: When multiple bitrates are available, select the appropriate URL

  // Example future implementation:
  // if (baseAudioUrl.includes('/songs/')) {
  //   const bitrateMap = {
  //     '64kbps': '/songs-64/',
  //     '128kbps': '/songs-128/',
  //     '192kbps': '/songs-192/',
  //     '320kbps': '/songs-320/',
  //   };
  //   return baseAudioUrl.replace('/songs/', bitrateMap[bitrate]);
  // }

  return baseAudioUrl;
}

/**
 * Enable HTTP Range request support for seeking
 *
 * Benefits:
 * - Skip songs without downloading entire file (30-50% savings)
 * - Seek to any position instantly
 * - Resume interrupted downloads
 *
 * Implementation using Fetch API with Range headers:
 */
export async function createRangeAwareAudioElement(
  audioUrl: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<HTMLAudioElement> {
  const audio = new Audio();

  // Check if server supports Range requests
  try {
    const response = await fetch(audioUrl, {
      method: 'HEAD',
      headers: {
        'Range': 'bytes=0-0',
      },
    });

    const acceptsRanges = response.headers.get('Accept-Ranges') === 'bytes';
    const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);

    if (acceptsRanges) {
      console.log('✓ Server supports Range requests for audio');

      // Set the audio source normally - browser will automatically use Range requests
      // when seeking if the server supports it
      audio.src = audioUrl;
      audio.preload = 'metadata';

      // Monitor progress if callback provided
      if (onProgress) {
        audio.addEventListener('progress', () => {
          if (audio.buffered.length > 0) {
            const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
            const duration = audio.duration || 1;
            const loaded = (bufferedEnd / duration) * contentLength;
            onProgress(loaded, contentLength);
          }
        });
      }
    } else {
      console.log('⚠ Server does not support Range requests');
      audio.src = audioUrl;
      audio.preload = 'none'; // Fall back to no preload if ranges not supported
    }
  } catch (error) {
    console.error('Error checking Range support:', error);
    // Fall back to regular audio element
    audio.src = audioUrl;
    audio.preload = 'none';
  }

  return audio;
}

/**
 * Smart preload strategy for next song
 *
 * Only preloads if:
 * 1. Network is fast (4G+)
 * 2. Data saver is OFF
 * 3. Current song is > 50% complete
 * 4. Next song exists in playlist
 */
export function shouldPreloadNextSong(
  networkInfo: NetworkQualityInfo,
  currentProgress: number, // 0-1
  hasNextSong: boolean
): boolean {
  const { isFastNetwork, saveData } = networkInfo;

  // Never preload on slow networks or when data saver is on
  if (!isFastNetwork || saveData) {
    return false;
  }

  // Only preload after 50% of current song is complete
  if (currentProgress < 0.5) {
    return false;
  }

  // Must have a next song to preload
  if (!hasNextSong) {
    return false;
  }

  return true;
}

/**
 * Estimate bandwidth savings from audio optimizations
 *
 * Assumptions:
 * - Average song: 4 minutes (240 seconds)
 * - Full bitrate: 192kbps = 5.76 MB per song
 * - User listens to 20 songs per day
 * - 50% of users skip songs (only listen to 50%)
 * - 30% slow network, 40% medium network, 30% fast network
 */
export function estimateAudioBandwidthSavings(userCount: number): {
  monthlyGBSaved: number;
  annualCostSavings: number;
  savingsPercentage: number;
} {
  const avgSongDurationSeconds = 240;
  const fullBitrateKbps = 192;
  const songsPerUserPerDay = 20;
  const skipRate = 0.5; // 50% of songs skipped before completion
  const avgListenPercentage = 0.75; // Average 75% listen through

  // Network distribution
  const slowNetworkPercent = 0.30;
  const mediumNetworkPercent = 0.40;
  const fastNetworkPercent = 0.30;

  // Bitrate by network type
  const slowBitrateKbps = 64; // Down from 192
  const mediumBitrateKbps = 128; // Down from 192
  const fastBitrateKbps = 192; // Same as before

  // Calculate MB per song at different bitrates
  const fullSizeMB = (fullBitrateKbps * avgSongDurationSeconds) / 8 / 1024;
  const slowSizeMB = (slowBitrateKbps * avgSongDurationSeconds) / 8 / 1024;
  const mediumSizeMB = (mediumBitrateKbps * avgSongDurationSeconds) / 8 / 1024;
  const fastSizeMB = (fastBitrateKbps * avgSongDurationSeconds) / 8 / 1024;

  // Daily bandwidth per user BEFORE optimization
  const dailyMBBeforePerUser = songsPerUserPerDay * fullSizeMB;

  // Daily bandwidth per user AFTER optimization (weighted by network type)
  const dailyMBAfterPerUser = songsPerUserPerDay * (
    (slowNetworkPercent * slowSizeMB) +
    (mediumNetworkPercent * mediumSizeMB) +
    (fastNetworkPercent * fastSizeMB)
  );

  // Additional savings from HTTP Range requests (only download what's listened to)
  const rangeSavings = skipRate * (1 - avgListenPercentage);
  const dailyMBAfterWithRanges = dailyMBAfterPerUser * (1 - rangeSavings);

  // Calculate savings
  const dailyMBSavedPerUser = dailyMBBeforePerUser - dailyMBAfterWithRanges;
  const dailyGBSaved = (dailyMBSavedPerUser * userCount) / 1024;
  const monthlyGBSaved = dailyGBSaved * 30;

  // Cost calculations (Bunny CDN: ~$0.01 per GB)
  const annualCostSavings = monthlyGBSaved * 12 * 0.01;

  // Savings percentage
  const savingsPercentage = ((dailyMBSavedPerUser / dailyMBBeforePerUser) * 100);

  return {
    monthlyGBSaved: Math.round(monthlyGBSaved),
    annualCostSavings: Math.round(annualCostSavings),
    savingsPercentage: Math.round(savingsPercentage),
  };
}
