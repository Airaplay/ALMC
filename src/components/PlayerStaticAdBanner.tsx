import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { LazyImage } from './LazyImage';
import {
  NativeAdCard as NativeAdCardType,
  hasNativeAdClickUrl,
  recordNativeAdImpression,
  recordNativeAdClick,
} from '../lib/nativeAdService';

interface PlayerStaticAdBannerProps {
  ad: NativeAdCardType;
  className?: string;
}

export const PlayerStaticAdBanner = ({ ad, className = '' }: PlayerStaticAdBannerProps): JSX.Element => {
  const bannerRef = useRef<HTMLDivElement>(null);
  const [hasRecordedImpression, setHasRecordedImpression] = useState(false);
  const clickEnabled = hasNativeAdClickUrl(ad.click_url);

  useEffect(() => {
    if (!bannerRef.current || hasRecordedImpression) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasRecordedImpression) {
            recordNativeAdImpression(ad.id);
            setHasRecordedImpression(true);
            observer.disconnect();
          }
        });
      },
      {
        threshold: 0.5, // Ad must be 50% visible
        rootMargin: '0px'
      }
    );

    observer.observe(bannerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [ad.id, hasRecordedImpression]);

  const handleClick = async () => {
    if (!clickEnabled) return;
    await recordNativeAdClick(ad.id);
    window.open(ad.click_url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      ref={bannerRef}
      onClick={clickEnabled ? handleClick : undefined}
      className={`relative w-full group overflow-hidden ${clickEnabled ? 'cursor-pointer' : 'cursor-default'} ${className}`}
    >
      {/* Ad Banner Container */}
      <div className="relative w-full bg-gradient-to-r from-gray-900/50 to-gray-800/50 backdrop-blur-sm rounded-lg overflow-hidden border border-white/10">
        {/* Image Section */}
        <div className="relative w-full h-24">
          <LazyImage
            src={ad.image_url}
            alt={ad.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />

          {/* Overlay on hover */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300 flex items-center justify-center">
            {clickEnabled ? (
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <span className="text-white text-sm font-medium">Learn More</span>
                <ExternalLink className="w-4 h-4 text-white" />
              </div>
            ) : null}
          </div>

          {/* Sponsored Badge */}
          <div className="absolute top-2 left-2 px-2.5 py-1 bg-gradient-to-r from-blue-500/95 to-purple-500/95 backdrop-blur-md rounded-md text-[10px] font-bold text-white shadow-lg border border-white/20">
            SPONSORED
          </div>
        </div>

        {/* Text Content */}
        <div className="p-3 bg-gradient-to-r from-gray-900/80 to-gray-800/80">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-white truncate mb-0.5">
                {ad.title}
              </h3>
              {ad.description && (
                <p className="text-xs text-gray-300 truncate">
                  {ad.description}
                </p>
              )}
              {ad.advertiser_name?.trim() ? (
                <p className="text-[10px] text-gray-400 mt-1">by {ad.advertiser_name}</p>
              ) : null}
            </div>
            {clickEnabled ? (
              <button
                type="button"
                className="ml-3 px-3 py-1.5 bg-[#00ad74] hover:bg-[#009c68] text-white text-xs font-semibold rounded-md transition-colors shadow-md flex items-center gap-1.5 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleClick();
                }}
              >
                Visit
                <ExternalLink className="w-3 h-3" />
              </button>
            ) : (
              <span className="ml-3 px-2 py-1 text-[10px] text-gray-500 flex-shrink-0">No link</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
