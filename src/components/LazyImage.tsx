import React, { useState, useRef, useEffect } from 'react';
import { getOptimizedImageUrl, getImageQualityForNetwork } from '../lib/imageOptimization';
import { Skeleton } from './ui/skeleton';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackSrc?: string;
  placeholder?: React.ReactNode;
  width?: number;
  height?: number;
  aspectRatio?: string;
  useSkeleton?: boolean;
  loading?: 'lazy' | 'eager';
}

export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt,
  className = '',
  fallbackSrc = 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400',
  placeholder,
  width,
  height,
  aspectRatio,
  useSkeleton = true,
  loading = 'lazy'
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(loading === 'eager');
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState<string>('');
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevSrcRef = useRef<string>('');

  // For eager loading, skip IntersectionObserver and load immediately
  useEffect(() => {
    if (loading === 'eager') {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.01, rootMargin: '50px' } // Reduced from 100px for bandwidth savings
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [loading]);

  useEffect(() => {
    if (isInView && src) {
      const quality = getImageQualityForNetwork();
      const optimizedUrl = getOptimizedImageUrl(src, {
        width,
        height,
        quality,
        format: 'webp'
      });
      // Only reset loaded state when src actually changed to avoid flicker on parent re-renders
      if (prevSrcRef.current !== src) {
        prevSrcRef.current = src;
        setIsLoaded(false);
        setHasError(false);
      }
      setCurrentSrc(optimizedUrl);
    }
  }, [isInView, src, width, height]);

  const handleLoad = () => {
    setIsLoaded(true);
  };

  const handleError = () => {
    setHasError(true);
    setIsLoaded(true);
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      {!isLoaded && useSkeleton && (
        <div className="absolute inset-0">
          <Skeleton variant="rectangular" className="w-full h-full" />
        </div>
      )}

      {!isLoaded && !useSkeleton && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
          {placeholder || (
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
              <span className="text-white/60 text-lg">♪</span>
            </div>
          )}
        </div>
      )}

      {isInView && currentSrc && (
        <img
          ref={imgRef}
          src={hasError ? fallbackSrc : currentSrc}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-500 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={handleLoad}
          onError={handleError}
          loading={loading}
          decoding="async"
        />
      )}
    </div>
  );
};