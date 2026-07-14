/**
 * Bunny.net CDN Optimization Service
 * Reduces bandwidth costs by adding optimization query parameters to Bunny CDN URLs
 */

interface BunnyImageOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'avif' | 'jpg' | 'png';
  aspectRatio?: string;
  blur?: number;
}

/**
 * Check if URL is a Bunny.net CDN URL
 */
export function isBunnyCDNUrl(url: string): boolean {
  return url.includes('b-cdn.net') || url.includes('bunnycdn.com');
}

/**
 * Optimize Bunny.net image URL with query parameters
 * Bunny CDN supports image manipulation via query strings
 */
export function optimizeBunnyImage(url: string, options: BunnyImageOptions = {}): string {
  if (!url || !isBunnyCDNUrl(url)) {
    return url;
  }

  const {
    width,
    height,
    quality = 75,
    format = 'webp',
    aspectRatio,
    blur,
  } = options;

  const params = new URLSearchParams();

  // Add optimization parameters
  if (width) params.append('width', width.toString());
  if (height) params.append('height', height.toString());
  if (quality) params.append('quality', quality.toString());
  if (format) params.append('format', format);
  if (aspectRatio) params.append('aspect_ratio', aspectRatio);
  if (blur) params.append('blur', blur.toString());

  // Add cache-friendly parameters
  params.append('class', 'auto'); // Enable automatic optimization

  const paramString = params.toString();
  if (!paramString) return url;

  // Check if URL already has query parameters
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${paramString}`;
}

/**
 * Get optimized thumbnail URL for song/album covers
 * Standard size: 220x220 for card displays
 */
export function getOptimizedThumbnail(url: string, size: 'small' | 'medium' | 'large' = 'medium'): string {
  const sizes = {
    small: { width: 110, height: 110, quality: 65 },
    medium: { width: 220, height: 220, quality: 75 },
    large: { width: 440, height: 440, quality: 80 },
  };

  return optimizeBunnyImage(url, { ...sizes[size], format: 'webp' });
}

/**
 * Get optimized video thumbnail
 * Standard size: 360x202 for video cards
 */
export function getOptimizedVideoThumbnail(url: string, size: 'small' | 'medium' | 'large' = 'medium'): string {
  const sizes = {
    small: { width: 180, height: 101, quality: 60 },
    medium: { width: 360, height: 202, quality: 70 },
    large: { width: 720, height: 404, quality: 75 },
  };

  return optimizeBunnyImage(url, { ...sizes[size], format: 'webp' });
}

/**
 * Get optimized banner/hero image
 * Standard size: 800x320 for hero banners
 */
export function getOptimizedBanner(url: string): string {
  return optimizeBunnyImage(url, {
    width: 800,
    height: 320,
    quality: 80,
    format: 'webp',
  });
}

/**
 * Get optimized avatar image
 * Standard sizes: 32x32 (small), 64x64 (medium), 128x128 (large)
 */
export function getOptimizedAvatar(url: string, size: 'small' | 'medium' | 'large' = 'medium'): string {
  const sizes = {
    small: { width: 32, height: 32, quality: 70 },
    medium: { width: 64, height: 64, quality: 75 },
    large: { width: 128, height: 128, quality: 80 },
  };

  return optimizeBunnyImage(url, { ...sizes[size], format: 'webp' });
}

/**
 * Check if browser supports AVIF format
 */
export function supportsAVIF(): boolean {
  if (typeof window === 'undefined') return false;

  // Check via canvas (more reliable than user agent)
  const canvas = document.createElement('canvas');
  if (canvas.getContext && canvas.getContext('2d')) {
    return canvas.toDataURL('image/avif').indexOf('data:image/avif') === 0;
  }

  return false;
}

/**
 * Get best format based on browser support
 */
export function getBestImageFormat(): 'avif' | 'webp' | 'jpg' {
  if (supportsAVIF()) return 'avif';

  // WebP support check (modern browsers)
  const canvas = document.createElement('canvas');
  if (canvas.getContext && canvas.getContext('2d')) {
    return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0 ? 'webp' : 'jpg';
  }

  return 'jpg';
}

/**
 * Cache optimization settings
 */
export const BUNNY_CACHE_SETTINGS = {
  // Cache durations in seconds
  IMAGE_CACHE: 2592000, // 30 days for images (covers, avatars)
  VIDEO_THUMBNAIL_CACHE: 604800, // 7 days for video thumbnails
  BANNER_CACHE: 86400, // 1 day for banners (may change frequently)

  // Cache control headers
  IMAGE_CACHE_HEADER: 'public, max-age=2592000, immutable',
  VIDEO_CACHE_HEADER: 'public, max-age=604800',
  BANNER_CACHE_HEADER: 'public, max-age=86400',
};

/**
 * Generate srcset for responsive images
 */
export function generateBunnySrcSet(url: string, widths: number[] = [220, 440, 880]): string {
  if (!isBunnyCDNUrl(url)) return '';

  return widths
    .map((width) => {
      const optimized = optimizeBunnyImage(url, {
        width,
        quality: 75,
        format: getBestImageFormat(),
      });
      return `${optimized} ${width}w`;
    })
    .join(', ');
}

/**
 * Estimate bandwidth savings
 * Returns percentage reduction based on optimization parameters
 */
export function estimateBandwidthSavings(options: BunnyImageOptions): number {
  let savings = 0;

  // Format savings
  if (options.format === 'avif') savings += 30; // AVIF ~30% smaller than JPEG
  else if (options.format === 'webp') savings += 25; // WebP ~25% smaller than JPEG

  // Quality savings (assuming original is 90-100%)
  if (options.quality && options.quality < 85) {
    savings += (85 - options.quality) * 0.5; // Each quality point ~0.5% size reduction
  }

  // Resize savings (significant for thumbnails)
  if (options.width && options.width < 500) {
    savings += 40; // Thumbnail downloads ~40% less data
  }

  return Math.min(savings, 80); // Cap at 80% max savings
}
