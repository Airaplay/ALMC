export interface ImageOptimizationOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png';
}

const isDataSaverEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;

  const savedPreference = localStorage.getItem('dataSaverMode');
  if (savedPreference !== null) {
    return savedPreference === 'true';
  }

  if ('connection' in navigator) {
    const connection = (navigator as any).connection;
    return connection?.saveData === true || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g';
  }

  return false;
};

const isBunnyCdnUrl = (url: string): boolean =>
  url.includes('b-cdn.net') || url.includes('bunnycdn.com');

export const getOptimizedImageUrl = (
  originalUrl: string,
  options: ImageOptimizationOptions = {}
): string => {
  if (!originalUrl) return '';

  const dataSaver = isDataSaverEnabled();
  const defaultQuality = dataSaver ? 50 : 75;

  const {
    width,
    height,
    quality = defaultQuality,
    format = 'webp'
  } = options;

  const params: string[] = [];
  if (width) params.push(`width=${width}`);
  if (height) params.push(`height=${height}`);
  if (quality) params.push(`quality=${quality}`);
  if (format && format !== 'png') params.push(`format=${format}`);

  if (params.length === 0) return originalUrl;

  const separator = originalUrl.includes('?') ? '&' : '?';
  const paramString = params.join('&');

  // Bunny CDN: add params to reduce bandwidth (smaller size, WebP)
  if (isBunnyCdnUrl(originalUrl)) {
    return `${originalUrl}${separator}${paramString}`;
  }

  // Supabase Storage (full or relative URL)
  if (originalUrl.includes('/storage/v1/object/public/')) {
    return `${originalUrl}${separator}${paramString}`;
  }

  return originalUrl;
};

export const generateBlurDataUrl = (width: number = 10, height: number = 10): string => {
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}'%3E%3Cfilter id='b' color-interpolation-filters='sRGB'%3E%3CfeGaussianBlur stdDeviation='1'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='discrete' tableValues='1 1'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' fill='%23008a5d' filter='url(%23b)'/%3E%3C/svg%3E`;
};

/**
 * Thumbnail size presets for different use cases
 */
export const THUMBNAIL_SIZES = {
  TINY: { width: 50, height: 50, quality: 60 },      // For icons, avatars in lists
  SMALL: { width: 150, height: 150, quality: 70 },   // For list view thumbnails
  MEDIUM: { width: 300, height: 300, quality: 75 },  // For grid view
  LARGE: { width: 600, height: 600, quality: 80 },   // For detail view
} as const;

/**
 * Generate a thumbnail URL for list views
 * Reduces egress by using smaller image dimensions
 */
export const getThumbnailUrl = (
  originalUrl: string,
  size: 'tiny' | 'small' | 'medium' | 'large' = 'small'
): string => {
  if (!originalUrl) return '';

  const sizeConfig = THUMBNAIL_SIZES[size.toUpperCase() as keyof typeof THUMBNAIL_SIZES];
  return getOptimizedImageUrl(originalUrl, sizeConfig);
};

/**
 * Progressive image loading strategy
 * Returns both thumbnail and full-size URLs
 */
export const getProgressiveImageUrls = (originalUrl: string) => {
  return {
    placeholder: generateBlurDataUrl(),
    thumbnail: getThumbnailUrl(originalUrl, 'small'),
    medium: getThumbnailUrl(originalUrl, 'medium'),
    full: getOptimizedImageUrl(originalUrl, { quality: 85 }),
    original: originalUrl,
  };
};

/**
 * Get appropriate image URL based on viewport and network
 */
export const getAdaptiveImageUrl = (
  originalUrl: string,
  context: 'list' | 'grid' | 'detail' | 'fullscreen' = 'list'
): string => {
  if (!originalUrl) return '';

  const network = getNetworkInfo();
  const isSlowNetwork = network.effectiveType === '2g' || network.effectiveType === 'slow-2g' || network.saveData;

  // On slow networks, always use smaller images
  if (isSlowNetwork) {
    return getThumbnailUrl(originalUrl, context === 'detail' ? 'medium' : 'small');
  }

  // On fast networks, use appropriate size for context
  switch (context) {
    case 'list':
      return getThumbnailUrl(originalUrl, 'small');
    case 'grid':
      return getThumbnailUrl(originalUrl, 'medium');
    case 'detail':
      return getThumbnailUrl(originalUrl, 'large');
    case 'fullscreen':
      return getOptimizedImageUrl(originalUrl, { quality: 85 });
    default:
      return getThumbnailUrl(originalUrl, 'small');
  }
};

export interface NetworkInfo {
  effectiveType: '4g' | '3g' | '2g' | 'slow-2g' | 'unknown';
  downlink?: number;
  rtt?: number;
  saveData: boolean;
}

export const getNetworkInfo = (): NetworkInfo => {
  if (typeof window === 'undefined') {
    return { effectiveType: 'unknown', saveData: false };
  }

  const dataSaver = isDataSaverEnabled();

  if ('connection' in navigator) {
    const connection = (navigator as any).connection;
    return {
      effectiveType: connection?.effectiveType || 'unknown',
      downlink: connection?.downlink,
      rtt: connection?.rtt,
      saveData: dataSaver || connection?.saveData || false
    };
  }

  return { effectiveType: 'unknown', saveData: dataSaver };
};

export const shouldLoadHighQuality = (): boolean => {
  const network = getNetworkInfo();
  return network.effectiveType === '4g' && !network.saveData;
};

export const getImageQualityForNetwork = (): number => {
  const network = getNetworkInfo();

  if (network.saveData) return 40;

  switch (network.effectiveType) {
    case '4g':
      return 80;
    case '3g':
      return 60;
    case '2g':
    case 'slow-2g':
      return 40;
    default:
      return 70;
  }
};

export const prefetchImage = (url: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
};

export const batchPrefetchImages = async (urls: string[], limit: number = 3): Promise<void> => {
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += limit) {
    batches.push(urls.slice(i, i + limit));
  }

  for (const batch of batches) {
    await Promise.allSettled(batch.map(url => prefetchImage(url)));
  }
};

export const compressImage = async (
  file: File,
  maxWidth: number = 800,
  maxHeight: number = 800,
  quality: number = 0.8
): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }

            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });

            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
};

export interface AlbumCoverCompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  dimensions: { width: number; height: number };
}

export const compressAlbumCover = async (
  file: File,
  targetSize: number = 467,
  maxFileSizeKB: number = 200,
  onProgress?: (status: string) => void
): Promise<AlbumCoverCompressionResult> => {
  const originalSize = file.size;
  const MAX_ATTEMPTS = 4;
  const TARGET_SIZE_BYTES = maxFileSizeKB * 1024;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const timeout = setTimeout(() => {
      reject(new Error('Image compression timeout after 10 seconds'));
    }, 10000);

    reader.onload = async (e) => {
      try {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = async () => {
          try {
            URL.revokeObjectURL(objectUrl);

            const sourceWidth = img.width;
            const sourceHeight = img.height;

            if (sourceWidth < targetSize || sourceHeight < targetSize) {
              onProgress?.(`Warning: Source image is smaller than ${targetSize}x${targetSize}px`);
            }

            onProgress?.('Optimizing image to 467x467px...');

            const canvas = document.createElement('canvas');
            canvas.width = targetSize;
            canvas.height = targetSize;

            const ctx = canvas.getContext('2d', {
              alpha: false,
              desynchronized: false,
              willReadFrequently: false
            });

            if (!ctx) {
              clearTimeout(timeout);
              reject(new Error('Failed to get canvas context'));
              return;
            }

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            const scale = Math.max(targetSize / sourceWidth, targetSize / sourceHeight);
            const scaledWidth = sourceWidth * scale;
            const scaledHeight = sourceHeight * scale;

            const offsetX = (targetSize - scaledWidth) / 2;
            const offsetY = (targetSize - scaledHeight) / 2;

            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, targetSize, targetSize);

            ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);

            let quality = 0.92;
            let attempt = 0;
            let compressedBlob: Blob | null = null;

            while (attempt < MAX_ATTEMPTS) {
              attempt++;
              onProgress?.(`Processing (attempt ${attempt}/${MAX_ATTEMPTS})...`);

              compressedBlob = await new Promise<Blob | null>((resolveBlob) => {
                canvas.toBlob(
                  (blob) => resolveBlob(blob),
                  'image/jpeg',
                  quality
                );
              });

              if (!compressedBlob) {
                clearTimeout(timeout);
                reject(new Error('Failed to compress image'));
                return;
              }

              if (compressedBlob.size <= TARGET_SIZE_BYTES || attempt === MAX_ATTEMPTS) {
                break;
              }

              quality -= 0.10;
              if (quality < 0.70) quality = 0.70;
            }

            if (!compressedBlob) {
              clearTimeout(timeout);
              reject(new Error('Failed to compress image'));
              return;
            }

            const fileName = file.name.replace(/\.[^.]+$/, '') + '_467x467.jpg';
            const compressedFile = new File([compressedBlob], fileName, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });

            const compressionRatio = originalSize / compressedFile.size;
            const savingsPercent = ((originalSize - compressedFile.size) / originalSize * 100).toFixed(1);

            onProgress?.(`Optimized: ${(originalSize / 1024).toFixed(0)}KB → ${(compressedFile.size / 1024).toFixed(0)}KB (${savingsPercent}% smaller)`);

            clearTimeout(timeout);
            resolve({
              file: compressedFile,
              originalSize,
              compressedSize: compressedFile.size,
              compressionRatio,
              dimensions: { width: targetSize, height: targetSize }
            });
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        };

        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          clearTimeout(timeout);
          reject(new Error('Failed to load image'));
        };

        img.src = objectUrl;
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    };

    reader.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to read file'));
    };

    reader.readAsDataURL(file);
  });
};
