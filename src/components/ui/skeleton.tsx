import React from 'react';
import { cn } from '../../lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant = 'rectangular', width, height, style, ...props }, ref) => {
    const variantClass = {
      text: 'rounded',
      circular: 'rounded-full',
      rectangular: 'rounded-md'
    }[variant];

    return (
      <div
        ref={ref}
        className={cn(
          'animate-pulse bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 bg-[length:200%_100%] dark:from-gray-700 dark:via-gray-600 dark:to-gray-700',
          variantClass,
          className
        )}
        style={{
          width: width || '100%',
          height: height || '100%',
          ...style
        }}
        {...props}
      />
    );
  }
);

Skeleton.displayName = 'Skeleton';

export const SkeletonCard = () => (
  <div className="space-y-3 p-4">
    <Skeleton variant="rectangular" height="200px" />
    <Skeleton variant="text" height="20px" width="80%" />
    <Skeleton variant="text" height="16px" width="60%" />
  </div>
);

export const SkeletonList = ({ count = 5 }: { count?: number }) => (
  <div className="space-y-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="flex items-center space-x-4">
        <Skeleton variant="circular" width={48} height={48} />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" height="16px" width="70%" />
          <Skeleton variant="text" height="14px" width="40%" />
        </div>
      </div>
    ))}
  </div>
);

export const SkeletonSongCard = () => (
  <div className="flex-shrink-0 w-40">
    <Skeleton variant="rectangular" height="160px" className="mb-2" />
    <Skeleton variant="text" height="16px" className="mb-1" />
    <Skeleton variant="text" height="14px" width="70%" />
  </div>
);

export const SkeletonVideoCard = () => (
  <div className="flex-shrink-0 w-48">
    <Skeleton variant="rectangular" height="270px" className="mb-2 rounded-xl" />
    <Skeleton variant="text" height="16px" className="mb-1" />
    <Skeleton variant="text" height="14px" width="60%" />
  </div>
);

export const SkeletonAlbumCard = () => (
  <div className="flex-shrink-0 w-44">
    <Skeleton variant="rectangular" height="176px" className="mb-2 rounded-lg" />
    <Skeleton variant="text" height="16px" className="mb-1" />
    <Skeleton variant="text" height="14px" width="70%" />
  </div>
);

export const SkeletonHeroSection = () => (
  <div className="w-full h-[400px] relative">
    <Skeleton variant="rectangular" height="100%" />
    <div className="absolute bottom-8 left-8 space-y-4" style={{ width: 'calc(100% - 4rem)' }}>
      <Skeleton variant="text" height="32px" width="60%" />
      <Skeleton variant="text" height="20px" width="40%" />
      <div className="flex gap-3">
        <Skeleton variant="rectangular" width={120} height={40} className="rounded-full" />
        <Skeleton variant="rectangular" width={120} height={40} className="rounded-full" />
      </div>
    </div>
  </div>
);

export const SkeletonGrid = ({ count = 6, columns = 3 }: { count?: number; columns?: number }) => (
  <div
    className="grid gap-4"
    style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
  >
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
);

export const SkeletonProfile = () => (
  <div className="space-y-6 p-6">
    <div className="flex items-center gap-4">
      <Skeleton variant="circular" width={80} height={80} />
      <div className="flex-1 space-y-2">
        <Skeleton variant="text" height="24px" width="50%" />
        <Skeleton variant="text" height="16px" width="30%" />
      </div>
    </div>
    <div className="grid grid-cols-3 gap-4">
      <div className="space-y-2">
        <Skeleton variant="text" height="28px" />
        <Skeleton variant="text" height="14px" />
      </div>
      <div className="space-y-2">
        <Skeleton variant="text" height="28px" />
        <Skeleton variant="text" height="14px" />
      </div>
      <div className="space-y-2">
        <Skeleton variant="text" height="28px" />
        <Skeleton variant="text" height="14px" />
      </div>
    </div>
  </div>
);
