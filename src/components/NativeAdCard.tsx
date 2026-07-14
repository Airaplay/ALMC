import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { LazyImage } from './LazyImage';
import {
  NativeAdCard as NativeAdCardType,
  hasNativeAdClickUrl,
  recordNativeAdImpression,
  recordNativeAdClick,
} from '../lib/nativeAdService';

interface NativeAdCardProps {
  ad: NativeAdCardType;
  className?: string;
}

export const NativeAdCard = ({ ad, className = '' }: NativeAdCardProps): JSX.Element => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [hasRecordedImpression, setHasRecordedImpression] = useState(false);
  const clickEnabled = hasNativeAdClickUrl(ad.click_url);

  useEffect(() => {
    if (!cardRef.current || hasRecordedImpression) return;

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

    observer.observe(cardRef.current);

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
      ref={cardRef}
      onClick={clickEnabled ? handleClick : undefined}
      className={`${clickEnabled ? 'cursor-pointer' : 'cursor-default'} group ${className}`}
    >
      {/* Album Cover / Ad Image */}
      <div className="relative w-full aspect-square rounded-lg overflow-hidden mb-2 bg-white/5">
        <LazyImage
          src={ad.image_url}
          alt={ad.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />

        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300 flex items-center justify-center">
          {clickEnabled ? (
            <ExternalLink className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          ) : null}
        </div>

        {/* Sponsored Badge */}
        <div className="absolute top-1.5 right-1.5 px-2 py-0.5 bg-gradient-to-r from-blue-500/90 to-purple-500/90 backdrop-blur-sm rounded text-[10px] font-semibold text-white shadow-lg">
          Sponsored
        </div>
      </div>

      {/* Ad Info */}
      <div className="text-left">
        <h3 className="text-xs font-semibold text-white truncate mb-0.5">
          {ad.title}
        </h3>
        {ad.advertiser_name?.trim() ? (
          <p className="text-[10px] text-gray-400 truncate">{ad.advertiser_name}</p>
        ) : null}
      </div>
    </div>
  );
};
